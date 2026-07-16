import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchProfileHash, type LaunchProfile } from '../electron/services/launchService'
import { migrateDatabase } from '../electron/services/databaseMigrations'

const appRoot = process.cwd()

function prepareDatabase(userDataDir: string) {
  const dbPath = path.join(userDataDir, 'vibetracker.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  migrateDatabase(db, { dbPath })
  const profile: LaunchProfile = {
    id: 'profile-launch-history',
    projectId: 'project-launch-history',
    name: '失败历史验证',
    executable: process.execPath,
    args: ['-e', "process.stderr.write('persisted-failure'); process.exit(7)"],
    cwd: appRoot,
    env: {},
    readyUrl: '',
    readyPort: null,
    enabled: true,
    validated: true,
    confirmedHash: '',
    createdAt: 1,
    updatedAt: 1,
  }
  profile.confirmedHash = launchProfileHash(profile)
  db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run(profile.projectId, 'Launch 历史项目', 1, 1)
  db.prepare(`
    INSERT INTO launch_profiles (
      id, projectId, name, executable, argsJson, cwd, envJson, readyUrl, readyPort,
      enabled, validated, confirmedHash, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.id, profile.projectId, profile.name, profile.executable, JSON.stringify(profile.args),
    profile.cwd, '{}', '', null, 1, 1, profile.confirmedHash, 1, 1,
  )
  db.close()
  return { dbPath, profile }
}

async function launchApp(userDataDir: string) {
  const app = await electron.launch({
    cwd: appRoot,
    args: ['.'],
    env: {
      ...process.env,
      VIBETRACKER_USER_DATA_DIR: userDataDir,
      VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
      VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
    } as Record<string, string>,
    timeout: 30_000,
  })
  return { app, page: await app.firstWindow() }
}

test('Launch 失败日志跨重启保留，异常退出运行恢复为不可误停止的诊断状态', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-launch-history-e2e-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  await fs.mkdir(userDataDir, { recursive: true })
  const { dbPath, profile } = prepareDatabase(userDataDir)
  let app: ElectronApplication | null = null

  try {
    let launched = await launchApp(userDataDir)
    app = launched.app
    await launched.page.evaluate(profileId => window.vibe.launch.start(profileId), profile.id)
    await expect.poll(() => launched.page.evaluate(async profileId => (await window.vibe.launch.status(profileId))?.state, profile.id))
      .toBe('failed')
    const failed = await launched.page.evaluate(profileId => window.vibe.launch.status(profileId), profile.id)
    expect(failed?.pid).toBeNull()
    expect(failed?.error).toContain('code=7')
    expect(failed?.logs.some(log => log.text.includes('persisted-failure'))).toBe(true)
    await app.close()
    app = null

    const afterFailure = new DatabaseSync(dbPath, { readOnly: true })
    const storedFailure = { ...(afterFailure.prepare(`
      SELECT state, pid, error, logsJson FROM launch_runs ORDER BY startedAt DESC LIMIT 1
    `).get() as object) } as { state: string; pid: number | null; error: string; logsJson: string }
    afterFailure.close()
    expect(storedFailure.state).toBe('failed')
    expect(storedFailure.pid).toBeNull()
    expect(storedFailure.logsJson).toContain('persisted-failure')

    launched = await launchApp(userDataDir)
    app = launched.app
    await expect(launched.page.getByText('启动失败', { exact: true })).toBeVisible()
    const restoredFailure = await launched.page.evaluate(profileId => window.vibe.launch.status(profileId), profile.id)
    expect(restoredFailure?.state).toBe('failed')
    expect(restoredFailure?.error).toContain('code=7')
    expect(restoredFailure?.logs.some(log => log.text.includes('persisted-failure'))).toBe(true)
    await app.close()
    app = null

    const db = new DatabaseSync(dbPath)
    const now = Date.now() + 10_000
    db.prepare(`
      INSERT INTO launch_runs (
        id, profileId, projectId, sessionId, commandHash, pid, state,
        startedAt, updatedAt, stoppedAt, error, logsJson
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, NULL, '', '[]')
    `).run(
      'run-interrupted', profile.id, profile.projectId, 'previous-session', profile.confirmedHash,
      99_999_999, now, now,
    )
    db.close()

    launched = await launchApp(userDataDir)
    app = launched.app
    const interrupted = await launched.page.evaluate(profileId => window.vibe.launch.status(profileId), profile.id)
    expect(interrupted?.state).toBe('failed')
    expect(interrupted?.pid).toBeNull()
    expect(interrupted?.error).toContain('原 PID 当前不存在')
    await expect(launched.page.getByText('启动失败', { exact: true })).toBeVisible()

    const recoveredDb = new DatabaseSync(dbPath, { readOnly: true })
    const recovered = { ...(recoveredDb.prepare('SELECT state, stoppedAt FROM launch_runs WHERE id = ?')
      .get('run-interrupted') as object) } as { state: string; stoppedAt: number | null }
    recoveredDb.close()
    expect(recovered.state).toBe('interrupted')
    expect(recovered.stoppedAt).not.toBeNull()
  } finally {
    await app?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
