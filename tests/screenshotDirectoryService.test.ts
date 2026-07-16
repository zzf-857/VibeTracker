import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AssetService, deleteRecordAndManagedAssets } from '../electron/services/assetService.ts'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'
import { ScreenshotDirectoryService } from '../electron/services/screenshotDirectoryService.ts'
import { SettingsService } from '../electron/services/settingsService.ts'

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString('utf8'),
}

function createFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const userData = path.join(root, 'user-data')
  const oldDirectory = path.join(root, 'old-screenshots')
  const targetDirectory = path.join(root, 'new-screenshots')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(oldDirectory, { recursive: true })
  const dbPath = path.join(userData, 'test.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  migrateDatabase(db, { dbPath })
  db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run('project-1', 'Screenshot migration', 1, 1)
  db.prepare(`
    INSERT INTO development_records (
      id, projectId, title, source, reviewStatus, createdAt, updatedAt
    ) VALUES (?, ?, ?, 'manual', 'accepted', ?, ?)
  `).run('record-1', 'project-1', 'Images', 1, 1)
  return { root, userData, oldDirectory, targetDirectory, dbPath, db }
}

test('screenshot directory migration moves only explicitly managed assets', async () => {
  const fixture = createFixture('vibetracker-screenshot-migration-')
  const managed = path.join(fixture.oldDirectory, 'managed.png')
  const external = path.join(fixture.oldDirectory, 'external-original.png')
  fs.writeFileSync(managed, 'managed image')
  fs.writeFileSync(external, 'user original')
  try {
    fixture.db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', ?, ?)
    `).run('image-managed', 'record-1', managed, 0, 1)
    fixture.db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', ?, ?)
    `).run('image-external', 'record-1', external, 1, 1)
    fixture.db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'screenshot', ?)
    `).run('asset-managed', 'project-1', 'record-1', managed, 1)

    const settings = new SettingsService(fixture.userData, fakeStorage)
    await settings.setScreenshotsDirectory(fixture.oldDirectory)
    const service = new ScreenshotDirectoryService(fixture.db as never, settings, fixture.userData)
    await service.ready()
    const result = await service.migrateTo(fixture.targetDirectory)
    const migrated = path.join(fixture.targetDirectory, 'managed.png')

    assert.equal(result.moved, 1)
    assert.equal(result.cleanupFailures.length, 0)
    assert.equal(result.screenshotsDirectory, path.resolve(fixture.targetDirectory))
    assert.equal(fs.existsSync(managed), false)
    assert.equal(fs.readFileSync(migrated, 'utf8'), 'managed image')
    assert.equal(fs.readFileSync(external, 'utf8'), 'user original')
    assert.equal(
      (fixture.db.prepare('SELECT path FROM managed_assets WHERE id = ?').get('asset-managed') as { path: string }).path,
      migrated,
    )
    assert.equal(
      (fixture.db.prepare('SELECT imagePath FROM development_record_images WHERE id = ?').get('image-external') as { imagePath: string }).imagePath,
      external,
    )

    const assets = new AssetService(fixture.db as never, settings)
    await assets.reconcileManagedAssets()
    assert.equal((fixture.db.prepare('SELECT COUNT(*) AS count FROM managed_assets').get() as { count: number }).count, 1)

    const deleted = await deleteRecordAndManagedAssets(fixture.db as never, 'record-1')
    assert.equal(deleted.assetFailures.length, 0)
    assert.equal(fs.existsSync(migrated), false)
    assert.equal(fs.readFileSync(external, 'utf8'), 'user original')
  } finally {
    fixture.db.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('settings write failure rolls database references back without moving the source', async () => {
  const fixture = createFixture('vibetracker-screenshot-rollback-')
  const managed = path.join(fixture.oldDirectory, 'managed.png')
  fs.writeFileSync(managed, 'managed image')
  try {
    fixture.db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', 0, ?)
    `).run('image-managed', 'record-1', managed, 1)
    fixture.db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'screenshot', ?)
    `).run('asset-managed', 'project-1', 'record-1', managed, 1)

    const settings = new SettingsService(fixture.userData, fakeStorage)
    await settings.setScreenshotsDirectory(fixture.oldDirectory)
    const setDirectory = settings.setScreenshotsDirectory.bind(settings)
    settings.setScreenshotsDirectory = async directory => {
      if (path.resolve(directory) === path.resolve(fixture.targetDirectory)) throw new Error('simulated config failure')
      return setDirectory(directory)
    }
    const service = new ScreenshotDirectoryService(fixture.db as never, settings, fixture.userData)
    await service.ready()
    await assert.rejects(() => service.migrateTo(fixture.targetDirectory), /迁移已回滚/)

    assert.equal(fs.readFileSync(managed, 'utf8'), 'managed image')
    assert.equal(fs.existsSync(path.join(fixture.targetDirectory, 'managed.png')), false)
    assert.equal(
      (fixture.db.prepare('SELECT imagePath FROM development_record_images WHERE id = ?').get('image-managed') as { imagePath: string }).imagePath,
      managed,
    )
    assert.equal((await settings.getPublic()).screenshotsDirectory, path.resolve(fixture.oldDirectory))
    assert.equal(fs.existsSync(path.join(fixture.userData, 'screenshot-directory-migration.json')), false)
  } finally {
    fixture.db.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('screenshot migration reports copy progress and cancellation keeps original references intact', async () => {
  const fixture = createFixture('vibetracker-screenshot-cancel-')
  const sources = ['one.png', 'two.png'].map(name => path.join(fixture.oldDirectory, name))
  sources.forEach((source, index) => fs.writeFileSync(source, `managed-${index}`))
  try {
    sources.forEach((source, index) => {
      fixture.db.prepare(`
        INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
        VALUES (?, ?, ?, '', ?, ?)
      `).run(`image-${index}`, 'record-1', source, index, index + 1)
      fixture.db.prepare(`
        INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
        VALUES (?, ?, ?, ?, 'screenshot', ?)
      `).run(`asset-${index}`, 'project-1', 'record-1', source, index + 1)
    })
    const settings = new SettingsService(fixture.userData, fakeStorage)
    await settings.setScreenshotsDirectory(fixture.oldDirectory)
    const service = new ScreenshotDirectoryService(fixture.db as never, settings, fixture.userData)
    await service.ready()
    const controller = new AbortController()
    const progress: number[] = []
    await assert.rejects(() => service.migrateTo(fixture.targetDirectory, {
      signal: controller.signal,
      onProgress: state => {
        progress.push(state.progress)
        if (state.phase === 'copying' && state.processed === 1) controller.abort()
      },
    }), /操作已取消/)

    assert.equal(progress.some(value => value > 10 && value < 100), true)
    assert.equal((await settings.getPublic()).screenshotsDirectory, path.resolve(fixture.oldDirectory))
    for (let index = 0; index < sources.length; index += 1) {
      assert.equal(fs.readFileSync(sources[index], 'utf8'), `managed-${index}`)
      assert.equal(fs.existsSync(path.join(fixture.targetDirectory, path.basename(sources[index]))), false)
      assert.equal((fixture.db.prepare('SELECT imagePath FROM development_record_images WHERE id = ?').get(`image-${index}`) as { imagePath: string }).imagePath, sources[index])
    }
    assert.equal(fs.existsSync(path.join(fixture.userData, 'screenshot-directory-migration.json')), false)
  } finally {
    fixture.db.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('startup recovery completes a copied migration after the database transaction committed', async () => {
  const fixture = createFixture('vibetracker-screenshot-recovery-')
  const source = path.join(fixture.oldDirectory, 'managed.png')
  const target = path.join(fixture.targetDirectory, 'managed.png')
  fs.mkdirSync(fixture.targetDirectory, { recursive: true })
  fs.writeFileSync(source, 'managed image')
  fs.copyFileSync(source, target)
  try {
    fixture.db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', 0, ?)
    `).run('image-managed', 'record-1', target, 1)
    fixture.db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'screenshot', ?)
    `).run('asset-managed', 'project-1', 'record-1', target, 1)
    fs.writeFileSync(path.join(fixture.userData, 'screenshot-directory-migration.json'), JSON.stringify({
      version: 1,
      oldDirectory: fixture.oldDirectory,
      targetDirectory: fixture.targetDirectory,
      moves: [{ assetId: 'asset-managed', sourcePath: source, targetPath: target }],
      createdAt: Date.now(),
    }))

    const settings = new SettingsService(fixture.userData, fakeStorage)
    await settings.setScreenshotsDirectory(fixture.oldDirectory)
    const service = new ScreenshotDirectoryService(fixture.db as never, settings, fixture.userData)
    await service.ready()

    assert.equal((await settings.getPublic()).screenshotsDirectory, path.resolve(fixture.targetDirectory))
    assert.equal(fs.existsSync(source), false)
    assert.equal(fs.readFileSync(target, 'utf8'), 'managed image')
    assert.equal(fs.existsSync(path.join(fixture.userData, 'screenshot-directory-migration.json')), false)
  } finally {
    fixture.db.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})
