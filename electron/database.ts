import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import './appIdentity'
import { VIBETRACKER_DB_FILENAME, migrateLegacyUserData } from './legacyDataMigration'
import { migrateDatabase, type MigrationResult, type SqliteDatabase } from './services/databaseMigrations'

const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const
const DATABASE_BACKUP_NAME = /^vibetracker-(?:pre-schema|migration-backup)-.+\.db$/i

export interface DatabaseInitializationResult {
  db: Database.Database
  dbPath: string
  userDataPath: string
  schemaMigration: MigrationResult
}

export interface DatabaseBackupCandidate {
  path: string
  name: string
  modifiedAt: number
  size: number
}

function formatTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function uniquePath(candidate: string) {
  if (!fs.existsSync(candidate)) return candidate
  const parsed = path.parse(candidate)
  let suffix = 1
  let next = candidate
  while (fs.existsSync(next)) {
    next = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`)
    suffix += 1
  }
  return next
}

function assertIntegrity(db: Database.Database, check: 'quick_check' | 'integrity_check', label: string) {
  const rows = db.pragma(check) as Array<Record<string, unknown>>
  const values = rows.flatMap(row => Object.values(row)).map(value => String(value))
  if (!values.length || values.some(value => value.toLowerCase() !== 'ok')) {
    throw new Error(`${label}完整性检查失败：${values.join('；') || '没有返回检查结果'}`)
  }
}

function verifyDatabaseFile(filePath: string) {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    assertIntegrity(candidate, 'integrity_check', '数据库备份')
  } finally {
    candidate.close()
  }
}

export function getDatabasePaths() {
  const userDataPath = app.getPath('userData')
  return {
    userDataPath,
    dbPath: path.join(userDataPath, VIBETRACKER_DB_FILENAME),
  }
}

export function initializeDatabase(): DatabaseInitializationResult {
  const { userDataPath, dbPath } = getDatabasePaths()
  const migrationResult = process.env.VIBETRACKER_SKIP_LEGACY_MIGRATION === '1'
    ? { databaseMigrated: false, configMigrated: false, backupPaths: [], reason: 'no-legacy-database' as const }
    : migrateLegacyUserData({
        appDataPath: app.getPath('appData'),
        userDataPath,
      })

  if (migrationResult.databaseMigrated) {
    console.info('[DataMigration] Legacy database copied to VibeTracker userData:', {
      source: migrationResult.sourceDatabasePath,
      backups: migrationResult.backupPaths,
    })
  }

  if (migrationResult.configMigrated) {
    console.info('[DataMigration] Legacy config copied to VibeTracker userData:', {
      source: migrationResult.sourceConfigPath,
    })
  }

  fs.mkdirSync(userDataPath, { recursive: true })

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    assertIntegrity(db, 'quick_check', 'VibeTracker 数据库')

    const schemaMigration = migrateDatabase(db as unknown as SqliteDatabase, {
      dbPath,
      onBackup: backupPath => console.info('[Database] Pre-migration backup created:', backupPath),
    })
    if (schemaMigration.appliedVersions.length > 0) {
      console.info('[Database] Schema migrated:', schemaMigration)
    }
    if (schemaMigration.backupPath) verifyDatabaseFile(schemaMigration.backupPath)
    assertIntegrity(db, 'quick_check', '迁移后的 VibeTracker 数据库')

    return { db, dbPath, userDataPath, schemaMigration }
  } catch (error) {
    try { db?.close() } catch { /* preserve the original startup error */ }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`VibeTracker 数据库启动失败：${message}`, { cause: error })
  }
}

export function listDatabaseBackups(): DatabaseBackupCandidate[] {
  const { userDataPath } = getDatabasePaths()
  let names: string[] = []
  try { names = fs.readdirSync(userDataPath) } catch { return [] }
  const candidates: DatabaseBackupCandidate[] = []
  for (const name of names) {
    if (!DATABASE_BACKUP_NAME.test(name)) continue
    const candidatePath = path.join(userDataPath, name)
    try {
      const stat = fs.statSync(candidatePath)
      if (!stat.isFile()) continue
      candidates.push({ path: candidatePath, name, modifiedAt: stat.mtimeMs, size: stat.size })
    } catch { /* ignore a file that disappeared while listing */ }
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name))
}

export function restoreDatabaseBackup(backupPath: string) {
  const { userDataPath, dbPath } = getDatabasePaths()
  const resolvedBackup = path.resolve(backupPath)
  if (path.dirname(resolvedBackup).toLowerCase() !== path.resolve(userDataPath).toLowerCase()) {
    throw new Error('数据库备份不在 VibeTracker 数据目录中')
  }
  if (!DATABASE_BACKUP_NAME.test(path.basename(resolvedBackup))) {
    throw new Error('数据库备份文件名不受信任')
  }
  verifyDatabaseFile(resolvedBackup)

  const temporary = uniquePath(path.join(userDataPath, `vibetracker-restore-${process.pid}-${crypto.randomUUID()}.tmp.db`))
  fs.copyFileSync(resolvedBackup, temporary)
  try {
    verifyDatabaseFile(temporary)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }

  const quarantineBase = uniquePath(path.join(userDataPath, `vibetracker-failed-startup-${formatTimestamp()}.db`))
  const moved: Array<{ source: string; target: string }> = []
  try {
    for (const suffix of ['', ...SQLITE_SIDECAR_SUFFIXES]) {
      const source = `${dbPath}${suffix}`
      if (!fs.existsSync(source)) continue
      const target = `${quarantineBase}${suffix}`
      fs.renameSync(source, target)
      moved.push({ source, target })
    }
    fs.renameSync(temporary, dbPath)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    if (!fs.existsSync(dbPath)) {
      for (const entry of [...moved].reverse()) {
        if (fs.existsSync(entry.target) && !fs.existsSync(entry.source)) fs.renameSync(entry.target, entry.source)
      }
    }
    throw new Error(`数据库备份恢复失败，原数据库已保留：${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    restoredFrom: resolvedBackup,
    quarantinePath: moved.length ? quarantineBase : null,
    dbPath,
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildDatabaseRecoveryDocument(input: {
  error: string
  userDataPath: string
  backup?: DatabaseBackupCandidate | null
  restoreError?: string
}) {
  const backup = input.backup
  const restoreAction = backup
    ? `<a class="primary" href="vibe-recovery://restore">从最新备份恢复并重试</a>`
    : ''
  const backupSummary = backup
    ? `<p class="meta">最新备份：<strong>${escapeHtml(backup.name)}</strong><br>${new Date(backup.modifiedAt).toLocaleString('zh-CN')} · ${Math.max(1, Math.round(backup.size / 1024))} KB</p>`
    : '<p class="meta warning">当前数据目录中没有可用的自动备份。原数据库不会被删除。</p>'
  const restoreError = input.restoreError
    ? `<section class="restore-error"><strong>恢复未完成</strong><pre>${escapeHtml(input.restoreError)}</pre></section>`
    : ''
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VibeTracker 数据库恢复</title>
<style>
  :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif;background:#080a0d;color:#eef1f5}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at 15% 0%,rgba(116,169,255,.13),transparent 34%),linear-gradient(180deg,#101318,#080a0d 60%)}
  main{width:min(760px,100%);border:1px solid #303844;border-radius:18px;background:#11151a;padding:30px;box-shadow:0 28px 80px rgba(0,0,0,.32)}
  .eyebrow{color:#f3bb6c;font-size:13px;margin:0}h1{font-size:26px;margin:12px 0 0}p{color:#a8b0bd;line-height:1.7}.meta{padding:14px;border-radius:12px;background:#080a0d;border:1px solid #252b34;font-size:13px}.warning{color:#f3bb6c}
  pre{white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;background:#080a0d;border:1px solid #252b34;border-radius:12px;padding:14px;color:#f3bb6c;font-size:12px;line-height:1.6}
  .restore-error{margin-top:14px;color:#ff8c8c}.restore-error pre{color:#ffb0b0}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}a{min-height:42px;padding:0 15px;border-radius:10px;border:1px solid #3a4452;color:#d9dee7;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-size:14px}a:hover,a:focus-visible{outline:2px solid #74a9ff;outline-offset:2px}.primary{background:#eef1f5;color:#080a0d;border-color:#eef1f5;font-weight:650}.danger{margin-left:auto;color:#ff9b9b;border-color:#6a3434}
</style></head><body><main role="main"><p class="eyebrow">数据安全恢复</p><h1>VibeTracker 无法打开本地数据库</h1><p>应用已停止加载项目数据，避免继续写入异常数据库。恢复操作会先把当前数据库及 WAL/SHM 文件完整隔离，再复制经过完整性校验的备份；备份本身不会被移动或删除。</p>${backupSummary}${restoreError}<pre>${escapeHtml(input.error)}</pre><p class="meta">数据目录：${escapeHtml(input.userDataPath)}</p><nav class="actions" aria-label="数据库恢复操作">${restoreAction}<a href="vibe-recovery://retry">重新尝试启动</a><a href="vibe-recovery://open-data">打开数据目录</a><a class="danger" href="vibe-recovery://exit">退出应用</a></nav></main></body></html>`
}
