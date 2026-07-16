import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AssetService, deleteProjectAndManagedAssets, deleteRecordAndManagedAssets } from '../electron/services/assetService.ts'
import {
  authorizeAssetPathForPersistence,
  authorizeAssetPaths,
  isAssetPathAllowed,
} from '../electron/services/assetPolicy.ts'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'

test('deleting a project removes only application-managed assets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-assets-'))
  const dbPath = path.join(directory, 'test.db')
  const managedPath = path.join(directory, 'managed.png')
  const sharedPath = path.join(directory, 'shared.png')
  const externalPath = path.join(directory, 'external.png')
  fs.writeFileSync(managedPath, 'managed')
  fs.writeFileSync(sharedPath, 'shared')
  fs.writeFileSync(externalPath, 'external')
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, coverImagePath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('project-1', 'Assets', externalPath, 1, 1)
    db.prepare('INSERT INTO projects (id, name, coverImagePath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('project-2', 'Shared', sharedPath, 1, 1)
    db.prepare('INSERT INTO managed_assets (id, projectId, path, kind, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('asset-1', 'project-1', managedPath, 'screenshot', 1)
    db.prepare('INSERT INTO managed_assets (id, projectId, path, kind, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('asset-2', 'project-1', sharedPath, 'screenshot', 1)
    const result = await deleteProjectAndManagedAssets(db, 'project-1')
    assert.equal(result.assetFailures.length, 0)
    assert.equal(fs.existsSync(managedPath), false)
    assert.equal(fs.existsSync(externalPath), true)
    assert.equal(fs.existsSync(sharedPath), true)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count, 1)
    assert.equal((db.prepare('SELECT projectId FROM managed_assets WHERE path = ?').get(sharedPath) as { projectId: string }).projectId, 'project-2')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('failed managed asset deletion remains tracked for a later cleanup retry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-assets-retry-'))
  const dbPath = path.join(directory, 'test.db')
  const blockedPath = path.join(directory, 'blocked.png')
  fs.mkdirSync(blockedPath)
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', 'Retry Assets', 1, 1)
    db.prepare('INSERT INTO managed_assets (id, projectId, path, kind, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('asset-1', 'project-1', blockedPath, 'screenshot', 1)
    const result = await deleteProjectAndManagedAssets(db, 'project-1')
    assert.equal(result.deleted, true)
    assert.equal(result.assetFailures.length, 1)
    assert.equal(fs.existsSync(blockedPath), true)
    const queued = db.prepare('SELECT projectId, recordId FROM managed_assets WHERE path = ?').get(blockedPath) as { projectId: string | null; recordId: string | null }
    assert.equal(queued.projectId, null)
    assert.equal(queued.recordId, null)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('local asset access is limited to project roots, persisted references, or short-lived previews', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-policy-'))
  const dbPath = path.join(directory, 'test.db')
  const projectRoot = path.join(directory, 'project')
  const outside = path.join(directory, 'outside.png')
  const preview = path.join(directory, 'preview.png')
  const referenced = path.join(directory, 'referenced.png')
  fs.mkdirSync(projectRoot)
  fs.writeFileSync(path.join(projectRoot, 'cover.png'), 'cover')
  fs.writeFileSync(outside, 'outside')
  fs.writeFileSync(preview, 'preview')
  fs.writeFileSync(referenced, 'referenced')
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, path, canonicalPath, coverImagePath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('project-1', 'Policy', projectRoot, projectRoot, referenced, 1, 1)
    assert.equal(isAssetPathAllowed(db as never, path.join(projectRoot, 'cover.png')), true)
    assert.equal(isAssetPathAllowed(db as never, referenced), true)
    assert.equal(isAssetPathAllowed(db as never, outside), false)
    authorizeAssetPaths([preview], 60_000)
    assert.equal(isAssetPathAllowed(db as never, preview), true)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('asset paths must be explicitly authorized before persistence unless they belong to the project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-persistence-'))
  const dbPath = path.join(directory, 'test.db')
  const projectRoot = path.join(directory, 'project')
  const projectImage = path.join(projectRoot, 'inside.png')
  const selectedImage = path.join(directory, 'selected.png')
  const externalImage = path.join(directory, 'external.png')
  const managedImage = path.join(directory, 'managed.png')
  fs.mkdirSync(projectRoot)
  for (const filePath of [projectImage, selectedImage, externalImage, managedImage]) {
    fs.writeFileSync(filePath, path.basename(filePath))
  }
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, path, canonicalPath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('project-1', 'Policy', projectRoot, projectRoot, 1, 1)
    db.prepare('INSERT INTO managed_assets (id, projectId, path, kind, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('managed-1', 'project-1', managedImage, 'screenshot', 1)

    assert.throws(
      () => authorizeAssetPathForPersistence(db as never, externalImage, { projectId: 'project-1' }),
      /图片路径未通过授权/,
    )
    assert.equal(
      authorizeAssetPathForPersistence(db as never, projectImage, { projectId: 'project-1' }),
      fs.realpathSync.native(projectImage),
    )
    assert.equal(
      authorizeAssetPathForPersistence(db as never, managedImage, { projectId: 'project-1' }),
      fs.realpathSync.native(managedImage),
    )

    authorizeAssetPaths([selectedImage], 60_000)
    assert.equal(
      authorizeAssetPathForPersistence(db as never, selectedImage, { projectId: 'project-1' }),
      fs.realpathSync.native(selectedImage),
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('managed asset aliases preserve their tracked path while new saves use canonical paths', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-alias-'))
  const dbPath = path.join(directory, 'test.db')
  const actualDirectory = path.join(directory, 'actual')
  const aliasDirectory = path.join(directory, 'alias')
  fs.mkdirSync(actualDirectory)
  try {
    fs.symlinkSync(actualDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      t.skip('当前 Windows 权限不允许创建目录联接')
      fs.rmSync(directory, { recursive: true, force: true })
      return
    }
    throw error
  }
  const trackedAlias = path.join(aliasDirectory, 'tracked.png')
  fs.writeFileSync(path.join(actualDirectory, 'tracked.png'), 'managed')
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    db.prepare(`
      INSERT INTO managed_assets (id, path, kind, createdAt) VALUES (?, ?, 'screenshot', ?)
    `).run('managed-alias', trackedAlias, 1)
    assert.equal(authorizeAssetPathForPersistence(db as never, trackedAlias), trackedAlias)

    const service = new AssetService(db as never, {
      getPublic: async () => ({ screenshotsDirectory: aliasDirectory }),
    } as never)
    const savedPath = await service.saveImageData(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=',
      'canonical.png',
    )
    assert.equal(savedPath, fs.realpathSync.native(savedPath))
    assert.equal(
      (db.prepare('SELECT path FROM managed_assets WHERE path = ?').get(savedPath) as { path: string }).path,
      savedPath,
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('asset persistence rejects missing, unsupported, and oversized files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-invalid-'))
  const dbPath = path.join(directory, 'test.db')
  const textFile = path.join(directory, 'not-an-image.txt')
  const oversized = path.join(directory, 'oversized.png')
  fs.writeFileSync(textFile, 'text')
  const oversizedHandle = fs.openSync(oversized, 'w')
  fs.ftruncateSync(oversizedHandle, 40 * 1024 * 1024 + 1)
  fs.closeSync(oversizedHandle)
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    for (const candidate of [path.join(directory, 'missing.png'), textFile, oversized]) {
      assert.throws(
        () => authorizeAssetPathForPersistence(db as never, candidate),
        /图片路径不存在、不是受支持的图片，或文件超过 40 MB/,
      )
    }
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a repository symlink or junction cannot authorize an image outside the project root', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-symlink-'))
  const dbPath = path.join(directory, 'test.db')
  const projectRoot = path.join(directory, 'project')
  const outsideRoot = path.join(directory, 'outside')
  const outsideImage = path.join(outsideRoot, 'outside.png')
  let linkedImage = path.join(projectRoot, 'linked.png')
  fs.mkdirSync(projectRoot)
  fs.mkdirSync(outsideRoot)
  fs.writeFileSync(outsideImage, 'outside')
  try {
    fs.symlinkSync(outsideImage, linkedImage, 'file')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      const linkedDirectory = path.join(projectRoot, 'linked-directory')
      try {
        fs.symlinkSync(outsideRoot, linkedDirectory, 'junction')
        linkedImage = path.join(linkedDirectory, 'outside.png')
      } catch (junctionError) {
        const junctionCode = (junctionError as NodeJS.ErrnoException).code
        if (junctionCode === 'EPERM' || junctionCode === 'EACCES') {
          t.skip('当前 Windows 权限不允许创建文件符号链接或目录联接')
          fs.rmSync(directory, { recursive: true, force: true })
          return
        }
        throw junctionError
      }
    } else {
      throw error
    }
  }

  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, path, canonicalPath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('project-1', 'Symlink Policy', projectRoot, projectRoot, 1, 1)
    assert.throws(
      () => authorizeAssetPathForPersistence(db as never, linkedImage, { projectId: 'project-1' }),
      /图片路径未通过授权/,
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('formal record image deletion validates ownership and cleans only unreferenced managed files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-record-images-'))
  const dbPath = path.join(directory, 'test.db')
  const managedPath = path.join(directory, 'managed.png')
  const externalPath = path.join(directory, 'external.png')
  const otherPath = path.join(directory, 'other.png')
  fs.writeFileSync(managedPath, 'managed')
  fs.writeFileSync(externalPath, 'external')
  fs.writeFileSync(otherPath, 'other')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    migrateDatabase(db, { dbPath })
    const insertProject = db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    insertProject.run('project-1', '图片资产', 1, 10)
    insertProject.run('project-2', '其他项目', 1, 10)
    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    insertRecord.run('record-1', 'project-1', '正式记录', 'manual', 'accepted', 20, 20)
    insertRecord.run('record-2', 'project-2', '其他记录', 'manual', 'accepted', 20, 20)
    insertRecord.run('draft-1', 'project-1', '待审核', 'ai', 'draft', 20, 20)
    const insertImage = db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', 0, 20)
    `)
    insertImage.run('managed-image', 'record-1', managedPath)
    insertImage.run('external-image', 'record-1', externalPath)
    insertImage.run('other-image', 'record-2', otherPath)
    insertImage.run('draft-image', 'draft-1', otherPath)
    db.prepare(`
      INSERT INTO managed_assets (id, path, kind, createdAt) VALUES (?, ?, 'screenshot', ?)
    `).run('managed-asset', managedPath, 1)

    const service = new AssetService(db as never, {} as never)
    service.attachToRecord(managedPath, 'project-1', 'record-1')
    assert.deepEqual({ ...(db.prepare(`
      SELECT projectId, recordId FROM managed_assets WHERE path = ?
    `).get(managedPath) as object) }, { projectId: 'project-1', recordId: 'record-1' })
    assert.throws(() => service.attachToRecord(managedPath, 'project-2', 'record-1'), /不属于该项目/)
    assert.throws(() => service.attachToRecord(managedPath, 'project-1', 'draft-1'), /不存在或不属于/)

    const managedResult = await service.deleteRecordImage('record-1', 'managed-image', 200)
    assert.deepEqual(managedResult, { deleted: true, assetFailures: [] })
    assert.equal(fs.existsSync(managedPath), false)
    assert.equal(db.prepare('SELECT 1 FROM development_record_images WHERE id = ?').get('managed-image'), undefined)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(managedPath), undefined)
    assert.deepEqual({ ...(db.prepare(`
      SELECT dr.updatedAt AS recordUpdatedAt, p.updatedAt AS projectUpdatedAt
      FROM development_records dr JOIN projects p ON p.id = dr.projectId WHERE dr.id = 'record-1'
    `).get() as object) }, { recordUpdatedAt: 200, projectUpdatedAt: 200 })

    const externalResult = await service.deleteRecordImage('record-1', 'external-image', 210)
    assert.deepEqual(externalResult, { deleted: true, assetFailures: [] })
    assert.equal(fs.existsSync(externalPath), true)
    assert.equal(db.prepare('SELECT 1 FROM development_record_images WHERE id = ?').get('external-image'), undefined)
    assert.deepEqual({ ...(db.prepare(`
      SELECT dr.updatedAt AS recordUpdatedAt, p.updatedAt AS projectUpdatedAt
      FROM development_records dr JOIN projects p ON p.id = dr.projectId WHERE dr.id = 'record-1'
    `).get() as object) }, { recordUpdatedAt: 210, projectUpdatedAt: 210 })

    await assert.rejects(() => service.deleteRecordImage('record-1', 'other-image', 220), /不属于/)
    await assert.rejects(() => service.deleteRecordImage('draft-1', 'draft-image', 220), /不属于/)
    assert.ok(db.prepare('SELECT 1 FROM development_record_images WHERE id = ?').get('other-image'))
    assert.ok(db.prepare('SELECT 1 FROM development_record_images WHERE id = ?').get('draft-image'))
    assert.equal(fs.existsSync(otherPath), true)
    assert.deepEqual({ ...(db.prepare(`
      SELECT dr.updatedAt AS recordUpdatedAt, p.updatedAt AS projectUpdatedAt
      FROM development_records dr JOIN projects p ON p.id = dr.projectId WHERE dr.id = 'record-1'
    `).get() as object) }, { recordUpdatedAt: 210, projectUpdatedAt: 210 })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('managed project covers attach immediately and replaced files are cleaned without breaking record references', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-cover-assets-'))
  const dbPath = path.join(directory, 'test.db')
  const oldCover = path.join(directory, 'old-cover.png')
  const nextCover = path.join(directory, 'next-cover.png')
  fs.writeFileSync(oldCover, 'old')
  fs.writeFileSync(nextCover, 'next')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    migrateDatabase(db, { dbPath })
    db.prepare(`
      INSERT INTO projects (id, name, coverImagePath, createdAt, updatedAt)
      VALUES ('project-1', '封面资产', ?, 1, 1)
    `).run(oldCover)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('record-1', 'project-1', '正式记录', 'manual', 'accepted', 1, 1)
    `).run()
    const insertAsset = db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'screenshot', 1)
    `)
    insertAsset.run('asset-old', 'project-1', null, oldCover)
    insertAsset.run('asset-next', null, null, nextCover)
    const service = new AssetService(db as never, {} as never)

    db.prepare(`UPDATE projects SET coverImagePath = ? WHERE id = 'project-1'`).run(nextCover)
    assert.deepEqual(await service.reconcileManagedPaths([oldCover, nextCover]), [])
    assert.equal(fs.existsSync(oldCover), false)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(oldCover), undefined)
    assert.deepEqual({ ...(db.prepare(`
      SELECT projectId, recordId FROM managed_assets WHERE path = ?
    `).get(nextCover) as object) }, { projectId: 'project-1', recordId: null })

    db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES ('image-next', 'record-1', ?, '', 0, 1)
    `).run(nextCover)
    db.prepare(`UPDATE projects SET coverImagePath = '' WHERE id = 'project-1'`).run()
    assert.deepEqual(await service.reconcileManagedPaths([nextCover]), [])
    assert.equal(fs.existsSync(nextCover), true)
    assert.deepEqual({ ...(db.prepare(`
      SELECT projectId, recordId FROM managed_assets WHERE path = ?
    `).get(nextCover) as object) }, { projectId: 'project-1', recordId: 'record-1' })

    db.prepare(`DELETE FROM development_record_images WHERE id = 'image-next'`).run()
    assert.deepEqual(await service.reconcileManagedPaths([nextCover]), [])
    assert.equal(fs.existsSync(nextCover), false)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(nextCover), undefined)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('startup asset reconciliation repairs stale ownership and removes only unreferenced tracked files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-asset-reconcile-'))
  const dbPath = path.join(directory, 'test.db')
  const referencedPath = path.join(directory, 'referenced.png')
  const stalePath = path.join(directory, 'stale.png')
  const externalPath = path.join(directory, 'external.png')
  fs.writeFileSync(referencedPath, 'referenced')
  fs.writeFileSync(stalePath, 'stale')
  fs.writeFileSync(externalPath, 'external')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    migrateDatabase(db, { dbPath })
    db.prepare(`
      INSERT INTO projects (id, name, createdAt, updatedAt) VALUES ('project-1', '恢复资产', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('record-1', 'project-1', '正式记录', 'manual', 'accepted', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES ('image-1', 'record-1', ?, '', 0, 1)
    `).run(referencedPath)
    const insertAsset = db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'screenshot', 1)
    `)
    insertAsset.run('asset-referenced', null, null, referencedPath)
    insertAsset.run('asset-stale', 'project-1', 'record-1', stalePath)

    const service = new AssetService(db as never, {} as never)
    assert.deepEqual(await service.reconcileManagedAssets(), [])
    assert.equal(fs.existsSync(referencedPath), true)
    assert.deepEqual({ ...(db.prepare(`
      SELECT projectId, recordId FROM managed_assets WHERE path = ?
    `).get(referencedPath) as object) }, { projectId: 'project-1', recordId: 'record-1' })
    assert.equal(fs.existsSync(stalePath), false)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(stalePath), undefined)
    assert.equal(fs.existsSync(externalPath), true)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('project and record deletion discover managed files from real references even when ownership is stale', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-stale-delete-assets-'))
  const dbPath = path.join(directory, 'test.db')
  const coverPath = path.join(directory, 'cover.png')
  const recordPath = path.join(directory, 'record.png')
  fs.writeFileSync(coverPath, 'cover')
  fs.writeFileSync(recordPath, 'record')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    migrateDatabase(db, { dbPath })
    db.prepare(`
      INSERT INTO projects (id, name, coverImagePath, createdAt, updatedAt)
      VALUES ('project-cover', '封面项目', ?, 1, 1)
    `).run(coverPath)
    db.prepare(`
      INSERT INTO projects (id, name, createdAt, updatedAt)
      VALUES ('project-record', '记录项目', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('record-1', 'project-record', '记录', 'manual', 'accepted', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES ('image-1', 'record-1', ?, '', 0, 1)
    `).run(recordPath)
    const insertAsset = db.prepare(`
      INSERT INTO managed_assets (id, path, kind, createdAt)
      VALUES (?, ?, 'screenshot', 1)
    `)
    insertAsset.run('asset-cover', coverPath)
    insertAsset.run('asset-record', recordPath)

    const recordResult = await deleteRecordAndManagedAssets(db as never, 'record-1')
    assert.deepEqual(recordResult, { deleted: true, assetFailures: [] })
    assert.equal(fs.existsSync(recordPath), false)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(recordPath), undefined)
    assert.ok((db.prepare(`
      SELECT updatedAt FROM projects WHERE id = 'project-record'
    `).get() as { updatedAt: number }).updatedAt > 1)

    const projectResult = await deleteProjectAndManagedAssets(db as never, 'project-cover')
    assert.deepEqual(projectResult, { deleted: true, assetFailures: [] })
    assert.equal(fs.existsSync(coverPath), false)
    assert.equal(db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(coverPath), undefined)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
