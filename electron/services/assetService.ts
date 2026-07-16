import fs from 'node:fs/promises'
import path from 'node:path'
import type { SqliteDatabase } from './databaseMigrations'
import type { SettingsService } from './settingsService'

function managedPaths(db: SqliteDatabase, where: 'projectId' | 'recordId', id: string) {
  if (where === 'recordId') {
    return (db.prepare(`
      SELECT DISTINCT ma.path
      FROM managed_assets ma
      WHERE ma.recordId = ? OR EXISTS (
        SELECT 1 FROM development_record_images dri
        WHERE dri.recordId = ? AND dri.imagePath = ma.path
      )
    `).all(id, id) as Array<{ path: string }>).map(row => row.path)
  }
  return (db.prepare(`
    SELECT DISTINCT ma.path
    FROM managed_assets ma
    WHERE ma.projectId = ? OR EXISTS (
      SELECT 1 FROM projects p WHERE p.id = ? AND p.coverImagePath = ma.path
    ) OR EXISTS (
      SELECT 1 FROM development_record_images dri
      JOIN development_records dr ON dr.id = dri.recordId
      WHERE dr.projectId = ? AND dri.imagePath = ma.path
    )
  `).all(id, id, id) as Array<{ path: string }>).map(row => row.path)
}

function runTransaction<T>(db: SqliteDatabase, action: () => T): T {
  if (db.transaction) return db.transaction(action)()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function removeFiles(paths: string[]) {
  const failures: Array<{ path: string; reason: string }> = []
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') failures.push({ path: filePath, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return failures
}

function findRemainingReference(db: SqliteDatabase, filePath: string) {
  const record = db.prepare(`
    SELECT dr.projectId, dr.id AS recordId
    FROM development_record_images dri JOIN development_records dr ON dr.id = dri.recordId
    WHERE dri.imagePath = ? LIMIT 1
  `).get(filePath) as { projectId: string; recordId: string } | undefined
  if (record) return record
  const cover = db.prepare('SELECT id AS projectId FROM projects WHERE coverImagePath = ? LIMIT 1').get(filePath) as { projectId: string } | undefined
  return cover ? { projectId: cover.projectId, recordId: null } : null
}

async function removeUnreferencedManagedFiles(db: SqliteDatabase, paths: string[]) {
  const restore = db.prepare(`
    INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
    VALUES (?, ?, ?, ?, 'screenshot', ?)
    ON CONFLICT(path) DO UPDATE SET projectId = excluded.projectId, recordId = excluded.recordId
  `)
  const failures: Array<{ path: string; reason: string }> = []
  for (const filePath of paths) {
    const reference = findRemainingReference(db, filePath)
    if (reference) restore.run(crypto.randomUUID(), reference.projectId, reference.recordId, filePath, Date.now())
    else {
      db.prepare('UPDATE managed_assets SET projectId = NULL, recordId = NULL WHERE path = ?').run(filePath)
      const failed = await removeFiles([filePath])
      if (failed.length) failures.push(...failed)
      else db.prepare('DELETE FROM managed_assets WHERE path = ?').run(filePath)
    }
  }
  return failures
}

export async function deleteProjectAndManagedAssets(db: SqliteDatabase, projectId: string) {
  const paths = managedPaths(db, 'projectId', projectId)
  const deleted = runTransaction(db, () => {
    db.prepare('UPDATE managed_assets SET projectId = NULL, recordId = NULL WHERE projectId = ?').run(projectId)
    return (db.prepare('DELETE FROM projects WHERE id = ?').run(projectId) as { changes: number }).changes > 0
  })
  return { deleted, assetFailures: await removeUnreferencedManagedFiles(db, paths) }
}

export async function deleteRecordAndManagedAssets(db: SqliteDatabase, recordId: string) {
  const paths = managedPaths(db, 'recordId', recordId)
  const record = db.prepare(`
    SELECT projectId FROM development_records WHERE id = ?
  `).get(recordId) as { projectId: string } | undefined
  const trackedShas = db.prepare(`
    SELECT projectId, gitSha FROM git_commit_tracking WHERE handledByRecordId = ?
  `).all(recordId) as Array<{ projectId: string; gitSha: string }>
  const deleted = runTransaction(db, () => {
    db.prepare('UPDATE managed_assets SET projectId = NULL, recordId = NULL WHERE recordId = ?').run(recordId)
    const removed = (db.prepare('DELETE FROM development_records WHERE id = ?').run(recordId) as { changes: number }).changes > 0
    if (removed) {
      const findReplacement = db.prepare(`
        SELECT dr.id FROM development_records dr
        JOIN development_record_git_commits link ON link.recordId = dr.id
        WHERE dr.projectId = ? AND link.gitSha = ? AND dr.reviewStatus = 'accepted'
        ORDER BY dr.updatedAt DESC LIMIT 1
      `)
      const updateTracking = db.prepare(`
        UPDATE git_commit_tracking SET disposition = ?, handledByRecordId = ?, updatedAt = ?
        WHERE projectId = ? AND gitSha = ?
      `)
      const now = Date.now()
      if (record) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
      for (const tracked of trackedShas) {
        const replacement = findReplacement.get(tracked.projectId, tracked.gitSha) as { id: string } | undefined
        updateTracking.run(replacement ? 'handled' : 'pending', replacement?.id || null, now, tracked.projectId, tracked.gitSha)
      }
    }
    return removed
  })
  return { deleted, assetFailures: await removeUnreferencedManagedFiles(db, paths) }
}

export class AssetService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: SettingsService,
  ) {}

  async saveImageData(dataUrl: string, fileName = 'image.png') {
    if (dataUrl.length > 30 * 1024 * 1024) throw new Error('图片数据超过 30 MB 限制')
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,([A-Za-z0-9+/=]+)$/i)
    if (!match) throw new Error('图片数据格式无效')
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
    const buffer = Buffer.from(match[2], 'base64')
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('图片文件为空或超过 20 MB')
    const settings = await this.settings.getPublic()
    const directory = path.resolve(settings.screenshotsDirectory)
    await fs.mkdir(directory, { recursive: true })
    const safeStem = path.basename(fileName, path.extname(fileName)).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image'
    const filePath = path.join(directory, `${Date.now()}-${safeStem}-${crypto.randomUUID()}.${extension}`)
    await fs.writeFile(filePath, buffer, { flag: 'wx' })
    try {
      this.db.prepare(`
        INSERT INTO managed_assets (id, path, kind, createdAt) VALUES (?, ?, 'screenshot', ?)
      `).run(crypto.randomUUID(), filePath, Date.now())
    } catch (error) {
      await fs.unlink(filePath).catch(() => undefined)
      throw error
    }
    return filePath
  }

  attachToRecord(filePath: string, projectId: string, recordId: string) {
    const record = this.db.prepare(`
      SELECT projectId FROM development_records
      WHERE id = ? AND reviewStatus = 'accepted'
    `).get(recordId) as { projectId: string } | undefined
    if (!record || record.projectId !== projectId) throw new Error('正式开发记录不存在或不属于该项目')
    this.db.prepare('UPDATE managed_assets SET projectId = ?, recordId = ? WHERE path = ?').run(projectId, recordId, filePath)
  }

  async reconcileManagedAssets() {
    // Ownership is established only when VibeTracker itself creates a file in
    // saveImageData(). Merely living under the configured screenshots directory
    // is not proof that an image is application-managed: users may deliberately
    // point the setting at an existing photo folder.
    // Re-evaluate every tracked path so stale ownership left by older versions or
    // an interrupted cover/record update is repaired from the actual references.
    const tracked = (this.db.prepare(`
      SELECT path FROM managed_assets
    `).all() as Array<{ path: string }>).map(item => item.path)
    return this.reconcileManagedPaths(tracked)
  }

  async reconcileManagedPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.filter(Boolean))]
    if (!uniquePaths.length) return []
    const cleanupPaths = runTransaction(this.db, () => {
      const pending: string[] = []
      for (const filePath of uniquePaths) {
        const managed = this.db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(filePath)
        if (!managed) continue
        const reference = findRemainingReference(this.db, filePath)
        if (reference) {
          this.db.prepare(`
            UPDATE managed_assets SET projectId = ?, recordId = ? WHERE path = ?
          `).run(reference.projectId, reference.recordId, filePath)
        } else {
          this.db.prepare(`
            UPDATE managed_assets SET projectId = NULL, recordId = NULL WHERE path = ?
          `).run(filePath)
          pending.push(filePath)
        }
      }
      return pending
    })
    return removeUnreferencedManagedFiles(this.db, cleanupPaths)
  }

  async deleteProject(projectId: string) {
    return deleteProjectAndManagedAssets(this.db, projectId)
  }

  async deleteRecord(recordId: string) {
    return deleteRecordAndManagedAssets(this.db, recordId)
  }

  async deleteRecordImage(recordId: string, imageId: string, now?: number): Promise<{
    deleted: boolean; assetFailures: Array<{ path: string; reason: string }>;
  }>
  async deleteRecordImage(imageId: string): Promise<{
    deleted: boolean; assetFailures: Array<{ path: string; reason: string }>;
  }>
  async deleteRecordImage(recordIdOrImageId: string, imageIdValue?: string, nowValue = Date.now()) {
    let recordId = recordIdOrImageId
    let imageId = imageIdValue
    if (imageId === undefined) {
      imageId = recordIdOrImageId
      const legacyTarget = this.db.prepare(`
        SELECT dri.recordId
        FROM development_record_images dri
        JOIN development_records dr ON dr.id = dri.recordId
        WHERE dri.id = ? AND dr.reviewStatus = 'accepted'
      `).get(imageId) as { recordId: string } | undefined
      if (!legacyTarget) throw new Error('正式开发记录图片不存在或尚未通过审核')
      recordId = legacyTarget.recordId
    }
    if (!recordId || !imageId) throw new Error('开发记录图片参数无效')
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) throw new Error('图片时间无效')
    const deleted = runTransaction(this.db, () => {
      const image = this.db.prepare(`
        SELECT dri.imagePath, dr.projectId
        FROM development_record_images dri
        JOIN development_records dr ON dr.id = dri.recordId
        WHERE dri.id = ? AND dri.recordId = ? AND dr.reviewStatus = 'accepted'
      `).get(imageId, recordId) as { imagePath: string; projectId: string } | undefined
      if (!image) throw new Error('图片不属于该正式开发记录')
      const result = this.db.prepare(`
        DELETE FROM development_record_images WHERE id = ? AND recordId = ?
      `).run(imageId, recordId) as { changes: number }
      if (result.changes === 0) throw new Error('开发记录图片删除失败')
      this.db.prepare('UPDATE development_records SET updatedAt = ? WHERE id = ?').run(nowValue, recordId)
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(nowValue, image.projectId)

      let cleanupPath = ''
      const managed = this.db.prepare('SELECT 1 FROM managed_assets WHERE path = ?').get(image.imagePath)
      if (managed) {
        const reference = findRemainingReference(this.db, image.imagePath)
        if (reference) {
          this.db.prepare(`
            UPDATE managed_assets SET projectId = ?, recordId = ? WHERE path = ?
          `).run(reference.projectId, reference.recordId, image.imagePath)
        } else {
          this.db.prepare(`
            UPDATE managed_assets SET projectId = NULL, recordId = NULL WHERE path = ?
          `).run(image.imagePath)
          cleanupPath = image.imagePath
        }
      }
      return { cleanupPath }
    })
    const assetFailures = deleted.cleanupPath
      ? await removeUnreferencedManagedFiles(this.db, [deleted.cleanupPath])
      : []
    return { deleted: true, assetFailures }
  }
}
