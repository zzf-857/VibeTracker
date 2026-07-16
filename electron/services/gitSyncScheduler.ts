import type { SqliteDatabase } from './databaseMigrations'
import {
  DEFAULT_GIT_HISTORY_BATCH_SIZE,
  prepareGitScan,
  readGitCommitBatch,
  runGit,
  type GitRunner,
  type GitScanPlan,
  type GitSyncResult,
} from './gitService'
import {
  beginGitBackfill,
  completeGitBackfill,
  markGitSyncFailure,
  persistGitBackfillBatch,
  persistGitSync,
  ProjectGitOperationLock,
} from './gitRepository'

export type GitSyncReason = 'manual' | 'scheduled'
export interface GitSyncPersistenceResult {
  inserted: number
  scanned: number
  headSha: string
  cursorWasReset: boolean
  scanGeneration: string
  resumed?: boolean
  total?: number
}

export interface GitSyncStateEvent {
  projectId: string
  reason: GitSyncReason
  status: 'syncing' | 'synced' | 'failed' | 'cancelled'
  inserted?: number
  scanned?: number
  failureCount?: number
  nextRetryAt?: number | null
  error?: string
  processed?: number
  total?: number
  progress?: number
  resumed?: boolean
  updatedAt: number
}

interface StoredGitSyncState {
  projectId: string
  lastSyncedSha?: string | null
  scanGeneration?: string | null
  lastScannedAt?: number | null
  status?: string | null
  error?: string | null
  failureCount?: number | bigint | null
  nextRetryAt?: number | bigint | null
  historyLimit?: number | bigint | null
  historyTruncated?: number | bigint | null
}

interface SyncRequest {
  reason?: GitSyncReason
  signal?: AbortSignal
  onProgress?: (event: GitSyncStateEvent) => void
}

interface GitSyncCoordinatorOptions {
  lock?: ProjectGitOperationLock
  run?: typeof runGit
  scan?: (repositoryPath: string, lastSyncedSha: string, runner: GitRunner) => Promise<GitSyncResult>
  prepare?: (repositoryPath: string, lastSyncedSha: string, runner: GitRunner) => Promise<GitScanPlan>
  readBatch?: typeof readGitCommitBatch
  batchSize?: number
  now?: () => number
  onState?: (event: GitSyncStateEvent) => void
}

function abortError() {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

function readSyncState(db: SqliteDatabase, projectId: string) {
  return db.prepare('SELECT * FROM git_sync_state WHERE projectId = ?').get(projectId) as StoredGitSyncState | undefined
}

function restoreSyncState(db: SqliteDatabase, projectId: string, previous: StoredGitSyncState | undefined) {
  if (!previous) {
    db.prepare('DELETE FROM git_sync_state WHERE projectId = ?').run(projectId)
    return
  }
  db.prepare(`
    UPDATE git_sync_state SET
      status = ?, error = ?, lastScannedAt = ?, failureCount = ?, nextRetryAt = ?
    WHERE projectId = ?
  `).run(
    previous.status || (previous.lastSyncedSha ? 'synced' : 'never'),
    previous.error || '',
    previous.lastScannedAt ?? null,
    Number(previous.failureCount || 0),
    previous.nextRetryAt ?? null,
    projectId,
  )
}

export class GitSyncCoordinator {
  private readonly active = new Map<string, Promise<GitSyncPersistenceResult>>()
  private readonly lock: ProjectGitOperationLock
  private readonly runImplementation: typeof runGit
  private readonly scanImplementation?: GitSyncCoordinatorOptions['scan']
  private readonly prepareImplementation: NonNullable<GitSyncCoordinatorOptions['prepare']>
  private readonly readBatchImplementation: NonNullable<GitSyncCoordinatorOptions['readBatch']>
  private readonly batchSize: number
  private readonly now: () => number
  private readonly onState?: (event: GitSyncStateEvent) => void

  constructor(private readonly db: SqliteDatabase, options: GitSyncCoordinatorOptions = {}) {
    this.lock = options.lock || new ProjectGitOperationLock()
    this.runImplementation = options.run || runGit
    this.scanImplementation = options.scan
    this.prepareImplementation = options.prepare || prepareGitScan
    this.readBatchImplementation = options.readBatch || readGitCommitBatch
    this.batchSize = Math.max(1, Math.min(2_000, Math.trunc(options.batchSize || DEFAULT_GIT_HISTORY_BATCH_SIZE)))
    this.now = options.now || Date.now
    this.onState = options.onState
  }

  private emit(event: GitSyncStateEvent) {
    try {
      this.onState?.(event)
    } catch (error) {
      console.error('[GitSync] State observer failed:', error)
    }
  }

  isActive(projectId: string) {
    return this.active.has(projectId)
  }

  sync(projectId: string, request: SyncRequest = {}) {
    const existing = this.active.get(projectId)
    if (existing) return existing
    const reason = request.reason || 'manual'
    const operation = this.lock.run(projectId, async () => {
      if (request.signal?.aborted) throw abortError()
      const project = this.db.prepare(`
        SELECT id, path, canonicalPath FROM projects WHERE id = ?
      `).get(projectId) as { id: string; path?: string | null; canonicalPath?: string | null } | undefined
      if (!project) throw new Error('项目不存在')
      const repositoryPath = String(project.canonicalPath || project.path || '')
      if (!repositoryPath) throw new Error('项目尚未关联本地目录')
      const previous = readSyncState(this.db, projectId)
      if (previous?.status === 'unavailable') throw new Error('项目尚未关联可用的 Git 仓库')

      this.db.prepare(`
        INSERT INTO git_sync_state (projectId, status, error) VALUES (?, 'syncing', '')
        ON CONFLICT(projectId) DO UPDATE SET status = 'syncing', error = ''
      `).run(projectId)
      const emit = (event: GitSyncStateEvent) => {
        this.emit(event)
        try {
          request.onProgress?.(event)
        } catch (error) {
          console.error('[GitSync] Request progress observer failed:', error)
        }
      }
      emit({ projectId, reason, status: 'syncing', processed: 0, total: 0, progress: 0, updatedAt: this.now() })

      try {
        const runner: GitRunner = (cwd, args, timeout) => this.runImplementation(cwd, args, timeout, request.signal)
        const cursor = previous?.scanGeneration ? String(previous.lastSyncedSha || '') : ''
        let result: GitSyncPersistenceResult
        if (this.scanImplementation) {
          const scan = await this.scanImplementation(repositoryPath, cursor, runner)
          if (request.signal?.aborted) throw abortError()
          result = persistGitSync(this.db, projectId, scan, this.now())
        } else {
          const preparedPlan = await this.prepareImplementation(repositoryPath, cursor, runner)
          const historyLimit = Math.max(0, Math.trunc(Number(previous?.historyLimit || 0)))
          const plan = preparedPlan.scanMode === 'full' && historyLimit > 0 && preparedPlan.totalToScan > historyLimit
            ? { ...preparedPlan, totalToScan: historyLimit }
            : preparedPlan
          if (request.signal?.aborted) throw abortError()
          if (plan.scanMode === 'unchanged') {
            result = persistGitSync(this.db, projectId, {
              headSha: plan.headSha,
              branch: plan.branch,
              detached: plan.detached,
              remoteUrl: plan.remoteUrl,
              commitCount: plan.commitCount,
              commits: [],
              cursorWasReset: plan.cursorWasReset,
              scanMode: plan.scanMode,
            }, this.now())
          } else {
            let session = beginGitBackfill(this.db, projectId, plan, this.now())
            const progress = session.total ? Math.floor((session.offset / session.total) * 100) : 100
            emit({
              projectId,
              reason,
              status: 'syncing',
              processed: session.offset,
              total: session.total,
              progress,
              resumed: session.resumed,
              updatedAt: this.now(),
            })
            while (session.offset < session.total) {
              if (request.signal?.aborted) throw abortError()
              const batch = await this.readBatchImplementation(plan, session.offset, runner, this.batchSize)
              if (batch.offset !== session.offset || batch.nextOffset !== session.offset + batch.commits.length) {
                throw new Error('Git 历史回填返回了无效游标')
              }
              session = persistGitBackfillBatch(this.db, projectId, session, batch.commits, this.now())
              const batchProgress = session.total ? Math.floor((session.offset / session.total) * 100) : 100
              emit({
                projectId,
                reason,
                status: 'syncing',
                processed: session.offset,
                total: session.total,
                progress: batchProgress,
                resumed: session.resumed,
                updatedAt: this.now(),
              })
              if (batch.complete && session.offset < session.total) {
                throw new Error(`Git 历史数量在扫描期间发生变化（${session.offset}/${session.total}）`)
              }
            }
            if (request.signal?.aborted) throw abortError()
            result = completeGitBackfill(this.db, projectId, plan, session, this.now())
          }
        }
        emit({
          projectId,
          reason,
          status: 'synced',
          inserted: result.inserted,
          scanned: result.scanned,
          failureCount: 0,
          nextRetryAt: null,
          processed: result.scanned,
          total: result.scanned,
          progress: 100,
          resumed: 'resumed' in result ? Boolean(result.resumed) : false,
          updatedAt: this.now(),
        })
        return result
      } catch (error) {
        if (request.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          restoreSyncState(this.db, projectId, previous)
          emit({ projectId, reason, status: 'cancelled', updatedAt: this.now() })
          throw abortError()
        }
        const message = error instanceof Error ? error.message : String(error)
        const failure = markGitSyncFailure(this.db, projectId, message, this.now())
        emit({ projectId, reason, status: 'failed', error: message, ...failure, updatedAt: this.now() })
        throw error
      }
    }).finally(() => this.active.delete(projectId))
    this.active.set(projectId, operation)
    return operation
  }
}

export interface DueGitSyncProject {
  projectId: string
  status: string
  lastScannedAt: number | null
  nextRetryAt: number | null
}

export function listDueGitSyncProjects(
  db: SqliteDatabase,
  now = Date.now(),
  syncIntervalMs = 5 * 60_000,
  limit = 100,
): DueGitSyncProject[] {
  const rows = db.prepare(`
    SELECT p.id AS projectId, gs.status, gs.lastScannedAt, gs.nextRetryAt
    FROM projects p
    JOIN git_sync_state gs ON gs.projectId = p.id
    WHERE COALESCE(NULLIF(p.canonicalPath, ''), NULLIF(p.path, ''), '') <> ''
      AND gs.status <> 'unavailable'
      AND gs.status <> 'syncing'
    ORDER BY
      CASE gs.status WHEN 'failed' THEN 0 WHEN 'never' THEN 1 ELSE 2 END,
      COALESCE(gs.nextRetryAt, gs.lastScannedAt, 0), p.id
  `).all() as Array<{ projectId: string; status: string; lastScannedAt: number | null; nextRetryAt: number | null }>
  return rows.filter(row => {
    if (row.status === 'failed') return row.nextRetryAt === null || Number(row.nextRetryAt) <= now
    if (row.status === 'never') return true
    if (row.status === 'synced') return row.lastScannedAt === null || Number(row.lastScannedAt) <= now - syncIntervalMs
    return false
  }).slice(0, Math.max(0, limit)).map(row => ({
    projectId: String(row.projectId),
    status: String(row.status),
    lastScannedAt: row.lastScannedAt === null ? null : Number(row.lastScannedAt),
    nextRetryAt: row.nextRetryAt === null ? null : Number(row.nextRetryAt),
  }))
}

export function recoverInterruptedGitSyncs(db: SqliteDatabase, now = Date.now()) {
  const rows = db.prepare(`
    SELECT projectId, failureCount FROM git_sync_state WHERE status = 'syncing'
  `).all() as Array<{ projectId: string; failureCount: number | bigint | null }>
  const update = db.prepare(`
    UPDATE git_sync_state SET
      status = 'failed',
      error = '应用上次退出时 Git 同步仍在执行，已安排重新同步',
      failureCount = ?,
      nextRetryAt = ?
    WHERE projectId = ?
  `)
  for (const row of rows) {
    update.run(Math.min(1_000, Number(row.failureCount || 0) + 1), now, row.projectId)
  }
  return rows.length
}

interface GitSyncSchedulerOptions {
  intervalMs?: number
  syncIntervalMs?: number
  concurrency?: number
  now?: () => number
}

export class GitSyncScheduler {
  private readonly intervalMs: number
  private readonly syncIntervalMs: number
  private readonly concurrency: number
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private currentRun: Promise<{ attempted: number; succeeded: number; failed: number }> | null = null
  private stopping = false
  private recovered = false
  private readonly scheduledControllers = new Map<string, AbortController>()

  constructor(
    private readonly db: SqliteDatabase,
    private readonly coordinator: GitSyncCoordinator,
    options: GitSyncSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs || 60_000
    this.syncIntervalMs = options.syncIntervalMs || 5 * 60_000
    this.concurrency = Math.max(1, Math.min(8, options.concurrency || 2))
    this.now = options.now || Date.now
  }

  start() {
    if (this.timer) return
    this.stopping = false
    if (!this.recovered) {
      recoverInterruptedGitSyncs(this.db, this.now())
      this.recovered = true
    }
    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs)
    this.timer.unref?.()
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const controller of this.scheduledControllers.values()) controller.abort()
    await this.currentRun?.catch(() => undefined)
  }

  cancelProject(projectId: string) {
    const controller = this.scheduledControllers.get(projectId)
    if (!controller) return false
    controller.abort()
    return true
  }

  runOnce() {
    if (this.currentRun) return this.currentRun
    const operation = this.runDueProjects().finally(() => {
      if (this.currentRun === operation) this.currentRun = null
    })
    this.currentRun = operation
    return operation
  }

  private async runDueProjects() {
    const projects = listDueGitSyncProjects(this.db, this.now(), this.syncIntervalMs)
    let cursor = 0
    let succeeded = 0
    let failed = 0
    const worker = async () => {
      while (!this.stopping && cursor < projects.length) {
        const project = projects[cursor]
        cursor += 1
        const controller = new AbortController()
        this.scheduledControllers.set(project.projectId, controller)
        try {
          await this.coordinator.sync(project.projectId, { reason: 'scheduled', signal: controller.signal })
          succeeded += 1
        } catch {
          failed += 1
        } finally {
          if (this.scheduledControllers.get(project.projectId) === controller) {
            this.scheduledControllers.delete(project.projectId)
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, projects.length) }, () => worker()))
    return { attempted: projects.length, succeeded, failed }
  }
}
