import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function createLegacyDatabase(dbPath: string, projectPath: string, imagePath: string) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      path TEXT DEFAULT '',
      status TEXT DEFAULT 'developing',
      progress REAL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE project_commits (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      progressDelta REAL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE commit_images (
      id TEXT PRIMARY KEY,
      commitId TEXT NOT NULL,
      imagePath TEXT NOT NULL,
      caption TEXT DEFAULT '',
      sortIndex INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE project_tags (
      projectId TEXT,
      tagId TEXT,
      PRIMARY KEY (projectId, tagId)
    );
    CREATE TABLE noteblocks (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      content TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `)
  const createdAt = Date.now() - 10_000
  db.prepare(`
    INSERT INTO projects (id, name, description, path, status, progress, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'developing', 42, ?, ?)
  `).run('legacy-project', '旧版项目', '迁移前的项目简介', projectPath, createdAt, createdAt + 1_000)
  db.prepare(`
    INSERT INTO project_commits (id, projectId, title, description, progressDelta, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 7, ?, ?)
  `).run('legacy-record', 'legacy-project', '旧开发记录', '迁移后仍应可查看和编辑', createdAt + 2_000, createdAt + 3_000)
  db.prepare(`
    INSERT INTO commit_images (id, commitId, imagePath, caption, sortIndex, createdAt)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run('legacy-image', 'legacy-record', imagePath, '旧截图', createdAt + 2_500)
  db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
    .run('legacy-tag', '旧标签', '#74A9FF', createdAt)
  db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)')
    .run('legacy-project', 'legacy-tag')
  db.prepare('INSERT INTO noteblocks (id, projectId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-note', 'legacy-project', '旧版备注', createdAt, createdAt)
  db.prepare('INSERT INTO todos (id, projectId, content, completed, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
    .run('legacy-todo', 'legacy-project', '旧版待办', createdAt, createdAt)
  db.close()
}

test('旧数据库迁移后可在 Electron UI 查看、编辑并跨重启保留', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-legacy-ui-e2e-'))
  const appDataDir = path.join(tempRoot, 'app-data')
  const userDataDir = path.join(appDataDir, 'VibeTracker')
  const legacyDir = path.join(appDataDir, 'ai-tools-manager')
  const legacyProjectDir = path.join(tempRoot, 'legacy-project-files')
  const legacyImagePath = path.join(legacyProjectDir, 'legacy-preview.png')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.mkdir(legacyProjectDir, { recursive: true })
  await fs.writeFile(legacyImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=', 'base64'))
  const legacyDbPath = path.join(legacyDir, 'devtracker.db')
  createLegacyDatabase(legacyDbPath, legacyProjectDir, legacyImagePath)

  const launchEnvironment = {
    ...process.env,
    VITE_DEV_SERVER_URL: '',
    VIBETRACKER_APP_DATA_DIR: appDataDir,
    VIBETRACKER_USER_DATA_DIR: userDataDir,
    VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
  } as Record<string, string>
  let electronApp: ElectronApplication | null = null
  const rendererErrors: string[] = []

  try {
    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: launchEnvironment, timeout: 30_000 })
    let page = await electronApp.firstWindow()
    page.on('pageerror', error => rendererErrors.push(error.message))

    await page.getByRole('link', { name: '项目' }).click()
    const legacyCard = page.getByRole('article').filter({ hasText: '旧版项目' })
    await expect(legacyCard.getByText('旧开发记录', { exact: true })).toBeVisible()
    await expect(legacyCard.getByText('旧标签', { exact: true })).toBeVisible()
    await legacyCard.getByRole('button', { name: '打开项目 旧版项目' }).click()

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: /开发记录/ }).click()
    const legacyRecord = page.locator('#record-legacy-record')
    await expect(legacyRecord.getByText('旧开发记录', { exact: true })).toBeVisible()
    await expect(legacyRecord.getByText('手工', { exact: true })).toBeVisible()
    await expect(legacyRecord.getByText('旧截图', { exact: true })).toBeVisible()
    await legacyRecord.getByRole('button', { name: '编辑开发记录' }).click()
    await legacyRecord.getByLabel('编辑开发记录标题').fill('旧开发记录已编辑')
    await legacyRecord.getByLabel('编辑开发记录内容').fill('迁移后的正式记录可以继续编辑。')
    await legacyRecord.getByRole('button', { name: '保存开发记录' }).click()
    await expect(legacyRecord.getByText('旧开发记录已编辑', { exact: true })).toBeVisible()

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: '备注与待办' }).click()
    await expect(page.getByText('旧版备注', { exact: true })).toBeVisible()
    await expect(page.getByText('旧版待办', { exact: true })).toBeVisible()

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: '项目设置' }).click()
    const projectSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '项目资料' }) })
    await projectSection.getByLabel('名称').fill('旧版项目已编辑')
    await projectSection.getByLabel('简介').fill('迁移后通过最终界面完成编辑。')
    await projectSection.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('项目设置已保存', { exact: true })).toBeVisible()

    await electronApp.close()
    electronApp = null

    electronApp = await electron.launch({ cwd: process.cwd(), args: ['.'], env: launchEnvironment, timeout: 30_000 })
    page = await electronApp.firstWindow()
    page.on('pageerror', error => rendererErrors.push(error.message))
    await page.getByRole('link', { name: '项目' }).click()
    const editedCard = page.getByRole('article').filter({ hasText: '旧版项目已编辑' })
    await expect(editedCard.getByText('旧开发记录已编辑', { exact: true })).toBeVisible()
    await editedCard.getByRole('button', { name: '打开项目 旧版项目已编辑' }).click()
    await expect(page.getByText('迁移后通过最终界面完成编辑。', { exact: true }).first()).toBeVisible()
    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: /开发记录/ }).click()
    await expect(page.locator('#record-legacy-record').getByText('旧开发记录已编辑', { exact: true })).toBeVisible()
    await expect(page.locator('#record-legacy-record').getByText('旧截图', { exact: true })).toBeVisible()
    expect(rendererErrors).toEqual([])

    await electronApp.close()
    electronApp = null

    const migratedDbPath = path.join(userDataDir, 'vibetracker.db')
    const migratedDb = new DatabaseSync(migratedDbPath, { readOnly: true })
    const project = migratedDb.prepare('SELECT name, description FROM projects WHERE id = ?').get('legacy-project') as {
      name: string
      description: string
    }
    const record = migratedDb.prepare('SELECT title, source, reviewStatus FROM development_records WHERE id = ?').get('legacy-record') as {
      title: string
      source: string
      reviewStatus: string
    }
    migratedDb.close()
    expect(project).toEqual({ name: '旧版项目已编辑', description: '迁移后通过最终界面完成编辑。' })
    expect(record).toEqual({ title: '旧开发记录已编辑', source: 'manual', reviewStatus: 'accepted' })
    await expect(fs.stat(legacyImagePath)).resolves.toBeTruthy()
    await expect(fs.stat(legacyDbPath)).resolves.toBeTruthy()
    const backupNames = await fs.readdir(userDataDir)
    expect(backupNames.some(name => name.startsWith('vibetracker-migration-backup-'))).toBe(true)
    expect(backupNames.some(name => name.includes('-pre-schema-'))).toBe(true)
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
