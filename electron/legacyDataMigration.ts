import fs from 'node:fs'
import path from 'node:path'

export const VIBETRACKER_DB_FILENAME = 'vibetracker.db'
export const LEGACY_DB_FILENAME = 'devtracker.db'

export type LegacyMigrationReason = 'new-database-exists' | 'no-legacy-database'

export interface LegacyDataMigrationOptions {
  appDataPath: string
  userDataPath: string
  now?: Date
}

export interface LegacyDataMigrationResult {
  databaseMigrated: boolean
  configMigrated: boolean
  backupPaths: string[]
  sourceDatabasePath?: string
  sourceConfigPath?: string
  reason?: LegacyMigrationReason
}

interface LegacyDataSource {
  directory: string
  databasePath: string
  configPath?: string
  lastModifiedMs: number
}

const LEGACY_USER_DATA_DIR_NAMES = [
  'ai-tools-manager',
  'DevTracker',
  'AIToolsManager',
  'AI Tools Manager',
  'devtracker',
  'com.aitoolsmanager.app',
]
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm']

function formatTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('')
}

function uniquePath(filePath: string) {
  if (!fs.existsSync(filePath)) return filePath

  const parsed = path.parse(filePath)
  let index = 1
  let candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
  while (fs.existsSync(candidate)) {
    index += 1
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
  }
  return candidate
}

function getLegacyDirectories(appDataPath: string, userDataPath: string) {
  const newPath = path.resolve(userDataPath)
  return LEGACY_USER_DATA_DIR_NAMES
    .map(dirName => path.join(appDataPath, dirName))
    .filter(candidate => path.resolve(candidate) !== newPath)
}

function findNewestExistingFile(directories: string[], fileName: string) {
  let newest: { filePath: string; lastModifiedMs: number } | null = null
  for (const directory of directories) {
    const candidate = path.join(directory, fileName)
    if (fs.existsSync(candidate)) {
      const lastModifiedMs = fs.statSync(candidate).mtimeMs
      if (!newest || lastModifiedMs > newest.lastModifiedMs) {
        newest = { filePath: candidate, lastModifiedMs }
      }
    }
  }
  return newest?.filePath || null
}

function getSqliteSourceFiles(dbPath: string) {
  return [dbPath, ...SQLITE_SIDECAR_SUFFIXES.map(suffix => `${dbPath}${suffix}`)]
    .filter(filePath => fs.existsSync(filePath))
}

function getFileSnapshot(filePath: string) {
  const stat = fs.statSync(filePath)
  return { size: stat.size, mtimeMs: stat.mtimeMs }
}

function assertSourceFilesUnchanged(before: Map<string, { size: number; mtimeMs: number }>) {
  for (const [filePath, previous] of before) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Legacy database changed during migration: ${filePath} was removed`)
    }

    const current = getFileSnapshot(filePath)
    if (current.size !== previous.size || current.mtimeMs !== previous.mtimeMs) {
      throw new Error(`Legacy database changed during migration: ${filePath}`)
    }
  }
}

function findNewestLegacyDataSource(directories: string[]): LegacyDataSource | null {
  let newest: LegacyDataSource | null = null

  for (const directory of directories) {
    const databasePath = path.join(directory, LEGACY_DB_FILENAME)
    if (!fs.existsSync(databasePath)) continue

    const sourceFiles = getSqliteSourceFiles(databasePath)
    const lastModifiedMs = Math.max(...sourceFiles.map(filePath => fs.statSync(filePath).mtimeMs))
    const configPath = path.join(directory, 'config.json')
    const source = {
      directory,
      databasePath,
      configPath: fs.existsSync(configPath) ? configPath : undefined,
      lastModifiedMs,
    }

    if (!newest || source.lastModifiedMs > newest.lastModifiedMs) {
      newest = source
    }
  }

  return newest
}

function copyFileOrThrow(sourcePath: string, targetPath: string, label: string) {
  try {
    fs.copyFileSync(sourcePath, targetPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} failed: ${sourcePath} -> ${targetPath}: ${message}`)
  }
}

function cleanupSqliteFiles(dbPath: string) {
  for (const filePath of [dbPath, ...SQLITE_SIDECAR_SUFFIXES.map(suffix => `${dbPath}${suffix}`)]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
    }
  }
}

function copySqliteFiles(sourceDbPath: string, targetDbPath: string, label: string) {
  const copiedPaths: string[] = []
  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true })
  const sourceSnapshots = new Map(
    getSqliteSourceFiles(sourceDbPath).map(filePath => [filePath, getFileSnapshot(filePath)])
  )

  copyFileOrThrow(sourceDbPath, targetDbPath, label)
  copiedPaths.push(targetDbPath)

  const sourceSize = fs.statSync(sourceDbPath).size
  const targetSize = fs.statSync(targetDbPath).size
  if (sourceSize !== targetSize) {
    throw new Error(`${label} failed: copied size mismatch (${sourceSize} -> ${targetSize})`)
  }

  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sourceSidecarPath = `${sourceDbPath}${suffix}`
    if (!fs.existsSync(sourceSidecarPath)) continue

    const targetSidecarPath = `${targetDbPath}${suffix}`
    copyFileOrThrow(sourceSidecarPath, targetSidecarPath, `${label} ${suffix}`)
    copiedPaths.push(targetSidecarPath)
  }

  assertSourceFilesUnchanged(sourceSnapshots)

  return copiedPaths
}

function publishSqliteFiles(tempDbPath: string, targetDbPath: string) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const tempSidecarPath = `${tempDbPath}${suffix}`
    if (fs.existsSync(tempSidecarPath)) {
      fs.renameSync(tempSidecarPath, `${targetDbPath}${suffix}`)
    }
  }
  fs.renameSync(tempDbPath, targetDbPath)
}

export function migrateLegacyUserData(options: LegacyDataMigrationOptions): LegacyDataMigrationResult {
  const { appDataPath, userDataPath, now = new Date() } = options
  const backupPaths: string[] = []
  const legacyDirectories = getLegacyDirectories(appDataPath, userDataPath)

  fs.mkdirSync(userDataPath, { recursive: true })

  const newDbPath = path.join(userDataPath, VIBETRACKER_DB_FILENAME)
  const legacySource = findNewestLegacyDataSource(legacyDirectories)
  const legacyDbPath = legacySource?.databasePath || null
  const legacyConfigPath = legacySource?.configPath || (!legacySource ? findNewestExistingFile(legacyDirectories, 'config.json') : null)

  let databaseMigrated = false
  let reason: LegacyMigrationReason | undefined

  if (fs.existsSync(newDbPath)) {
    reason = 'new-database-exists'
  } else if (legacyDbPath) {
    const timestamp = formatTimestamp(now)
    const preCopyBackupPath = uniquePath(path.join(userDataPath, `vibetracker-migration-backup-${timestamp}.db`))
    const postCopyBackupPath = uniquePath(path.join(userDataPath, `vibetracker-migration-backup-${timestamp}-postcopy.db`))
    const tempDbPath = uniquePath(path.join(userDataPath, `vibetracker-migration-${timestamp}-${process.pid}.tmp.db`))

    try {
      for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
        fs.rmSync(`${newDbPath}${suffix}`, { force: true })
      }

      backupPaths.push(...copySqliteFiles(legacyDbPath, preCopyBackupPath, 'Legacy database backup'))
      copySqliteFiles(legacyDbPath, tempDbPath, 'Legacy database migration')
      backupPaths.push(...copySqliteFiles(tempDbPath, postCopyBackupPath, 'Migrated database backup'))
      publishSqliteFiles(tempDbPath, newDbPath)
      databaseMigrated = true
    } catch (error) {
      cleanupSqliteFiles(tempDbPath)
      cleanupSqliteFiles(newDbPath)

      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Legacy database migration failed: ${message}`)
    }
  } else {
    reason = 'no-legacy-database'
  }

  const newConfigPath = path.join(userDataPath, 'config.json')
  let configMigrated = false
  if (!fs.existsSync(newConfigPath) && legacyConfigPath) {
    copyFileOrThrow(legacyConfigPath, newConfigPath, 'Legacy config migration')
    configMigrated = true
  }

  return {
    databaseMigrated,
    configMigrated,
    backupPaths,
    sourceDatabasePath: legacyDbPath || undefined,
    sourceConfigPath: legacyConfigPath || undefined,
    reason,
  }
}
