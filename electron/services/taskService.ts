import type { SqliteDatabase } from './databaseMigrations'

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface BackgroundTaskRecord {
  id: string
  kind: string
  projectId: string
  generationRunId?: string
  status: BackgroundTaskStatus
  detail: string
  progress?: number
  canRetry: boolean
  canCancel?: boolean
  createdAt: number
  updatedAt: number
}

interface StoredTaskRow {
  id: string
  kind: string
  projectId: string
  generationRunId: string
  status: BackgroundTaskStatus
  detail: string
  progress: number | null
  contextJson: string
  canRetry: number
  createdAt: number
  updatedAt: number
}

function parseContext(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function publicRecord(row: StoredTaskRow): BackgroundTaskRecord {
  const task: BackgroundTaskRecord = {
    id: row.id,
    kind: row.kind,
    projectId: row.projectId,
    status: row.status,
    detail: row.detail,
    canRetry: Boolean(row.canRetry),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }
  if (row.generationRunId) task.generationRunId = row.generationRunId
  if (row.progress !== null && Number.isFinite(Number(row.progress))) task.progress = Number(row.progress)
  return task
}

export class TaskService {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(input: BackgroundTaskRecord, context: Record<string, unknown> = {}) {
    const progress = input.progress === undefined ? null : Math.max(0, Math.min(100, input.progress))
    this.db.prepare(`
      INSERT INTO background_tasks (
        id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        projectId = excluded.projectId,
        generationRunId = excluded.generationRunId,
        status = excluded.status,
        detail = excluded.detail,
        progress = excluded.progress,
        contextJson = excluded.contextJson,
        canRetry = excluded.canRetry,
        updatedAt = excluded.updatedAt
    `).run(
      input.id,
      input.kind,
      input.projectId,
      input.generationRunId || '',
      input.status,
      input.detail,
      progress,
      JSON.stringify(context),
      input.canRetry ? 1 : 0,
      input.createdAt,
      input.updatedAt,
    )
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(input.status)) this.prune()
    return input
  }

  recoverInterrupted(now = Date.now()) {
    return Number((this.db.prepare(`
      UPDATE background_tasks SET
        status = 'interrupted',
        detail = CASE
          WHEN detail = '' THEN '应用上次退出时任务仍在运行，已标记为中断'
          ELSE detail || '；应用上次退出时任务仍在运行，已标记为中断'
        END,
        canRetry = CASE
          WHEN kind IN ('git-sync', 'git-sync-scheduled', 'ai-generate', 'assets-migrate') THEN 1
          ELSE canRetry
        END,
        updatedAt = ?
      WHERE status = 'running'
    `).run(now) as { changes?: number }).changes || 0)
  }

  list(limit = 50) {
    const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    return (this.db.prepare(`
      SELECT id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      FROM background_tasks
      ORDER BY updatedAt DESC, id DESC
      LIMIT ?
    `).all(normalizedLimit) as StoredTaskRow[]).map(publicRecord)
  }

  get(taskId: string) {
    const row = this.db.prepare(`
      SELECT id, kind, projectId, generationRunId, status, detail, progress,
        contextJson, canRetry, createdAt, updatedAt
      FROM background_tasks WHERE id = ?
    `).get(taskId) as StoredTaskRow | undefined
    return row ? { task: publicRecord(row), context: parseContext(row.contextJson) } : null
  }

  private prune(maxEntries = 200) {
    this.db.prepare(`
      DELETE FROM background_tasks
      WHERE id IN (
        SELECT id FROM background_tasks
        ORDER BY updatedAt DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(maxEntries)
  }
}
