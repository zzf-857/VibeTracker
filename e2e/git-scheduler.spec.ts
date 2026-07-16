import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function git(repository: string, args: string[]) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}

async function createRepository(root: string) {
  const repository = path.join(root, 'repository')
  await fs.mkdir(repository, { recursive: true })
  git(repository, ['init'])
  git(repository, ['config', 'user.name', 'Scheduler E2E'])
  git(repository, ['config', 'user.email', 'scheduler@example.com'])
  await fs.writeFile(path.join(repository, 'index.js'), 'console.log("initial")\n')
  git(repository, ['add', 'index.js'])
  git(repository, ['commit', '-m', 'initial scheduler fixture'])
  return { repository, headSha: git(repository, ['rev-parse', 'HEAD']) }
}

async function importRepository(page: Page, name: string) {
  return page.evaluate(async projectName => {
    const inspection = await (window as any).vibe.projects.chooseDirectory()
    if (!inspection) throw new Error('没有获得 E2E 仓库扫描结果')
    const statuses = await (window as any).vibe.taxonomy.listStatuses()
    return (window as any).vibe.projects.import({
      selectedPath: inspection.canonicalPath,
      name: projectName,
      description: 'Scheduler Electron E2E',
      status: statuses[0].id,
      tagIds: [],
      coverImagePath: '',
    })
  }, name) as Promise<{ projectId: string; syncError: string }>
}

function launchEnvironment(userDataDir: string, repository: string, intervalMs = '250') {
  return {
    ...process.env,
    VITE_DEV_SERVER_URL: '',
    VIBETRACKER_USER_DATA_DIR: userDataDir,
    VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
    VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
    VIBETRACKER_E2E_PROJECT_DIR: repository,
    VIBETRACKER_E2E_GIT_SCHEDULER_INTERVAL_MS: intervalMs,
    VIBETRACKER_E2E_GIT_SYNC_INTERVAL_MS: intervalMs,
  } as Record<string, string>
}

test('主进程 Scheduler 在 renderer 空闲时自动发现真实新提交并更新任务中心', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-scheduler-discovery-e2e-'))
  const fixture = await createRepository(tempRoot)
  const environment = launchEnvironment(path.join(tempRoot, 'user-data'), fixture.repository)
  let electronApp: ElectronApplication | null = null
  try {
    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: environment, timeout: 30_000 })
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    const imported = await importRepository(page, 'Scheduler 自动发现')
    expect(imported.syncError).toBe('')

    await fs.writeFile(path.join(fixture.repository, 'scheduled.js'), 'console.log("scheduled")\n')
    git(fixture.repository, ['add', 'scheduled.js'])
    git(fixture.repository, ['commit', '-m', 'scheduler discovers this commit'])
    const newSha = git(fixture.repository, ['rev-parse', 'HEAD'])

    await expect.poll(async () => page.evaluate(async ({ projectId, sha }) => {
      const commits = await (window as any).vibe.git.list(projectId, { limit: 100 })
      return commits.items.some((commit: { sha: string }) => commit.sha === sha)
    }, { projectId: imported.projectId, sha: newSha }), { timeout: 20_000 }).toBe(true)
    await expect.poll(async () => page.evaluate(async projectId => {
      const tasks = await (window as any).vibe.tasks.list()
      return tasks.some((task: { kind: string; projectId: string; status: string; detail: string }) => (
        task.kind === 'git-sync-scheduled'
        && task.projectId === projectId
        && task.status === 'completed'
        && task.detail.includes('发现 1 个新提交')
      ))
    }, imported.projectId), { timeout: 10_000 }).toBe(true)

    const taskCenter = page.getByRole('button', { name: /后台任务/ })
    if (await taskCenter.getAttribute('aria-expanded') !== 'true') await taskCenter.click()
    await expect(page.getByText('自动同步发现 1 个新提交', { exact: true })).toBeVisible()
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('异常退出留下的增量回填断点会在重启后继续并水合中断任务', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-scheduler-resume-e2e-'))
  const fixture = await createRepository(tempRoot)
  const userDataDir = path.join(tempRoot, 'user-data')
  const slowEnvironment = launchEnvironment(userDataDir, fixture.repository, '60000')
  let electronApp: ElectronApplication | null = null
  try {
    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: slowEnvironment, timeout: 30_000 })
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    const imported = await importRepository(page, 'Scheduler 断点恢复')
    expect(imported.syncError).toBe('')
    await electronApp.close()
    electronApp = null

    await fs.writeFile(path.join(fixture.repository, 'resume-older.js'), 'console.log("older")\n')
    git(fixture.repository, ['add', 'resume-older.js'])
    git(fixture.repository, ['commit', '-m', 'resume older commit'])
    const olderSha = git(fixture.repository, ['rev-parse', 'HEAD'])
    await fs.writeFile(path.join(fixture.repository, 'resume-head.js'), 'console.log("head")\n')
    git(fixture.repository, ['add', 'resume-head.js'])
    git(fixture.repository, ['commit', '-m', 'resume head commit'])
    const headSha = git(fixture.repository, ['rev-parse', 'HEAD'])
    const generation = 'scheduler-e2e-resume-generation'
    const now = Date.now()

    const db = new DatabaseSync(path.join(userDataDir, 'vibetracker.db'))
    db.prepare(`
      INSERT INTO git_commits (
        id, projectId, sha, subject, body, authorName, authorEmail, authoredAt,
        parentShasJson, fileNamesJson, statsJson, createdAt, reachable, lastSeenGeneration
      ) VALUES (?, ?, ?, ?, '', 'Scheduler E2E', 'scheduler@example.com', ?, ?, ?, ?, ?, 0, ?)
    `).run(
      'scheduler-e2e-head-fact', imported.projectId, headSha, 'resume head commit', now,
      JSON.stringify([olderSha]), JSON.stringify(['resume-head.js']), JSON.stringify({ added: 1, deleted: 0, files: 1 }), now, generation,
    )
    db.prepare(`
      UPDATE git_sync_state SET
        status = 'syncing', error = '', backfillHeadSha = ?, backfillBaseSha = ?,
        backfillMode = 'incremental', backfillGeneration = ?, backfillOffset = 1,
        backfillTotal = 2, backfillInserted = 1, backfillStartedAt = ?, backfillUpdatedAt = ?
      WHERE projectId = ?
    `).run(headSha, fixture.headSha, generation, now, now, imported.projectId)
    db.prepare(`
      INSERT INTO background_tasks (
        id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      ) VALUES (?, 'git-sync-scheduled', ?, '', 'running', '继续回填 Git 历史 1/2', 50, '{}', 0, ?, ?)
    `).run('scheduler-e2e-interrupted-task', imported.projectId, now, now)
    db.close()

    const fastEnvironment = launchEnvironment(userDataDir, fixture.repository)
    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: fastEnvironment, timeout: 30_000 })
    const resumedPage = await electronApp.firstWindow()
    await expect(resumedPage.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()

    await expect.poll(async () => resumedPage.evaluate(async ({ projectId, shas }) => {
      const commits = await (window as any).vibe.git.list(projectId, { limit: 100 })
      return shas.every((sha: string) => commits.items.filter((commit: { sha: string }) => commit.sha === sha).length === 1)
    }, { projectId: imported.projectId, shas: [olderSha, headSha] }), { timeout: 20_000 }).toBe(true)
    await expect.poll(async () => resumedPage.evaluate(async projectId => {
      const tasks = await (window as any).vibe.tasks.list()
      return {
        interrupted: tasks.some((task: { id: string; status: string; canRetry: boolean }) => task.id === 'scheduler-e2e-interrupted-task' && task.status === 'interrupted' && task.canRetry),
        resumed: tasks.some((task: { kind: string; projectId: string; status: string; detail: string }) => task.kind === 'git-sync-scheduled' && task.projectId === projectId && task.status === 'completed' && task.detail.includes('已从断点继续完成')),
      }
    }, imported.projectId), { timeout: 15_000 }).toEqual({ interrupted: true, resumed: true })

    await electronApp.close()
    electronApp = null
    const verified = new DatabaseSync(path.join(userDataDir, 'vibetracker.db'), { readOnly: true })
    const state = verified.prepare(`
      SELECT status, lastSyncedSha, backfillGeneration, backfillOffset, backfillTotal
      FROM git_sync_state WHERE projectId = ?
    `).get(imported.projectId) as { status: string; lastSyncedSha: string; backfillGeneration: string; backfillOffset: number; backfillTotal: number }
    verified.close()
    expect(state).toEqual({ status: 'synced', lastSyncedSha: headSha, backfillGeneration: '', backfillOffset: 0, backfillTotal: 0 })
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
