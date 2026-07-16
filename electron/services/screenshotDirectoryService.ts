import fs from 'node:fs/promises'
import path from 'node:path'
import type { PublicAppSettings } from './settingsService'
import type { SqliteDatabase } from './databaseMigrations'

interface ScreenshotSettingsStore {
  getPublic(): Promise<PublicAppSettings>
  setScreenshotsDirectory(directory: string): Promise<PublicAppSettings>
  getDefaultScreenshotsDirectory(): string
}

interface AssetMove {
  assetId: string
  sourcePath: string
  targetPath: string
}

interface MigrationJournal {
  version: 1
  oldDirectory: string
  targetDirectory: string
  moves: AssetMove[]
  createdAt: number
}

export interface ScreenshotDirectoryMigrationResult {
  screenshotsDirectory: string
  moved: number
  cleanupFailures: Array<{ path: string; reason: string }>
}

export interface ScreenshotDirectoryMigrationProgress {
  phase: 'planning' | 'copying' | 'database' | 'settings' | 'cleanup' | 'completed'
  processed: number
  total: number
  progress: number
  detail: string
}

interface ScreenshotDirectoryMigrationOptions {
  signal?: AbortSignal
  onProgress?: (progress: ScreenshotDirectoryMigrationProgress) => void
  onCommitStart?: () => void
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  throw error
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

function normalizePath(filePath: string) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right)
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function removeFiles(paths: string[]) {
  const failures: Array<{ path: string; reason: string }> = []
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        failures.push({ path: filePath, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return failures
}

export class ScreenshotDirectoryService {
  private readonly journalPath: string
  private recovery: Promise<void>
  private activeMigration: Promise<ScreenshotDirectoryMigrationResult> | null = null

  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: ScreenshotSettingsStore,
    private readonly userDataPath: string,
  ) {
    this.journalPath = path.join(userDataPath, 'screenshot-directory-migration.json')
    this.recovery = this.recoverPendingMigrationInternal()
  }

  ready() {
    return this.recovery
  }

  getDefaultDirectory() {
    return this.settings.getDefaultScreenshotsDirectory()
  }

  async migrateTo(targetDirectory: string, options: ScreenshotDirectoryMigrationOptions = {}) {
    if (this.activeMigration) return this.activeMigration
    const operation = this.performMigration(targetDirectory, options)
    this.activeMigration = operation
    operation.finally(() => {
      if (this.activeMigration === operation) this.activeMigration = null
    }).catch(() => undefined)
    return operation
  }

  private async performMigration(targetDirectory: string, options: ScreenshotDirectoryMigrationOptions): Promise<ScreenshotDirectoryMigrationResult> {
    const emit = (progress: ScreenshotDirectoryMigrationProgress) => {
      try { options.onProgress?.(progress) } catch (error) { console.error('[Assets] Screenshot migration progress observer failed:', error) }
    }
    throwIfAborted(options.signal)
    emit({ phase: 'planning', processed: 0, total: 0, progress: 2, detail: '正在检查托管图片与目标目录' })
    await this.recovery
    // A previous migration may have completed with only source cleanup pending.
    await this.recoverPendingMigrationInternal()
    const current = await this.settings.getPublic()
    const oldDirectory = path.resolve(current.screenshotsDirectory)
    const target = path.resolve(targetDirectory)
    await fs.mkdir(target, { recursive: true })
    const targetStat = await fs.stat(target)
    if (!targetStat.isDirectory()) throw new Error('新的截图保存位置不是文件夹')
    if (samePath(oldDirectory, target)) {
      emit({ phase: 'completed', processed: 0, total: 0, progress: 100, detail: '截图目录无需迁移' })
      return { screenshotsDirectory: target, moved: 0, cleanupFailures: [] }
    }

    const moves = await this.planMoves(oldDirectory, target, options.signal)
    throwIfAborted(options.signal)
    emit({ phase: 'planning', processed: 0, total: moves.length, progress: 10, detail: `发现 ${moves.length} 个托管文件需要迁移` })
    if (!moves.length) {
      throwIfAborted(options.signal)
      options.onCommitStart?.()
      const updated = await this.settings.setScreenshotsDirectory(target)
      emit({ phase: 'completed', processed: 0, total: 0, progress: 100, detail: '截图目录已更新，没有托管文件需要移动' })
      return { screenshotsDirectory: updated.screenshotsDirectory, moved: 0, cleanupFailures: [] }
    }

    const journal: MigrationJournal = {
      version: 1,
      oldDirectory,
      targetDirectory: target,
      moves,
      createdAt: Date.now(),
    }
    await this.writeJournal(journal)

    const copied: AssetMove[] = []
    try {
      for (const move of moves) {
        throwIfAborted(options.signal)
        await fs.mkdir(path.dirname(move.targetPath), { recursive: true })
        await fs.copyFile(move.sourcePath, move.targetPath)
        const [sourceStat, targetFileStat] = await Promise.all([fs.stat(move.sourcePath), fs.stat(move.targetPath)])
        if (!sourceStat.isFile() || !targetFileStat.isFile() || sourceStat.size !== targetFileStat.size) {
          throw new Error(`复制托管图片后校验失败: ${move.sourcePath}`)
        }
        copied.push(move)
        emit({
          phase: 'copying',
          processed: copied.length,
          total: moves.length,
          progress: 10 + Math.floor((copied.length / moves.length) * 65),
          detail: `正在复制托管文件 ${copied.length}/${moves.length}`,
        })
      }
      throwIfAborted(options.signal)
      options.onCommitStart?.()
    } catch (error) {
      const cleanupFailures = await removeFiles(copied.map(move => move.targetPath))
      if (!cleanupFailures.length) await this.removeJournal()
      throw new Error(`截图目录迁移未写入数据库，原文件保持不变：${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      emit({ phase: 'database', processed: moves.length, total: moves.length, progress: 82, detail: '正在原子更新图片引用' })
      this.updateDatabasePaths(moves, false)
    } catch (error) {
      const cleanupFailures = await removeFiles(copied.map(move => move.targetPath))
      if (!cleanupFailures.length) await this.removeJournal()
      throw new Error(`截图目录迁移数据库更新失败，原文件保持不变：${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      emit({ phase: 'settings', processed: moves.length, total: moves.length, progress: 90, detail: '正在保存新的截图目录' })
      await this.settings.setScreenshotsDirectory(target)
    } catch (error) {
      try {
        this.updateDatabasePaths(moves, true)
        const cleanupFailures = await removeFiles(copied.map(move => move.targetPath))
        if (!cleanupFailures.length) await this.removeJournal()
      } catch (rollbackError) {
        this.recovery = this.recoverPendingMigrationInternal()
        throw new Error(`截图目录设置失败，自动恢复也未完成；下次启动会继续恢复：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
      throw new Error(`截图目录设置失败，迁移已回滚：${error instanceof Error ? error.message : String(error)}`)
    }

    emit({ phase: 'cleanup', processed: moves.length, total: moves.length, progress: 96, detail: '正在清理已迁移的旧副本' })
    const cleanupFailures = await removeFiles(moves.map(move => move.sourcePath))
    if (!cleanupFailures.length) await this.removeJournal()
    emit({ phase: 'completed', processed: moves.length, total: moves.length, progress: 100, detail: `已迁移 ${moves.length} 个托管文件` })
    return { screenshotsDirectory: target, moved: moves.length, cleanupFailures }
  }

  private async planMoves(oldDirectory: string, targetDirectory: string, signal?: AbortSignal) {
    const rows = this.db.prepare(`
      SELECT ma.id AS assetId, ma.path AS sourcePath
      FROM managed_assets ma
      WHERE EXISTS (SELECT 1 FROM development_record_images dri WHERE dri.imagePath = ma.path)
         OR EXISTS (SELECT 1 FROM projects p WHERE p.coverImagePath = ma.path)
      ORDER BY ma.createdAt, ma.id
    `).all() as Array<{ assetId: string; sourcePath: string }>
    const reserved = new Set(
      (this.db.prepare('SELECT path FROM managed_assets').all() as Array<{ path: string }>).map(row => normalizePath(row.path)),
    )
    const planned = new Set<string>()
    const moves: AssetMove[] = []
    for (const row of rows) {
      throwIfAborted(signal)
      const sourcePath = path.resolve(row.sourcePath)
      const stat = await fs.stat(sourcePath).catch(() => null)
      if (!stat?.isFile()) continue
      const relative = isWithin(oldDirectory, sourcePath) ? path.relative(oldDirectory, sourcePath) : path.basename(sourcePath)
      let targetPath = path.resolve(targetDirectory, relative)
      if (samePath(sourcePath, targetPath)) continue
      const normalizedTarget = normalizePath(targetPath)
      if (reserved.has(normalizedTarget) || planned.has(normalizedTarget) || await fs.stat(targetPath).then(() => true).catch(() => false)) {
        const parsed = path.parse(targetPath)
        targetPath = path.join(parsed.dir, `${parsed.name}-${row.assetId}${parsed.ext}`)
      }
      planned.add(normalizePath(targetPath))
      moves.push({ assetId: row.assetId, sourcePath, targetPath })
    }
    return moves
  }

  private updateDatabasePaths(moves: AssetMove[], reverse: boolean) {
    const updateManaged = this.db.prepare('UPDATE managed_assets SET path = ? WHERE id = ? AND path = ?')
    const updateRecordImages = this.db.prepare('UPDATE development_record_images SET imagePath = ? WHERE imagePath = ?')
    const updateProjectCovers = this.db.prepare('UPDATE projects SET coverImagePath = ? WHERE coverImagePath = ?')
    runTransaction(this.db, () => {
      for (const move of moves) {
        const source = reverse ? move.targetPath : move.sourcePath
        const target = reverse ? move.sourcePath : move.targetPath
        updateRecordImages.run(target, source)
        updateProjectCovers.run(target, source)
        updateManaged.run(target, move.assetId, source)
      }
    })
  }

  private async recoverPendingMigrationInternal() {
    const journal = await this.readJournal()
    if (!journal) return
    const rows = journal.moves.map(move => this.db.prepare('SELECT path FROM managed_assets WHERE id = ?').get(move.assetId) as { path?: string } | undefined)
    const databaseUsesTargets = rows.some((row, index) => row?.path && samePath(row.path, journal.moves[index].targetPath))
    if (!databaseUsesTargets) {
      const current = await this.settings.getPublic()
      if (samePath(current.screenshotsDirectory, journal.targetDirectory)) {
        await this.settings.setScreenshotsDirectory(journal.oldDirectory)
      }
      const failures = await removeFiles(journal.moves.map(move => move.targetPath))
      if (!failures.length) await this.removeJournal()
      return
    }

    // The database transaction committed. Complete the forward migration rather
    // than risking references to files that have already moved.
    for (const move of journal.moves) {
      const targetExists = await fs.stat(move.targetPath).then(stat => stat.isFile()).catch(() => false)
      if (!targetExists) {
        const sourceExists = await fs.stat(move.sourcePath).then(stat => stat.isFile()).catch(() => false)
        if (!sourceExists) throw new Error(`无法恢复托管图片，源和目标都不存在: ${move.sourcePath}`)
        await fs.mkdir(path.dirname(move.targetPath), { recursive: true })
        await fs.copyFile(move.sourcePath, move.targetPath)
      }
    }
    await this.settings.setScreenshotsDirectory(journal.targetDirectory)
    const failures = await removeFiles(journal.moves.map(move => move.sourcePath))
    if (!failures.length) await this.removeJournal()
  }

  private async readJournal(): Promise<MigrationJournal | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.journalPath, 'utf8')) as MigrationJournal
      if (value.version !== 1 || !Array.isArray(value.moves)) throw new Error('截图目录迁移日志格式无效')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async writeJournal(journal: MigrationJournal) {
    await fs.mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.journalPath}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(journal, null, 2), 'utf8')
      await fs.rename(temporary, this.journalPath)
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async removeJournal() {
    await fs.unlink(this.journalPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}
