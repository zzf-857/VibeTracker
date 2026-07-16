import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function createBackup(dbPath: string, projectPath: string) {
  const db = new DatabaseSync(dbPath)
  const now = Date.now()
  db.exec(`
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
  `)
  db.prepare(`
    INSERT INTO projects (id, name, description, path, status, progress, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'developing', 0, ?, ?)
  `).run('recovered-project', '从备份恢复的项目', '数据库恢复页已完成闭环', projectPath, now, now)
  db.close()
}

test('数据库损坏时显示恢复页，并隔离原库后从校验通过的备份恢复', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-database-recovery-e2e-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  const projectDir = path.join(tempRoot, 'project')
  const dbPath = path.join(userDataDir, 'vibetracker.db')
  const backupPath = path.join(userDataDir, 'vibetracker-pre-schema-20260716-020000.db')
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(dbPath, Buffer.from('this is intentionally not a sqlite database'))
  createBackup(backupPath, projectDir)

  let electronApp: ElectronApplication | null = null
  try {
    electronApp = await electron.launch({
      cwd: process.cwd(),
      args: ['.'],
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        VIBETRACKER_USER_DATA_DIR: userDataDir,
        VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
        VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
      } as Record<string, string>,
      timeout: 30_000,
    })

    const recoveryPage = await electronApp.firstWindow()
    await expect(recoveryPage.getByRole('heading', { name: 'VibeTracker 无法打开本地数据库' })).toBeVisible()
    await expect(recoveryPage.getByText('vibetracker-pre-schema-20260716-020000.db', { exact: false })).toBeVisible()
    await expect(recoveryPage.getByText(/VibeTracker 数据库启动失败/)).toBeVisible()

    const mainWindowPromise = electronApp.waitForEvent('window')
    await recoveryPage.getByRole('link', { name: '从最新备份恢复并重试' }).click()
    const page = await mainWindowPromise
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '项目' }).click()
    await expect(page.getByRole('button', { name: '打开项目 从备份恢复的项目' })).toBeVisible()

    const names = await fs.readdir(userDataDir)
    expect(names).toContain(path.basename(backupPath))
    expect(names.some(name => name.startsWith('vibetracker-failed-startup-') && name.endsWith('.db'))).toBe(true)
    await expect(fs.stat(dbPath)).resolves.toBeTruthy()
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
