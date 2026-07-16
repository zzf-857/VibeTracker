import type { GitCommitFact, GitScanPlan, GitSyncResult, ProjectInspection } from './gitService'
import type { SqliteDatabase } from './databaseMigrations'

export const GIT_SYNC_RETRY_BASE_MS = 60_000
export const GIT_SYNC_RETRY_MAX_MS = 6 * 60 * 60_000

export function gitSyncRetryDelay(failureCount: number) {
  const exponent = Math.max(0, Math.min(20, Math.trunc(failureCount) - 1))
  return Math.min(GIT_SYNC_RETRY_MAX_MS, GIT_SYNC_RETRY_BASE_MS * (2 ** exponent))
}

export class ProjectGitOperationLock {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectId) || Promise.resolve()
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.tails.set(projectId, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId)
    }
  }
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

function sameRepositoryPath(left: string, right: string) {
  const normalize = (value: string) => value.replace(/[\\/]+$/, '')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight
}

function upsertGitCommitFacts(
  db: SqliteDatabase,
  projectId: string,
  commits: GitCommitFact[],
  scanGeneration: string,
  now: number,
  staged = false,
) {
  const before = db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE projectId = ?').get(projectId) as { count: number | bigint }
  const reachableUpdate = staged ? '' : ', reachable = 1'
  const upsert = db.prepare(`
    INSERT INTO git_commits (
      id, projectId, sha, subject, body, authorName, authorEmail, authoredAt,
      parentShasJson, fileNamesJson, statsJson, reachable, lastSeenGeneration, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(projectId, sha) DO UPDATE SET
      subject = excluded.subject,
      body = excluded.body,
      authorName = excluded.authorName,
      authorEmail = excluded.authorEmail,
      authoredAt = excluded.authoredAt,
      parentShasJson = excluded.parentShasJson,
      fileNamesJson = excluded.fileNamesJson,
      statsJson = excluded.statsJson,
      lastSeenGeneration = excluded.lastSeenGeneration
      ${reachableUpdate}
  `)
  for (const commit of commits) {
    upsert.run(
      crypto.randomUUID(), projectId, commit.sha, commit.subject, commit.body,
      commit.authorName, commit.authorEmail, commit.authoredAt,
      JSON.stringify(commit.parentShas), JSON.stringify(commit.fileNames), JSON.stringify(commit.stats),
      staged ? 0 : 1, scanGeneration, now,
    )
  }
  const after = db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE projectId = ?').get(projectId) as { count: number | bigint }
  return Number(after.count) - Number(before.count)
}

function persistGitSyncRows(
  db: SqliteDatabase,
  projectId: string,
  sync: GitSyncResult,
  now = Date.now(),
) {
  const scanGeneration = crypto.randomUUID()
  if (sync.scanMode === 'full') {
    db.prepare('UPDATE git_commits SET reachable = 0 WHERE projectId = ? AND reachable = 1').run(projectId)
  }
  const inserted = upsertGitCommitFacts(db, projectId, sync.commits, scanGeneration, now)
  // If the previous cursor is an ancestor, every previously reachable row is also
  // reachable from the captured head. Advancing its generation records that proof
  // without re-reading immutable commit facts.
  db.prepare(`
    UPDATE git_commits SET lastSeenGeneration = ?
    WHERE projectId = ? AND reachable = 1
  `).run(scanGeneration, projectId)
  db.prepare(`
      INSERT INTO git_sync_state (
        projectId, headSha, lastSyncedSha, branch, detached, remoteUrl,
        commitCount, lastScannedAt, status, error, scanGeneration, failureCount, nextRetryAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', '', ?, 0, NULL)
      ON CONFLICT(projectId) DO UPDATE SET
        headSha = excluded.headSha,
        lastSyncedSha = excluded.lastSyncedSha,
        branch = excluded.branch,
        detached = excluded.detached,
        remoteUrl = excluded.remoteUrl,
        commitCount = excluded.commitCount,
        lastScannedAt = excluded.lastScannedAt,
        status = 'synced',
        error = '',
        scanGeneration = excluded.scanGeneration,
        failureCount = 0,
        nextRetryAt = NULL,
        backfillHeadSha = '',
        backfillBaseSha = '',
        backfillMode = '',
        backfillGeneration = '',
        backfillOffset = 0,
        backfillTotal = 0,
        backfillInserted = 0,
        backfillStartedAt = NULL,
        backfillUpdatedAt = NULL
  `).run(
    projectId, sync.headSha, sync.headSha, sync.branch, sync.detached ? 1 : 0,
    sync.remoteUrl, sync.commitCount, now, scanGeneration,
  )
  if (sync.remoteUrl) db.prepare('UPDATE projects SET repoUrl = ? WHERE id = ?').run(sync.remoteUrl, projectId)
  if (inserted > 0) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, projectId)
  return {
    inserted,
    scanned: sync.commits.length,
    headSha: sync.headSha,
    cursorWasReset: sync.cursorWasReset,
    scanGeneration,
  }
}

export function persistGitSync(
  db: SqliteDatabase,
  projectId: string,
  sync: GitSyncResult,
  now = Date.now(),
) {
  return runTransaction(db, () => persistGitSyncRows(db, projectId, sync, now))
}

interface StoredGitBackfillState {
  backfillHeadSha?: string | null
  backfillBaseSha?: string | null
  backfillMode?: string | null
  backfillGeneration?: string | null
  backfillOffset?: number | bigint | null
  backfillTotal?: number | bigint | null
  backfillInserted?: number | bigint | null
  backfillStartedAt?: number | bigint | null
}

export interface GitBackfillSession {
  generation: string
  offset: number
  total: number
  inserted: number
  startedAt: number
  resumed: boolean
}

export function beginGitBackfill(
  db: SqliteDatabase,
  projectId: string,
  plan: GitScanPlan,
  now = Date.now(),
): GitBackfillSession {
  if (plan.scanMode === 'unchanged') throw new Error('无需为未变化的 Git 历史创建回填任务')
  return runTransaction(db, () => {
    const state = db.prepare(`
      SELECT backfillHeadSha, backfillBaseSha, backfillMode, backfillGeneration,
        backfillOffset, backfillTotal, backfillInserted, backfillStartedAt
      FROM git_sync_state WHERE projectId = ?
    `).get(projectId) as StoredGitBackfillState | undefined
    const generation = String(state?.backfillGeneration || '')
    const matching = Boolean(
      generation
      && state?.backfillHeadSha === plan.headSha
      && state?.backfillBaseSha === plan.baseSha
      && state?.backfillMode === plan.scanMode
      && Number(state?.backfillTotal || 0) === plan.totalToScan
      && Number(state?.backfillOffset || 0) <= plan.totalToScan,
    )
    if (matching) {
      const offset = Number(state?.backfillOffset || 0)
      db.prepare(`
        UPDATE git_sync_state SET status = 'syncing', error = '', backfillUpdatedAt = ?
        WHERE projectId = ?
      `).run(now, projectId)
      return {
        generation,
        offset,
        total: plan.totalToScan,
        inserted: Number(state?.backfillInserted || 0),
        startedAt: Number(state?.backfillStartedAt || now),
        resumed: offset > 0,
      }
    }

    const nextGeneration = crypto.randomUUID()
    db.prepare(`
      INSERT INTO git_sync_state (
        projectId, status, error, backfillHeadSha, backfillBaseSha, backfillMode,
        backfillGeneration, backfillOffset, backfillTotal, backfillInserted,
        backfillStartedAt, backfillUpdatedAt
      ) VALUES (?, 'syncing', '', ?, ?, ?, ?, 0, ?, 0, ?, ?)
      ON CONFLICT(projectId) DO UPDATE SET
        status = 'syncing', error = '',
        backfillHeadSha = excluded.backfillHeadSha,
        backfillBaseSha = excluded.backfillBaseSha,
        backfillMode = excluded.backfillMode,
        backfillGeneration = excluded.backfillGeneration,
        backfillOffset = 0,
        backfillTotal = excluded.backfillTotal,
        backfillInserted = 0,
        backfillStartedAt = excluded.backfillStartedAt,
        backfillUpdatedAt = excluded.backfillUpdatedAt
    `).run(
      projectId, plan.headSha, plan.baseSha, plan.scanMode, nextGeneration,
      plan.totalToScan, now, now,
    )
    return {
      generation: nextGeneration,
      offset: 0,
      total: plan.totalToScan,
      inserted: 0,
      startedAt: now,
      resumed: false,
    }
  })
}

export function persistGitBackfillBatch(
  db: SqliteDatabase,
  projectId: string,
  session: GitBackfillSession,
  commits: GitCommitFact[],
  now = Date.now(),
) {
  return runTransaction(db, () => {
    const state = db.prepare(`
      SELECT backfillGeneration, backfillOffset, backfillTotal, backfillInserted
      FROM git_sync_state WHERE projectId = ?
    `).get(projectId) as StoredGitBackfillState | undefined
    if (!state || state.backfillGeneration !== session.generation) throw new Error('Git 历史回填任务已失效，请重新扫描')
    const offset = Number(state.backfillOffset || 0)
    const total = Number(state.backfillTotal || 0)
    if (offset !== session.offset) throw new Error('Git 历史回填游标已变化，请从最新位置继续')
    if (!commits.length && offset < total) throw new Error('Git 历史回填未返回预期提交')
    const nextOffset = offset + commits.length
    if (nextOffset > total) throw new Error('Git 历史回填超过预期范围')
    const inserted = upsertGitCommitFacts(db, projectId, commits, session.generation, now, true)
    const accumulatedInserted = Number(state.backfillInserted || 0) + inserted
    const updated = db.prepare(`
      UPDATE git_sync_state SET
        backfillOffset = ?, backfillInserted = ?, backfillUpdatedAt = ?
      WHERE projectId = ? AND backfillGeneration = ? AND backfillOffset = ?
    `).run(nextOffset, accumulatedInserted, now, projectId, session.generation, offset) as { changes: number }
    if (updated.changes !== 1) throw new Error('Git 历史回填游标更新冲突')
    return {
      ...session,
      offset: nextOffset,
      inserted: accumulatedInserted,
    }
  })
}

export function completeGitBackfill(
  db: SqliteDatabase,
  projectId: string,
  plan: GitScanPlan,
  session: GitBackfillSession,
  now = Date.now(),
) {
  return runTransaction(db, () => {
    const state = db.prepare(`
      SELECT backfillGeneration, backfillOffset, backfillTotal
      FROM git_sync_state WHERE projectId = ?
    `).get(projectId) as StoredGitBackfillState | undefined
    if (!state || state.backfillGeneration !== session.generation) throw new Error('Git 历史回填任务已失效，无法完成')
    const scanned = Number(state.backfillOffset || 0)
    const total = Number(state.backfillTotal || 0)
    if (scanned !== total || total !== plan.totalToScan) throw new Error('Git 历史回填尚未完成')
    const activated = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM git_commits
      WHERE projectId = ? AND lastSeenGeneration = ? AND reachable = 0
    `).get(projectId, session.generation) as { count: number | bigint }).count)

    if (plan.scanMode === 'full') {
      db.prepare(`
        UPDATE git_commits SET reachable = CASE WHEN lastSeenGeneration = ? THEN 1 ELSE 0 END
        WHERE projectId = ?
      `).run(session.generation, projectId)
    } else {
      db.prepare(`
        UPDATE git_commits SET reachable = 1
        WHERE projectId = ? AND lastSeenGeneration = ?
      `).run(projectId, session.generation)
    }
    db.prepare(`
      UPDATE git_commits SET lastSeenGeneration = ?
      WHERE projectId = ? AND reachable = 1
    `).run(session.generation, projectId)
    const completed = db.prepare(`
      UPDATE git_sync_state SET
        headSha = ?, lastSyncedSha = ?, branch = ?, detached = ?, remoteUrl = ?,
        commitCount = ?, lastScannedAt = ?, status = 'synced', error = '',
        scanGeneration = ?, failureCount = 0, nextRetryAt = NULL,
        historyTruncated = CASE WHEN ? = 'full' THEN ? ELSE historyTruncated END,
        backfillHeadSha = '', backfillBaseSha = '', backfillMode = '',
        backfillGeneration = '', backfillOffset = 0, backfillTotal = 0,
        backfillInserted = 0, backfillStartedAt = NULL, backfillUpdatedAt = NULL
      WHERE projectId = ? AND backfillGeneration = ?
    `).run(
      plan.headSha, plan.headSha, plan.branch, plan.detached ? 1 : 0, plan.remoteUrl,
      plan.commitCount, now, session.generation, plan.scanMode,
      plan.scanMode === 'full' && plan.totalToScan < plan.commitCount ? 1 : 0,
      projectId, session.generation,
    ) as { changes: number }
    if (completed.changes !== 1) throw new Error('Git 历史回填完成状态更新冲突')
    if (plan.remoteUrl) db.prepare('UPDATE projects SET repoUrl = ? WHERE id = ?').run(plan.remoteUrl, projectId)
    if (activated > 0 || plan.cursorWasReset) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, projectId)
    return {
      inserted: activated,
      scanned,
      headSha: plan.headSha,
      cursorWasReset: plan.cursorWasReset,
      scanGeneration: session.generation,
      resumed: session.resumed,
      total,
    }
  })
}

function updateProjectRelinkMetadata(
  db: SqliteDatabase,
  projectId: string,
  inspection: ProjectInspection,
  now: number,
) {
  const currentProject = db.prepare(`
    SELECT canonicalPath, path FROM projects WHERE id = ?
  `).get(projectId) as { canonicalPath: string | null; path: string | null } | undefined
  if (!currentProject) throw new Error('项目不存在')
  const duplicate = db.prepare(`
    SELECT id, name FROM projects WHERE canonicalPath = ? AND id <> ? LIMIT 1
  `).get(inspection.canonicalPath, projectId) as { id: string; name: string } | undefined
  if (duplicate) throw new Error(`该目录已关联到项目「${duplicate.name}」`)
  const updated = db.prepare(`
    UPDATE projects SET
      path = ?, canonicalPath = ?, repoUrl = ?, importedAt = COALESCE(importedAt, ?), updatedAt = ?
    WHERE id = ?
  `).run(
    inspection.repositoryRoot, inspection.canonicalPath, inspection.remoteUrl,
    now, now, projectId,
  ) as { changes: number }
  if (updated.changes !== 1) throw new Error('项目不存在')
  const previousRepository = currentProject.canonicalPath || currentProject.path || ''
  const repositoryChanged = !previousRepository || !sameRepositoryPath(previousRepository, inspection.canonicalPath)
  if (repositoryChanged && previousRepository) {
    db.prepare(`
      INSERT INTO project_relink_roots (projectId, rootPath, createdAt)
      VALUES (?, ?, ?)
      ON CONFLICT(projectId, rootPath) DO UPDATE SET createdAt = excluded.createdAt
    `).run(projectId, previousRepository, now)
  }
  const invalidatedLaunchProfiles = repositoryChanged
    ? (db.prepare(`
        UPDATE launch_profiles SET validated = 0, confirmedHash = '', updatedAt = ?
        WHERE projectId = ? AND (validated <> 0 OR COALESCE(confirmedHash, '') <> '')
      `).run(now, projectId) as { changes: number }).changes
    : 0

  if (repositoryChanged) {
    // Make the new repository durable before reading its history. Existing facts
    // stay visible until the coordinator atomically publishes the new generation,
    // while a crash can resume against the newly confirmed canonical path.
    db.prepare(`
      INSERT INTO git_sync_state (
        projectId, status, error, failureCount, nextRetryAt, lastScannedAt
      ) VALUES (?, 'never', '', 0, NULL, NULL)
      ON CONFLICT(projectId) DO UPDATE SET
        status = 'never', error = '', failureCount = 0,
        nextRetryAt = NULL, lastScannedAt = NULL
    `).run(projectId)
  }

  return { invalidatedLaunchProfiles, repositoryChanged, previousRepository }
}

export function persistProjectRelinkMetadata(
  db: SqliteDatabase,
  projectId: string,
  inspection: ProjectInspection,
  now = Date.now(),
) {
  return runTransaction(db, () => updateProjectRelinkMetadata(db, projectId, inspection, now))
}

export function persistProjectRelink(
  db: SqliteDatabase,
  projectId: string,
  inspection: ProjectInspection,
  sync: GitSyncResult,
  now = Date.now(),
) {
  return runTransaction(db, () => {
    const metadata = updateProjectRelinkMetadata(db, projectId, inspection, now)
    return {
      ...persistGitSyncRows(db, projectId, sync, now),
      invalidatedLaunchProfiles: metadata.invalidatedLaunchProfiles,
    }
  })
}

export function markGitSyncFailure(db: SqliteDatabase, projectId: string, message: string, now = Date.now()) {
  return runTransaction(db, () => {
    const existing = db.prepare('SELECT failureCount FROM git_sync_state WHERE projectId = ?')
      .get(projectId) as { failureCount?: number | bigint } | undefined
    const failureCount = Math.min(1_000, Number(existing?.failureCount || 0) + 1)
    const nextRetryAt = now + gitSyncRetryDelay(failureCount)
    db.prepare(`
      INSERT INTO git_sync_state (
        projectId, lastScannedAt, status, error, failureCount, nextRetryAt
      ) VALUES (?, ?, 'failed', ?, ?, ?)
      ON CONFLICT(projectId) DO UPDATE SET
        lastScannedAt = excluded.lastScannedAt,
        status = 'failed',
        error = excluded.error,
        failureCount = excluded.failureCount,
        nextRetryAt = excluded.nextRetryAt
    `).run(projectId, now, message.slice(0, 2_000), failureCount, nextRetryAt)
    return { failureCount, nextRetryAt }
  })
}

export function rowToGitCommit(row: Record<string, unknown>): GitCommitFact {
  const parseArray = (value: unknown) => {
    try { return JSON.parse(String(value || '[]')) as string[] } catch { return [] }
  }
  const parseStats = (value: unknown) => {
    try { return JSON.parse(String(value || '{}')) as GitCommitFact['stats'] } catch { return { added: 0, deleted: 0, files: 0 } }
  }
  const disposition = ['pending', 'handled', 'ignored'].includes(String(row.disposition))
    ? String(row.disposition) as NonNullable<GitCommitFact['disposition']>
    : 'pending'
  return {
    sha: String(row.sha || ''),
    parentShas: parseArray(row.parentShasJson),
    authorName: String(row.authorName || ''),
    authorEmail: String(row.authorEmail || ''),
    authoredAt: Number(row.authoredAt),
    subject: String(row.subject || ''),
    body: String(row.body || ''),
    fileNames: parseArray(row.fileNamesJson),
    stats: parseStats(row.statsJson),
    disposition,
    seenAt: row.seenAt === null || row.seenAt === undefined ? null : Number(row.seenAt),
    activeRecord: row.activeRecordId ? {
      recordId: String(row.activeRecordId),
      title: String(row.activeRecordTitle || ''),
      source: row.activeRecordSource === 'ai' ? 'ai' : 'manual',
      reviewStatus: row.activeRecordReviewStatus === 'draft' ? 'draft' : 'accepted',
    } : null,
  }
}
