import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

test('后台任务历史跨重启水合，并将未完成任务标记为可重试中断', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-task-history-e2e-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  const environment = {
    ...process.env,
    VITE_DEV_SERVER_URL: '',
    VIBETRACKER_USER_DATA_DIR: userDataDir,
    VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
    VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
  } as Record<string, string>
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: environment, timeout: 30_000 })
    await expect((await electronApp.firstWindow()).getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await electronApp.close()
    electronApp = null

    const db = new DatabaseSync(path.join(userDataDir, 'vibetracker.db'))
    db.prepare(`
      INSERT INTO background_tasks (
        id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('task-interrupted', 'git-sync', 'missing-project', '', 'running', '正在扫描 Git', 42, '{}', 0, 10, 20)
    db.prepare(`
      INSERT INTO background_tasks (
        id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('task-completed', 'assets-migrate', '', '', 'completed', '已迁移 2 个托管文件', 100, '{}', 0, 11, 21)
    db.close()

    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: environment, timeout: 30_000 })
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    const history = await page.evaluate(async () => (window as any).vibe.tasks.list()) as Array<{ id: string; status: string; canRetry: boolean; progress?: number }>
    expect(history.find(task => task.id === 'task-interrupted')).toMatchObject({ status: 'interrupted', canRetry: true, progress: 42 })
    expect(history.find(task => task.id === 'task-completed')).toMatchObject({ status: 'completed', canRetry: false, progress: 100 })

    const taskCenter = page.getByRole('button', { name: /后台任务/ })
    await expect(taskCenter).toBeVisible()
    await expect(taskCenter).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('已中断', { exact: true })).toBeVisible()
    await expect(page.getByText(/应用上次退出时任务仍在运行/)).toBeVisible()
    await expect(page.getByText('已迁移 2 个托管文件', { exact: true })).toBeVisible()
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
