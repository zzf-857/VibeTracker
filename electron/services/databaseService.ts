import type Database from 'better-sqlite3'
import path from 'node:path'
import type { ProjectInspection } from './gitService'
import { rowToGitCommit } from './gitRepository'

type DbRow = Record<string, unknown>

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value ?? '')) as T } catch { return fallback }
}

function bool(value: unknown) {
  return Number(value) === 1
}

function pageCursor(value: string | number | undefined) {
  if (value === undefined) return { timestamp: Number.MAX_SAFE_INTEGER, key: '\uffff' }
  if (typeof value === 'number') return { timestamp: value, key: '\uffff' }
  const separator = value.indexOf('|')
  if (separator < 1) return { timestamp: Number(value) || Number.MAX_SAFE_INTEGER, key: '\uffff' }
  const timestamp = Number(value.slice(0, separator))
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
    key: value.slice(separator + 1) || '\uffff',
  }
}

function encodePageCursor(timestamp: unknown, key: unknown) {
  return `${Number(timestamp)}|${String(key)}`
}

function ascendingPageCursor(value: string | number | undefined) {
  if (value === undefined) return { timestamp: Number.MIN_SAFE_INTEGER, key: '' }
  if (typeof value === 'number') return { timestamp: value, key: '' }
  const separator = value.indexOf('|')
  if (separator < 1) return { timestamp: Number(value) || Number.MIN_SAFE_INTEGER, key: '' }
  const timestamp = Number(value.slice(0, separator))
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Number.MIN_SAFE_INTEGER,
    key: value.slice(separator + 1),
  }
}

function isPathWithinRoot(rootPath: string, filePath: string) {
  if (!rootPath || !filePath) return false
  const pathApi = /^[A-Za-z]:[\\/]/.test(rootPath) || /^[A-Za-z]:[\\/]/.test(filePath)
    ? path.win32
    : path
  let root = pathApi.resolve(rootPath)
  let candidate = pathApi.resolve(filePath)
  if (pathApi === path.win32) {
    root = root.toLocaleLowerCase('en-US')
    candidate = candidate.toLocaleLowerCase('en-US')
  }
  const relative = pathApi.relative(root, candidate)
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative)
}

export class DatabaseService {
  constructor(private readonly db: Database.Database) {}

  private hydrateRecords(records: DbRow[]): Array<DbRow & { images: DbRow[]; gitShas: string[] }> {
    if (!records.length) return []
    const ids = records.map(record => String(record.id))
    const placeholders = ids.map(() => '?').join(',')
    const imagesByRecord = new Map<string, DbRow[]>()
    const shasByRecord = new Map<string, string[]>()
    for (const image of this.db.prepare(`
      SELECT id, recordId, recordId AS commitId, imagePath, caption, sortIndex, createdAt
      FROM development_record_images
      WHERE recordId IN (${placeholders})
      ORDER BY recordId, sortIndex, createdAt
    `).all(...ids) as DbRow[]) {
      const recordId = String(image.recordId)
      imagesByRecord.set(recordId, [...(imagesByRecord.get(recordId) || []), image])
    }
    for (const link of this.db.prepare(`
      SELECT recordId, gitSha FROM development_record_git_commits
      WHERE recordId IN (${placeholders}) ORDER BY recordId, gitSha
    `).all(...ids) as Array<{ recordId: string; gitSha: string }>) {
      shasByRecord.set(link.recordId, [...(shasByRecord.get(link.recordId) || []), link.gitSha])
    }
    return records.map(record => {
      const recordId = String(record.id)
      return {
        ...record,
        images: imagesByRecord.get(recordId) || [],
        gitShas: shasByRecord.get(recordId) || [],
        evidence: parseJson<string[]>(record.evidenceJson, []),
      }
    })
  }

  private hydrateRecord(record: DbRow): DbRow & { images: DbRow[]; gitShas: string[] } {
    return this.hydrateRecords([record])[0]
  }

  getProjectSummaries(projectId?: string) {
    const projectParams = projectId ? [projectId] : []
    const rows = this.db.prepare(`
      SELECT p.*,
        ps.name AS statusName, ps.color AS statusColor, ps.sortIndex AS statusSortIndex,
        gs.status AS gitStatus, gs.branch AS gitBranch, gs.headSha AS gitHeadSha,
        gs.commitCount AS gitCommitCount, gs.lastScannedAt AS gitLastScannedAt, gs.error AS gitError,
        gs.failureCount AS gitFailureCount, gs.nextRetryAt AS gitNextRetryAt,
        gs.backfillOffset AS gitBackfillOffset, gs.backfillTotal AS gitBackfillTotal,
        gs.backfillGeneration AS gitBackfillGeneration,
        gs.historyLimit AS gitHistoryLimit, gs.historyTruncated AS gitHistoryTruncated,
        (SELECT COUNT(*) FROM development_records dr WHERE dr.projectId = p.id AND dr.reviewStatus = 'accepted') AS recordCount,
        (SELECT COUNT(*) FROM development_records dr WHERE dr.projectId = p.id AND dr.reviewStatus = 'draft') AS draftCount,
        (SELECT COUNT(*) FROM todos td WHERE td.projectId = p.id AND td.completed = 0) AS openTodoCount,
        (SELECT id FROM development_records dr WHERE dr.projectId = p.id AND dr.reviewStatus = 'accepted' ORDER BY createdAt DESC LIMIT 1) AS recentRecordId,
        (SELECT lp.id FROM launch_profiles lp WHERE lp.projectId = p.id AND lp.enabled = 1 ORDER BY lp.validated DESC, lp.updatedAt DESC LIMIT 1) AS launchProfileId,
        (SELECT lp.validated FROM launch_profiles lp WHERE lp.projectId = p.id AND lp.enabled = 1 ORDER BY lp.validated DESC, lp.updatedAt DESC LIMIT 1) AS launchValidated,
        (SELECT lp.readyUrl FROM launch_profiles lp WHERE lp.projectId = p.id AND lp.enabled = 1 ORDER BY lp.validated DESC, lp.updatedAt DESC LIMIT 1) AS launchReadyUrl
      FROM projects p
      LEFT JOIN project_statuses ps ON ps.id = p.status
      LEFT JOIN git_sync_state gs ON gs.projectId = p.id
      ${projectId ? 'WHERE p.id = ?' : ''}
      ORDER BY p.updatedAt DESC
    `).all(...projectParams) as DbRow[]
    const tags = this.db.prepare(`
      SELECT pt.projectId, t.* FROM project_tags pt JOIN tags t ON t.id = pt.tagId
      ${projectId ? 'WHERE pt.projectId = ?' : ''}
      ORDER BY t.name
    `).all(...projectParams) as DbRow[]
    const tagsByProject = new Map<string, DbRow[]>()
    for (const tag of tags) {
      const key = String(tag.projectId)
      tagsByProject.set(key, [...(tagsByProject.get(key) || []), tag])
    }
    const recentIds = rows.map(row => String(row.recentRecordId || '')).filter(Boolean)
    const recentById = new Map<string, ReturnType<DatabaseService['hydrateRecord']>>()
    if (recentIds.length) {
      const placeholders = recentIds.map(() => '?').join(',')
      const imagesByRecord = new Map<string, DbRow[]>()
      const shasByRecord = new Map<string, string[]>()
      for (const image of this.db.prepare(`
        SELECT id, recordId, recordId AS commitId, imagePath, caption, sortIndex, createdAt
        FROM development_record_images WHERE recordId IN (${placeholders}) ORDER BY sortIndex, createdAt
      `).all(...recentIds) as DbRow[]) {
        const recordId = String(image.recordId)
        imagesByRecord.set(recordId, [...(imagesByRecord.get(recordId) || []), image])
      }
      for (const link of this.db.prepare(`
        SELECT recordId, gitSha FROM development_record_git_commits
        WHERE recordId IN (${placeholders}) ORDER BY gitSha
      `).all(...recentIds) as Array<{ recordId: string; gitSha: string }>) {
        shasByRecord.set(link.recordId, [...(shasByRecord.get(link.recordId) || []), link.gitSha])
      }
      for (const record of this.db.prepare(`SELECT * FROM development_records WHERE id IN (${placeholders})`).all(...recentIds) as DbRow[]) {
        const recordId = String(record.id)
        recentById.set(recordId, {
          ...record,
          images: imagesByRecord.get(recordId) || [],
          gitShas: shasByRecord.get(recordId) || [],
          evidence: parseJson<string[]>(record.evidenceJson, []),
        })
      }
    }
    const coverImages = this.db.prepare(`
      SELECT p.id AS projectId, (
        SELECT dri.imagePath FROM development_record_images dri
        JOIN development_records dr ON dr.id = dri.recordId
        WHERE dr.projectId = p.id AND dr.reviewStatus = 'accepted'
        ORDER BY dr.createdAt DESC, dri.sortIndex ASC LIMIT 1
      ) AS imagePath FROM projects p
      ${projectId ? 'WHERE p.id = ?' : ''}
    `).all(...projectParams) as Array<{ projectId: string; imagePath: string | null }>
    const coverByProject = new Map(coverImages.map(row => [row.projectId, row.imagePath || '']))
    return rows.map(row => {
      const projectId = String(row.id)
      const statusInfo = row.statusName ? {
        id: row.status, name: row.statusName, color: row.statusColor, sortIndex: row.statusSortIndex,
      } : null
      const gitSync = row.gitStatus ? {
        status: row.gitStatus, branch: row.gitBranch || '', headSha: row.gitHeadSha || '',
        commitCount: Number(row.gitCommitCount || 0), lastScannedAt: row.gitLastScannedAt || null, error: row.gitError || '',
        failureCount: Number(row.gitFailureCount || 0),
        nextRetryAt: row.gitNextRetryAt === null || row.gitNextRetryAt === undefined ? null : Number(row.gitNextRetryAt),
        backfillProcessed: Number(row.gitBackfillOffset || 0),
        backfillTotal: Number(row.gitBackfillTotal || 0),
        backfillProgress: Number(row.gitBackfillTotal || 0)
          ? Math.floor((Number(row.gitBackfillOffset || 0) / Number(row.gitBackfillTotal)) * 100)
          : 0,
        backfillResumable: Boolean(row.gitBackfillGeneration && Number(row.gitBackfillOffset || 0) < Number(row.gitBackfillTotal || 0)),
        historyLimit: Number(row.gitHistoryLimit || 0),
        historyTruncated: Boolean(row.gitHistoryTruncated),
      } : { status: row.canonicalPath ? 'never' : 'unavailable', branch: '', headSha: '', commitCount: 0, lastScannedAt: null, error: '', failureCount: 0, nextRetryAt: null, backfillProcessed: 0, backfillTotal: 0, backfillProgress: 0, backfillResumable: false, historyLimit: 0, historyTruncated: false }
      return {
        ...row,
        statusInfo,
        tags: tagsByProject.get(projectId) || [],
        recentRecord: recentById.get(String(row.recentRecordId || '')) || null,
        // Kept in the response for one renderer compatibility window. New UI
        // code consumes recentRecord / recordCount exclusively.
        recentCommit: recentById.get(String(row.recentRecordId || '')) || null,
        recordCount: Number(row.recordCount || 0),
        commitCount: Number(row.recordCount || 0),
        draftCount: Number(row.draftCount || 0),
        openTodoCount: Number(row.openTodoCount || 0),
        resolvedCoverImagePath: row.coverImagePath || coverByProject.get(projectId) || '',
        gitSync,
        launchCapability: row.launchProfileId ? {
          profileId: row.launchProfileId,
          validated: bool(row.launchValidated),
          canOpen: Boolean(row.launchReadyUrl),
        } : null,
      }
    })
  }

  getProject(projectId: string) {
    const summary = this.getProjectSummaries(projectId)[0]
    if (!summary) return null
    return {
      ...summary,
      noteblocks: this.db.prepare('SELECT * FROM noteblocks WHERE projectId = ? ORDER BY updatedAt DESC').all(projectId),
      todos: this.db.prepare('SELECT * FROM todos WHERE projectId = ? ORDER BY completed, createdAt').all(projectId),
      assetWarnings: this.getRelinkAssetWarnings(projectId),
    }
  }

  getRelinkAssetWarnings(projectId: string) {
    const project = this.db.prepare(`
      SELECT canonicalPath, path FROM projects WHERE id = ?
    `).get(projectId) as { canonicalPath: string | null; path: string | null } | undefined
    if (!project) return []
    const previousRoots = (this.db.prepare(`
      SELECT rootPath FROM project_relink_roots WHERE projectId = ? ORDER BY createdAt DESC
    `).all(projectId) as Array<{ rootPath: string }>).map(row => row.rootPath).filter(Boolean)
    if (!previousRoots.length) return []
    const currentRoot = project.canonicalPath || project.path || ''
    const references = this.db.prepare(`
      SELECT p.coverImagePath AS path, 'cover' AS kind,
        NULL AS recordId, NULL AS recordTitle,
        EXISTS(SELECT 1 FROM managed_assets managed WHERE managed.path = p.coverImagePath) AS managed
      FROM projects p
      WHERE p.id = ? AND COALESCE(p.coverImagePath, '') <> ''
      UNION ALL
      SELECT image.imagePath AS path, 'record-image' AS kind,
        record.id AS recordId, record.title AS recordTitle,
        EXISTS(SELECT 1 FROM managed_assets managed WHERE managed.path = image.imagePath) AS managed
      FROM development_record_images image
      JOIN development_records record ON record.id = image.recordId
      WHERE record.projectId = ?
    `).all(projectId, projectId) as Array<{
      path: string
      kind: 'cover' | 'record-image'
      recordId: string | null
      recordTitle: string | null
      managed: number
    }>
    const seen = new Set<string>()
    return references.flatMap(reference => {
      if (reference.managed || !previousRoots.some(root => isPathWithinRoot(root, reference.path))) return []
      if (currentRoot && isPathWithinRoot(currentRoot, reference.path)) return []
      const key = `${reference.kind}\0${reference.recordId || ''}\0${reference.path}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{
        kind: reference.kind,
        path: reference.path,
        recordId: reference.recordId,
        recordTitle: reference.recordTitle,
      }]
    })
  }

  applyAiProjectSuggestion(projectId: string, generationRunId: string, input: {
    name: string
    description: string
    phase: string
    tagNames: string[]
  }) {
    const now = Date.now()
    return this.db.transaction(() => {
      const project = this.db.prepare(`
        SELECT id, name, description, phase, updatedAt FROM projects WHERE id = ?
      `).get(projectId) as {
        id: string; name: string; description: string; phase: string; updatedAt: number;
      } | undefined
      if (!project) throw new Error('项目不存在')
      const run = this.db.prepare(`
        SELECT id, status, inputShasJson, outputJson
        FROM ai_generation_runs WHERE id = ? AND projectId = ?
      `).get(generationRunId, projectId) as DbRow | undefined
      if (!run) throw new Error('AI generation run 不存在或不属于该项目')
      if (run.status !== 'succeeded') throw new Error('只有已完成的 AI generation run 才能应用项目建议')
      const output = parseJson<Record<string, unknown>>(run.outputJson, {})
      if (!output.project || typeof output.project !== 'object' || Array.isArray(output.project)) {
        throw new Error('AI generation run 不包含可追溯的项目建议')
      }
      const inputShas = parseJson<string[]>(run.inputShasJson, [])

      const knownTags = this.db.prepare('SELECT id, name, color, createdAt FROM tags ORDER BY createdAt, id')
        .all() as Array<{ id: string; name: string; color: string; createdAt: number }>
      const beforeTags = (this.db.prepare(`
        SELECT t.id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tagId
        WHERE pt.projectId = ? ORDER BY t.name, t.id
      `).all(projectId) as Array<{ id: string; name: string }>).map(tag => ({ id: tag.id, name: tag.name }))
      const requestedNames: string[] = []
      for (const tagName of input.tagNames) {
        if (requestedNames.some(name => name.localeCompare(tagName, 'zh-CN', { sensitivity: 'accent' }) === 0)) continue
        requestedNames.push(tagName)
      }
      const createdTags: Array<{ id: string; name: string; color: string; createdAt: number }> = []
      const appliedTagIds: string[] = []
      const insertTag = this.db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      for (const tagName of requestedNames) {
        let tag = [...knownTags, ...createdTags]
          .find(item => item.name.localeCompare(tagName, 'zh-CN', { sensitivity: 'accent' }) === 0)
        if (!tag) {
          tag = { id: crypto.randomUUID(), name: tagName, color: '#74A9FF', createdAt: now }
          insertTag.run(tag.id, tag.name, tag.color, tag.createdAt)
          createdTags.push(tag)
        }
        appliedTagIds.push(tag.id)
      }

      const updated = this.db.prepare(`
        UPDATE projects SET name = ?, description = ?, phase = ?, updatedAt = ? WHERE id = ?
      `).run(input.name, input.description, input.phase, now, projectId)
      if (updated.changes !== 1) throw new Error('项目不存在')
      const linkTag = this.db.prepare('INSERT OR IGNORE INTO project_tags (projectId, tagId) VALUES (?, ?)')
      appliedTagIds.forEach(tagId => linkTag.run(projectId, tagId))
      const applicationId = crypto.randomUUID()
      const before = {
        name: project.name,
        description: project.description || '',
        phase: project.phase || '',
        tags: beforeTags,
        updatedAt: Number(project.updatedAt || 0),
      }
      const applied = {
        name: input.name,
        description: input.description,
        phase: input.phase,
        tagNames: requestedNames,
        tagIds: appliedTagIds,
      }
      this.db.prepare(`
        INSERT INTO ai_project_suggestion_applications (
          id, projectId, generationRunId, inputShasJson, beforeJson, appliedJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        applicationId, projectId, generationRunId, JSON.stringify(inputShas),
        JSON.stringify(before), JSON.stringify(applied), now,
      )
      return { projectId, generationRunId, applicationId, inputShas, appliedTagIds, createdTags }
    })()
  }

  getRecordsPage(projectId: string, options: { cursor?: string | number; limit?: number; reviewStatus?: string } = {}) {
    const limit = Math.min(Math.max(options.limit || 30, 1), 100)
    const cursor = pageCursor(options.cursor)
    const reviewStatus = options.reviewStatus || 'accepted'
    const rows = this.db.prepare(`
      SELECT * FROM development_records
      WHERE projectId = ? AND reviewStatus = ?
        AND (createdAt < ? OR (createdAt = ? AND id < ?))
      ORDER BY createdAt DESC, id DESC LIMIT ?
    `).all(projectId, reviewStatus, cursor.timestamp, cursor.timestamp, cursor.key, limit + 1) as DbRow[]
    const hasMore = rows.length > limit
    const items = this.hydrateRecords(rows.slice(0, limit))
    return { items, nextCursor: hasMore ? encodePageCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : null }
  }

  getAiDrafts(projectId: string) {
    return this.hydrateRecords(this.db.prepare(`
      SELECT * FROM development_records
      WHERE projectId = ? AND source = 'ai' AND reviewStatus = 'draft'
      ORDER BY createdAt DESC
    `).all(projectId) as DbRow[])
  }

  createManualRecord(data: {
    projectId: string; title: string; description?: string;
    imagePaths?: string[]; gitShas?: string[]; createdAt?: number;
  }) {
    const id = crypto.randomUUID()
    const now = Date.now()
    const createdAt = data.createdAt || now
    const gitShas = [...new Set(data.gitShas || [])]
    if (gitShas.length) {
      const placeholders = gitShas.map(() => '?').join(',')
      const commits = this.db.prepare(`
        SELECT gc.sha, COALESCE(gt.disposition, 'pending') AS disposition
        FROM git_commits gc
        LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
        WHERE gc.projectId = ? AND gc.reachable = 1 AND gc.sha IN (${placeholders})
      `).all(data.projectId, ...gitShas) as Array<{ sha: string; disposition: string }>
      if (commits.length !== gitShas.length) throw new Error('手工记录包含未同步、不可达或不属于该项目的 Git SHA')
      if (commits.some(commit => commit.disposition !== 'pending')) throw new Error('所选 Git 提交已经处理或忽略')
      const activeUsage = this.getDevelopmentRecordUsage(data.projectId, gitShas)
      if (activeUsage.length) throw new Error('所选 Git 提交已经关联待审核草稿或正式开发记录')
    }
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO development_records (
          id, projectId, title, description, source, reviewStatus,
          userEditedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 'manual', 'accepted', ?, ?, ?)
      `).run(id, data.projectId, data.title, data.description || '', now, createdAt, now)
      const insertImage = this.db.prepare(`
        INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
        VALUES (?, ?, ?, '', ?, ?)
      `)
      ;(data.imagePaths || []).forEach((imagePath, index) => insertImage.run(crypto.randomUUID(), id, imagePath, index, now))
      const linkGit = this.db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      const markHandled = this.db.prepare(`
        INSERT INTO git_commit_tracking (
          projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
        ) VALUES (?, ?, 'handled', ?, ?, ?)
        ON CONFLICT(projectId, gitSha) DO UPDATE SET
          disposition = 'handled', seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
          handledByRecordId = excluded.handledByRecordId, updatedAt = excluded.updatedAt
      `)
      gitShas.forEach(sha => {
        linkGit.run(id, sha)
        markHandled.run(data.projectId, sha, now, id, now)
      })
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, data.projectId)
    })()
    return id
  }

  updateRecord(recordId: string, data: { title?: string; description?: string; createdAt?: number }) {
    const requestedKeys = (['title', 'description', 'createdAt'] as const)
      .filter(key => data[key] !== undefined)
    if (!requestedKeys.length) return false
    const now = Date.now()
    return this.db.transaction(() => {
      const record = this.db.prepare(`
        SELECT dr.projectId, dr.title, dr.description, dr.createdAt
        FROM development_records dr
        JOIN projects p ON p.id = dr.projectId
        WHERE dr.id = ? AND dr.reviewStatus = 'accepted'
      `).get(recordId) as {
        projectId: string; title: string; description: string; createdAt: number;
      } | undefined
      if (!record) return false
      const fields: string[] = []
      const values: unknown[] = []
      for (const key of requestedKeys) {
        if (Object.is(data[key], record[key])) continue
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
      if (!fields.length) return true
      fields.push('updatedAt = ?', 'userEditedAt = ?')
      values.push(now, now)
      const result = this.db.prepare(`
        UPDATE development_records SET ${fields.join(', ')}
        WHERE id = ? AND reviewStatus = 'accepted'
      `).run(...values, recordId)
      if (result.changes === 0) return false
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
      return true
    })()
  }

  reviewDraft(recordId: string, status: 'accepted' | 'rejected', edited?: { title?: string; description?: string; ignoreGitShas?: boolean }) {
    const now = Date.now()
    return this.db.transaction(() => {
      const record = this.db.prepare(`
        SELECT dr.projectId, dr.title, dr.description
        FROM development_records dr
        JOIN projects p ON p.id = dr.projectId
        WHERE dr.id = ? AND dr.source = 'ai' AND dr.reviewStatus = 'draft'
      `).get(recordId) as { projectId: string; title: string; description: string } | undefined
      if (!record) return false
      const contentChanged = (edited?.title !== undefined && edited.title !== record.title)
        || (edited?.description !== undefined && edited.description !== record.description)
      const result = this.db.prepare(`
        UPDATE development_records SET
          title = COALESCE(?, title), description = COALESCE(?, description), reviewStatus = ?,
          userEditedAt = CASE WHEN ? = 1 THEN ? ELSE userEditedAt END,
          updatedAt = ?
        WHERE id = ? AND source = 'ai' AND reviewStatus = 'draft'
      `).run(edited?.title ?? null, edited?.description ?? null, status, contentChanged ? 1 : 0, now, now, recordId)
      if (result.changes === 0) return false
      const gitShas = (this.db.prepare(`
        SELECT gitSha FROM development_record_git_commits WHERE recordId = ?
      `).all(recordId) as Array<{ gitSha: string }>).map(row => row.gitSha)
      if (status === 'accepted') {
        this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
        const handled = this.db.prepare(`
          INSERT INTO git_commit_tracking (
            projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
          ) VALUES (?, ?, 'handled', ?, ?, ?)
          ON CONFLICT(projectId, gitSha) DO UPDATE SET
            disposition = 'handled', seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
            handledByRecordId = excluded.handledByRecordId, updatedAt = excluded.updatedAt
        `)
        gitShas.forEach(sha => handled.run(record.projectId, sha, now, recordId, now))
      } else if (edited?.ignoreGitShas) {
        const ignored = this.db.prepare(`
          INSERT INTO git_commit_tracking (
            projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
          ) VALUES (?, ?, 'ignored', ?, NULL, ?)
          ON CONFLICT(projectId, gitSha) DO UPDATE SET
            disposition = 'ignored', seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
            handledByRecordId = NULL, updatedAt = excluded.updatedAt
        `)
        gitShas.forEach(sha => ignored.run(record.projectId, sha, now, now))
      }
      return true
    })()
  }

  deleteRecord(recordId: string) {
    return this.db.prepare('DELETE FROM development_records WHERE id = ?').run(recordId).changes > 0
  }

  getAcceptedRecordContext(recordId: string) {
    return this.db.prepare(`
      SELECT dr.id AS recordId, dr.projectId
      FROM development_records dr
      JOIN projects p ON p.id = dr.projectId
      WHERE dr.id = ? AND dr.reviewStatus = 'accepted'
    `).get(recordId) as { recordId: string; projectId: string } | undefined
  }

  addRecordImage(recordId: string, imagePath: string, caption = '', now = Date.now()) {
    if (typeof imagePath !== 'string' || !imagePath || imagePath.length > 4_096) {
      throw new Error('图片路径无效')
    }
    if (typeof caption !== 'string' || caption.length > 1_000) throw new Error('图片说明过长')
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('图片时间无效')
    const id = crypto.randomUUID()
    return this.db.transaction(() => {
      const record = this.getAcceptedRecordContext(recordId)
      if (!record) throw new Error('正式开发记录不存在或尚未通过审核')
      const max = this.db.prepare(`
        SELECT COALESCE(MAX(sortIndex), -1) AS value
        FROM development_record_images WHERE recordId = ?
      `).get(recordId) as { value: number | bigint }
      const sortIndex = Number(max.value) + 1
      this.db.prepare(`
        INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, recordId, imagePath, caption, sortIndex, now)
      this.db.prepare('UPDATE development_records SET updatedAt = ? WHERE id = ?').run(now, recordId)
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
      return { id, recordId, commitId: recordId, imagePath, caption, sortIndex, createdAt: now }
    })()
  }

  updateRecordImage(recordId: string, imageId: string, caption: string, now = Date.now()) {
    if (typeof caption !== 'string' || caption.length > 1_000) throw new Error('图片说明过长')
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('图片时间无效')
    return this.db.transaction(() => {
      const record = this.getAcceptedRecordContext(recordId)
      if (!record) throw new Error('正式开发记录不存在或尚未通过审核')
      const image = this.db.prepare(`
        SELECT id, recordId, recordId AS commitId, imagePath, caption, sortIndex, createdAt
        FROM development_record_images WHERE id = ? AND recordId = ?
      `).get(imageId, recordId) as {
        id: string; recordId: string; commitId: string; imagePath: string;
        caption: string; sortIndex: number; createdAt: number;
      } | undefined
      if (!image) throw new Error('图片不属于该正式开发记录')
      this.db.prepare('UPDATE development_record_images SET caption = ? WHERE id = ? AND recordId = ?')
        .run(caption, imageId, recordId)
      this.db.prepare('UPDATE development_records SET updatedAt = ? WHERE id = ?').run(now, recordId)
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
      return { ...image, caption }
    })()
  }

  reorderRecordImages(recordId: string, orderedIds: string[], now = Date.now()) {
    if (!Array.isArray(orderedIds) || orderedIds.length > 200) throw new Error('图片排序列表无效')
    if (orderedIds.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error('图片排序包含无效 ID')
    if (new Set(orderedIds).size !== orderedIds.length) throw new Error('图片排序不能包含重复 ID')
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('图片时间无效')
    return this.db.transaction(() => {
      const record = this.getAcceptedRecordContext(recordId)
      if (!record) throw new Error('正式开发记录不存在或尚未通过审核')
      const current = this.db.prepare(`
        SELECT id, recordId, recordId AS commitId, imagePath, caption, sortIndex, createdAt
        FROM development_record_images WHERE recordId = ? ORDER BY sortIndex, createdAt, id
      `).all(recordId) as Array<{
        id: string; recordId: string; commitId: string; imagePath: string;
        caption: string; sortIndex: number; createdAt: number;
      }>
      const requested = new Set(orderedIds)
      if (current.length !== orderedIds.length || current.some(image => !requested.has(image.id))) {
        throw new Error('图片排序必须完整包含该记录的全部图片')
      }
      const update = this.db.prepare(`
        UPDATE development_record_images SET sortIndex = ? WHERE id = ? AND recordId = ?
      `)
      orderedIds.forEach((imageId, sortIndex) => update.run(sortIndex, imageId, recordId))
      this.db.prepare('UPDATE development_records SET updatedAt = ? WHERE id = ?').run(now, recordId)
      this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, record.projectId)
      const byId = new Map(current.map(image => [image.id, image]))
      return orderedIds.map((imageId, sortIndex) => ({ ...byId.get(imageId)!, sortIndex }))
    })()
  }

  importProject(inspection: ProjectInspection, input: { name: string; description: string; status?: string; tagIds?: string[]; coverImagePath?: string; gitHistoryLimit?: number }) {
    const duplicate = this.db.prepare(`
      SELECT id, name FROM projects
      WHERE canonicalPath = ? COLLATE NOCASE
        OR ((canonicalPath IS NULL OR canonicalPath = '') AND (
          path = ? COLLATE NOCASE OR path = ? COLLATE NOCASE
        ))
      LIMIT 1
    `).get(
      inspection.canonicalPath,
      inspection.selectedPath,
      inspection.repositoryRoot,
    ) as { id: string; name: string } | undefined
    if (duplicate) throw new Error(`该目录已导入为项目「${duplicate.name}」`)
    const id = crypto.randomUUID()
    const now = Date.now()
    const defaultStatus = (this.db.prepare('SELECT id FROM project_statuses ORDER BY sortIndex LIMIT 1').get() as { id: string } | undefined)?.id || 'status-developing'
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO projects (
          id, name, description, path, canonicalPath, repoUrl, status,
          coverImagePath, importedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.name, input.description, inspection.repositoryRoot, inspection.canonicalPath,
        inspection.remoteUrl, input.status || defaultStatus, input.coverImagePath || '', now, now, now,
      )
      const tag = this.db.prepare('INSERT OR IGNORE INTO project_tags (projectId, tagId) VALUES (?, ?)')
      for (const tagId of input.tagIds || []) tag.run(id, tagId)
      this.db.prepare(`
        INSERT INTO git_sync_state (
          projectId, headSha, lastSyncedSha, branch, detached, remoteUrl,
          commitCount, lastScannedAt, status, error, historyLimit, historyTruncated
        ) VALUES (?, ?, '', ?, ?, ?, ?, NULL, ?, '', ?, 0)
      `).run(
        id, inspection.headSha, inspection.branch, inspection.detached ? 1 : 0,
        inspection.remoteUrl, inspection.commitCount, inspection.isGitRepository ? 'never' : 'unavailable',
        inspection.isGitRepository ? Math.max(0, Math.trunc(input.gitHistoryLimit || 0)) : 0,
      )
    })()
    return id
  }

  getGitSyncState(projectId: string) {
    return this.db.prepare('SELECT * FROM git_sync_state WHERE projectId = ?').get(projectId) as DbRow | undefined
  }

  getGitCommits(projectId: string, options: { cursor?: string | number; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit || 50, 1), 200)
    const cursor = pageCursor(options.cursor)
    const rows = this.db.prepare(`
      SELECT gc.*, COALESCE(gt.disposition, 'pending') AS disposition, gt.seenAt,
        activeRecord.id AS activeRecordId,
        activeRecord.title AS activeRecordTitle,
        activeRecord.source AS activeRecordSource,
        activeRecord.reviewStatus AS activeRecordReviewStatus
      FROM git_commits gc
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      LEFT JOIN development_records activeRecord ON activeRecord.id = (
        SELECT dr.id
        FROM development_record_git_commits link
        JOIN development_records dr ON dr.id = link.recordId
        WHERE dr.projectId = gc.projectId AND link.gitSha = gc.sha
          AND dr.reviewStatus IN ('draft', 'accepted')
        ORDER BY CASE dr.reviewStatus WHEN 'accepted' THEN 0 ELSE 1 END,
          dr.updatedAt DESC, dr.id DESC
        LIMIT 1
      )
      WHERE gc.projectId = ? AND gc.reachable = 1
        AND (gc.authoredAt < ? OR (gc.authoredAt = ? AND gc.sha < ?))
      ORDER BY gc.authoredAt DESC, gc.sha DESC LIMIT ?
    `).all(projectId, cursor.timestamp, cursor.timestamp, cursor.key, limit + 1) as DbRow[]
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(rowToGitCommit)
    return { items, nextCursor: hasMore ? encodePageCursor(items[items.length - 1].authoredAt, items[items.length - 1].sha) : null }
  }

  setGitCommitDisposition(projectId: string, sha: string, disposition: 'pending' | 'handled' | 'ignored') {
    return this.db.transaction(() => {
      const commit = this.db.prepare(`
        SELECT 1 FROM git_commits WHERE projectId = ? AND sha = ? AND reachable = 1
      `).get(projectId, sha)
      if (!commit) throw new Error('Git 提交不存在、不可达或不属于该项目')
      const activeRecord = this.db.prepare(`
        SELECT dr.id AS recordId, dr.title, dr.source, dr.reviewStatus
        FROM development_record_git_commits link
        JOIN development_records dr ON dr.id = link.recordId
        WHERE dr.projectId = ? AND link.gitSha = ?
          AND dr.reviewStatus IN ('draft', 'accepted')
        ORDER BY CASE dr.reviewStatus WHEN 'accepted' THEN 0 ELSE 1 END,
          dr.updatedAt DESC, dr.id DESC
        LIMIT 1
      `).get(projectId, sha) as {
        recordId: string
        title: string
        source: 'manual' | 'ai'
        reviewStatus: 'draft' | 'accepted'
      } | undefined
      if (activeRecord) {
        const kind = activeRecord.reviewStatus === 'draft' ? '待审核草稿' : '正式开发记录'
        throw new Error(`该 Git 提交已关联${kind}「${activeRecord.title}」，请先处理关联记录`)
      }
      const now = Date.now()
      this.db.prepare(`
        INSERT INTO git_commit_tracking (
          projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
        ) VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(projectId, gitSha) DO UPDATE SET
          disposition = excluded.disposition,
          seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
          handledByRecordId = NULL,
          updatedAt = excluded.updatedAt
      `).run(projectId, sha, disposition, now, now)
      return { projectId, sha, disposition, seenAt: now }
    })()
  }

  markGitCommitsSeen(projectId: string, shas: string[]) {
    const uniqueShas = [...new Set(shas)]
    if (!uniqueShas.length) return 0
    const placeholders = uniqueShas.map(() => '?').join(',')
    const valid = this.db.prepare(`
      SELECT sha FROM git_commits
      WHERE projectId = ? AND reachable = 1 AND sha IN (${placeholders})
    `).all(projectId, ...uniqueShas) as Array<{ sha: string }>
    if (valid.length !== uniqueShas.length) throw new Error('已读范围包含无效或不可达 Git SHA')
    const now = Date.now()
    const mark = this.db.prepare(`
      INSERT INTO git_commit_tracking (
        projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
      ) VALUES (?, ?, 'pending', ?, NULL, ?)
      ON CONFLICT(projectId, gitSha) DO UPDATE SET
        seenAt = COALESCE(git_commit_tracking.seenAt, excluded.seenAt),
        updatedAt = excluded.updatedAt
    `)
    this.db.transaction(() => uniqueShas.forEach(sha => mark.run(projectId, sha, now, now)))()
    return uniqueShas.length
  }

  getAiInput(projectId: string, shas: string[]) {
    if (!shas.length) return []
    const placeholders = shas.map(() => '?').join(',')
    return (this.db.prepare(`
      SELECT gc.* FROM git_commits gc
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      WHERE gc.projectId = ? AND gc.reachable = 1 AND gc.sha IN (${placeholders})
        AND COALESCE(gt.disposition, 'pending') = 'pending'
      ORDER BY gc.authoredAt
    `).all(projectId, ...shas) as DbRow[]).map(rowToGitCommit)
  }

  getDevelopmentRecordUsage(projectId: string, shas: string[]) {
    if (!shas.length) return []
    const placeholders = shas.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT link.gitSha, dr.id AS recordId, dr.source, dr.reviewStatus
      FROM development_record_git_commits link
      JOIN development_records dr ON dr.id = link.recordId
      WHERE dr.projectId = ? AND link.gitSha IN (${placeholders})
        AND dr.reviewStatus IN ('draft', 'accepted')
    `).all(projectId, ...shas) as Array<{
      gitSha: string
      recordId: string
      source: 'manual' | 'ai'
      reviewStatus: 'draft' | 'accepted'
    }>
  }

  getAiInputPreview(projectId: string, options: {
    cursor?: string | number
    limit?: number
    authoredAfter?: number
    authoredBefore?: number
  } = {}) {
    const limit = Math.min(Math.max(options.limit || 50, 1), 100)
    const cursor = ascendingPageCursor(options.cursor)
    const filters = [
      'gc.projectId = ?',
      'gc.reachable = 1',
      "COALESCE(gt.disposition, 'pending') = 'pending'",
      `NOT EXISTS (
        SELECT 1 FROM development_record_git_commits link
        JOIN development_records dr ON dr.id = link.recordId
        WHERE link.gitSha = gc.sha AND dr.projectId = gc.projectId AND dr.reviewStatus IN ('draft', 'accepted')
      )`,
    ]
    const filterParams: Array<string | number> = [projectId]
    if (options.authoredAfter !== undefined) {
      filters.push('gc.authoredAt >= ?')
      filterParams.push(options.authoredAfter)
    }
    if (options.authoredBefore !== undefined) {
      filters.push('gc.authoredAt <= ?')
      filterParams.push(options.authoredBefore)
    }
    const where = filters.join('\n        AND ')
    const aggregate = this.db.prepare(`
      SELECT COUNT(*) AS total, MIN(gc.authoredAt) AS oldest, MAX(gc.authoredAt) AS newest
      FROM git_commits gc
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      WHERE ${where}
    `).get(...filterParams) as { total: number | bigint; oldest: number | null; newest: number | null }
    const rows = this.db.prepare(`
      SELECT gc.* FROM git_commits gc
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      WHERE ${where}
        AND (gc.authoredAt > ? OR (gc.authoredAt = ? AND gc.sha > ?))
      ORDER BY gc.authoredAt ASC, gc.sha ASC LIMIT ?
    `).all(...filterParams, cursor.timestamp, cursor.timestamp, cursor.key, limit + 1) as DbRow[]
    const hasMore = rows.length > limit
    const commits = rows.slice(0, limit).map(rowToGitCommit)
    return {
      commits,
      shas: commits.map(commit => commit.sha),
      nextCursor: hasMore ? encodePageCursor(commits[commits.length - 1].authoredAt, commits[commits.length - 1].sha) : null,
      totalPending: Number(aggregate.total || 0),
      oldestAuthoredAt: aggregate.oldest === null ? null : Number(aggregate.oldest),
      newestAuthoredAt: aggregate.newest === null ? null : Number(aggregate.newest),
      files: [...new Set(commits.flatMap(commit => commit.fileNames))].sort(),
      totalStats: commits.reduce((sum, commit) => ({
        added: sum.added + commit.stats.added,
        deleted: sum.deleted + commit.stats.deleted,
        files: sum.files + commit.stats.files,
      }), { added: 0, deleted: 0, files: 0 }),
    }
  }

  beginAiGenerationRun(input: {
    projectId: string; provider: string; model: string; promptVersion: string; inputHash?: string;
    inputShas: string[]; rulesVersion?: number; rulesSnapshot?: unknown; settingsSnapshot?: unknown;
    inputSnapshot?: unknown; replaceDraftIds?: string[];
  }) {
    const generationRunId = crypto.randomUUID()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO ai_generation_runs (
        id, projectId, provider, model, promptVersion, inputHash, inputShasJson, outputJson,
        status, rulesVersion, rulesSnapshotJson, settingsSnapshotJson, inputSnapshotJson,
        replaceDraftIdsJson, error, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'running', ?, ?, ?, ?, ?, '', ?, ?)
    `).run(
      generationRunId, input.projectId, input.provider, input.model, input.promptVersion,
      input.inputHash || '', JSON.stringify(input.inputShas), input.rulesVersion || 0,
      JSON.stringify(input.rulesSnapshot || {}), JSON.stringify(input.settingsSnapshot || {}),
      JSON.stringify(input.inputSnapshot || {}), JSON.stringify(input.replaceDraftIds || []), now, now,
    )
    return generationRunId
  }

  completeAiGenerationRun(generationRunId: string, input: {
    inputHash: string; output: unknown;
    records: Array<{ title: string; description: string; gitShas: string[]; confidence: number; evidence: string[] }>;
  }) {
    const run = this.db.prepare(`
      SELECT projectId, provider, model, promptVersion, replaceDraftIdsJson
      FROM ai_generation_runs WHERE id = ? AND status = 'running'
    `).get(generationRunId) as DbRow | undefined
    if (!run) throw new Error('AI generation run 不存在或已经结束')

    const assignedShas = new Set<string>()
    for (const record of input.records) {
      for (const sha of record.gitShas) {
        if (assignedShas.has(sha)) throw new Error('同一个 Git SHA 不能同时分配给多条待审核草稿')
        assignedShas.add(sha)
      }
    }
    const projectId = String(run.projectId)
    const replaceDraftIds = parseJson<string[]>(run.replaceDraftIdsJson, [])
    const now = Date.now()
    const ids: string[] = []
    this.db.transaction(() => {
      if (replaceDraftIds.length) {
        const placeholders = replaceDraftIds.map(() => '?').join(',')
        const replaceable = this.db.prepare(`
          SELECT COUNT(*) AS count FROM development_records
          WHERE projectId = ? AND source = 'ai' AND reviewStatus = 'draft'
            AND id IN (${placeholders})
        `).get(projectId, ...replaceDraftIds) as { count: number | bigint }
        if (Number(replaceable.count) !== replaceDraftIds.length) {
          throw new Error('待替换草稿已发生变化，请刷新后重试')
        }
        // Release the old draft links before inserting replacements. This is
        // inside the same transaction, so any later validation or insert
        // failure restores the original drafts atomically.
        this.db.prepare(`
          UPDATE development_records SET reviewStatus = 'rejected', updatedAt = ?
          WHERE projectId = ? AND source = 'ai' AND reviewStatus = 'draft'
            AND id IN (${placeholders})
        `).run(now, projectId, ...replaceDraftIds)
      }

      const insertRecord = this.db.prepare(`
        INSERT INTO development_records (
          id, projectId, title, description, source, reviewStatus, provider, model,
          promptVersion, inputHash, generationRunId, confidence, evidenceJson,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 'ai', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const link = this.db.prepare('INSERT OR IGNORE INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      for (const record of input.records) {
        const id = crypto.randomUUID()
        ids.push(id)
        insertRecord.run(
          id, projectId, record.title, record.description, run.provider, run.model,
          run.promptVersion, input.inputHash, generationRunId, record.confidence,
          JSON.stringify(record.evidence), now, now,
        )
        for (const sha of record.gitShas) link.run(id, sha)
      }
      const completed = this.db.prepare(`
        UPDATE ai_generation_runs SET
          status = 'succeeded', inputHash = ?, outputJson = ?, error = '', updatedAt = ?, completedAt = ?
        WHERE id = ? AND status = 'running'
      `).run(input.inputHash, JSON.stringify(input.output), now, now, generationRunId)
      if (completed.changes !== 1) throw new Error('AI generation run 状态已发生变化')
    })()
    return { draftIds: ids, generationRunId }
  }

  finishAiGenerationRun(generationRunId: string, status: 'failed' | 'cancelled', error: string) {
    const now = Date.now()
    return this.db.prepare(`
      UPDATE ai_generation_runs SET status = ?, error = ?, updatedAt = ?, completedAt = ?
      WHERE id = ? AND status = 'running'
    `).run(status, error, now, now, generationRunId).changes > 0
  }

  recoverInterruptedAiGenerationRuns(now = Date.now()) {
    const message = '应用上次退出时 AI 生成仍在执行，已标记为中断；可以按原提交范围重试'
    return this.db.prepare(`
      UPDATE ai_generation_runs SET
        status = 'failed', error = ?, updatedAt = ?, completedAt = ?
      WHERE status = 'running'
    `).run(message, now, now).changes
  }

  getAiGenerationRuns(projectId: string, limit = 20) {
    return (this.db.prepare(`
      SELECT run.id, run.projectId, run.provider, run.model, run.promptVersion, run.inputHash,
        run.inputShasJson, run.status, run.rulesVersion, run.error, run.createdAt, run.updatedAt,
        run.completedAt,
        (SELECT COUNT(*) FROM ai_project_suggestion_applications application
          WHERE application.generationRunId = run.id) AS suggestionApplicationCount,
        SUM(CASE WHEN record.reviewStatus = 'draft' THEN 1 ELSE 0 END) AS draftCount,
        SUM(CASE WHEN record.reviewStatus = 'accepted' THEN 1 ELSE 0 END) AS acceptedCount,
        SUM(CASE WHEN record.reviewStatus = 'rejected' THEN 1 ELSE 0 END) AS rejectedCount
      FROM ai_generation_runs run
      LEFT JOIN development_records record ON record.generationRunId = run.id
      WHERE run.projectId = ?
      GROUP BY run.id
      ORDER BY run.createdAt DESC, run.id DESC LIMIT ?
    `).all(projectId, Math.min(Math.max(limit, 1), 100)) as DbRow[]).map(row => ({
      id: String(row.id),
      projectId: String(row.projectId),
      provider: String(row.provider || ''),
      model: String(row.model || ''),
      promptVersion: String(row.promptVersion || ''),
      inputHash: String(row.inputHash || ''),
      inputShas: parseJson<string[]>(row.inputShasJson, []),
      status: String(row.status || 'succeeded') as 'running' | 'succeeded' | 'failed' | 'cancelled',
      rulesVersion: Number(row.rulesVersion || 0),
      error: String(row.error || ''),
      createdAt: Number(row.createdAt || 0),
      updatedAt: Number(row.updatedAt || row.createdAt || 0),
      completedAt: row.completedAt === null || row.completedAt === undefined ? null : Number(row.completedAt),
      suggestionApplicationCount: Number(row.suggestionApplicationCount || 0),
      draftCount: Number(row.draftCount || 0),
      acceptedCount: Number(row.acceptedCount || 0),
      rejectedCount: Number(row.rejectedCount || 0),
    }))
  }

  getAiGenerationRun(projectId: string, generationRunId: string) {
    const row = this.db.prepare(`
      SELECT * FROM ai_generation_runs WHERE id = ? AND projectId = ?
    `).get(generationRunId, projectId) as DbRow | undefined
    if (!row) return null
    const records = this.hydrateRecords(this.db.prepare(`
      SELECT * FROM development_records WHERE generationRunId = ? ORDER BY createdAt, id
    `).all(generationRunId) as DbRow[])
    const projectSuggestionApplications = (this.db.prepare(`
      SELECT id, projectId, generationRunId, inputShasJson, beforeJson, appliedJson, createdAt
      FROM ai_project_suggestion_applications
      WHERE generationRunId = ? AND projectId = ?
      ORDER BY createdAt DESC, id DESC
    `).all(generationRunId, projectId) as DbRow[]).map(application => ({
      id: String(application.id),
      projectId: String(application.projectId),
      generationRunId: String(application.generationRunId),
      inputShas: parseJson<string[]>(application.inputShasJson, []),
      before: parseJson<Record<string, unknown>>(application.beforeJson, {}),
      applied: parseJson<Record<string, unknown>>(application.appliedJson, {}),
      createdAt: Number(application.createdAt || 0),
    }))
    return {
      id: String(row.id),
      projectId: String(row.projectId),
      provider: String(row.provider || ''),
      model: String(row.model || ''),
      promptVersion: String(row.promptVersion || ''),
      inputHash: String(row.inputHash || ''),
      inputShas: parseJson<string[]>(row.inputShasJson, []),
      status: String(row.status || 'succeeded') as 'running' | 'succeeded' | 'failed' | 'cancelled',
      rulesVersion: Number(row.rulesVersion || 0),
      error: String(row.error || ''),
      createdAt: Number(row.createdAt || 0),
      updatedAt: Number(row.updatedAt || row.createdAt || 0),
      completedAt: row.completedAt === null || row.completedAt === undefined ? null : Number(row.completedAt),
      suggestionApplicationCount: projectSuggestionApplications.length,
      draftCount: records.filter(record => record.reviewStatus === 'draft').length,
      acceptedCount: records.filter(record => record.reviewStatus === 'accepted').length,
      rejectedCount: records.filter(record => record.reviewStatus === 'rejected').length,
      output: parseJson<unknown>(row.outputJson, {}),
      rulesSnapshot: parseJson<unknown>(row.rulesSnapshotJson, {}),
      settingsSnapshot: parseJson<unknown>(row.settingsSnapshotJson, {}),
      inputSnapshot: parseJson<unknown>(row.inputSnapshotJson, {}),
      replaceDraftIds: parseJson<string[]>(row.replaceDraftIdsJson, []),
      projectSuggestionApplications,
      drafts: records,
    }
  }

  insertAiDrafts(input: {
    projectId: string; provider: string; model: string; promptVersion: string; inputHash: string;
    inputShas: string[]; output: unknown;
    records: Array<{ title: string; description: string; gitShas: string[]; confidence: number; evidence: string[] }>;
    replaceDraftIds?: string[];
  }) {
    const generationRunId = this.beginAiGenerationRun({
      projectId: input.projectId, provider: input.provider, model: input.model,
      promptVersion: input.promptVersion, inputHash: input.inputHash, inputShas: input.inputShas,
      replaceDraftIds: input.replaceDraftIds,
    })
    try {
      return this.completeAiGenerationRun(generationRunId, input)
    } catch (error) {
      this.finishAiGenerationRun(generationRunId, 'failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  getAiRules(projectId: string): (DbRow & { exclusions: string[]; customRules: string[] }) | null {
    const row = this.db.prepare(`
      SELECT * FROM project_ai_rules WHERE projectId = ? AND isActive = 1 ORDER BY version DESC LIMIT 1
    `).get(projectId) as DbRow | undefined
    if (!row) return null
    return {
      ...row,
      exclusions: parseJson<string[]>(row.exclusionsJson, []),
      customRules: parseJson<string[]>(row.customRulesJson, []),
    }
  }

  listAiRules(projectId: string) {
    return (this.db.prepare(`
      SELECT * FROM project_ai_rules WHERE projectId = ? ORDER BY version DESC LIMIT 30
    `).all(projectId) as DbRow[]).map(row => ({
      ...row,
      exclusions: parseJson<string[]>(row.exclusionsJson, []),
      customRules: parseJson<string[]>(row.customRulesJson, []),
    }))
  }

  saveAiRules(projectId: string, input: { language: string; toneMode: string; summaryGuidance: string; recordGuidance: string; exclusions: string[]; customRules: string[] }) {
    const current = this.getAiRules(projectId)
    const version = Number(current?.version || 0) + 1
    const id = crypto.randomUUID()
    this.db.transaction(() => {
      this.db.prepare('UPDATE project_ai_rules SET isActive = 0 WHERE projectId = ?').run(projectId)
      this.db.prepare(`
        INSERT INTO project_ai_rules (
          id, projectId, version, language, toneMode, summaryGuidance, recordGuidance,
          exclusionsJson, customRulesJson, isActive, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        id, projectId, version, input.language, input.toneMode, input.summaryGuidance,
        input.recordGuidance, JSON.stringify(input.exclusions), JSON.stringify(input.customRules), Date.now(),
      )
    })()
    return { id, version }
  }

  getDashboardSummary() {
    const projects = this.getProjectSummaries()
    const recentGit = this.db.prepare(`
      SELECT gc.projectId, p.name AS projectName, gc.sha, gc.subject, gc.authoredAt,
        gt.seenAt, COALESCE(gt.disposition, 'pending') AS disposition
      FROM git_commits gc JOIN projects p ON p.id = gc.projectId
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      WHERE gc.reachable = 1 AND COALESCE(gt.disposition, 'pending') = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM development_record_git_commits link
          JOIN development_records dr ON dr.id = link.recordId
          WHERE dr.projectId = gc.projectId AND link.gitSha = gc.sha
            AND dr.reviewStatus IN ('draft', 'accepted')
        )
      ORDER BY gc.createdAt DESC LIMIT 12
    `).all()
    const pendingGit = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM git_commits gc
      LEFT JOIN git_commit_tracking gt ON gt.projectId = gc.projectId AND gt.gitSha = gc.sha
      WHERE gc.reachable = 1 AND COALESCE(gt.disposition, 'pending') = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM development_record_git_commits link
          JOIN development_records dr ON dr.id = link.recordId
          WHERE dr.projectId = gc.projectId AND link.gitSha = gc.sha
            AND dr.reviewStatus IN ('draft', 'accepted')
        )
    `).get() as { count: number | bigint }
    const failures = projects.filter(project => project.gitSync.status === 'failed')
    const openTodos = this.db.prepare(`
      SELECT td.id, td.projectId, p.name AS projectName, td.content, td.createdAt
      FROM todos td JOIN projects p ON p.id = td.projectId
      WHERE td.completed = 0 ORDER BY td.createdAt ASC LIMIT 12
    `).all()
    return {
      counts: {
        projects: projects.length,
        pendingGit: Number(pendingGit.count),
        pendingDrafts: projects.reduce((sum, project) => sum + Number(project.draftCount || 0), 0),
        openTodos: projects.reduce((sum, project) => sum + Number(project.openTodoCount || 0), 0),
        launchable: projects.filter(project => project.launchCapability?.validated).length,
      },
      recentGit,
      pendingReview: projects.filter(project => Number(project.draftCount) > 0),
      recentProjects: projects.slice(0, 6),
      launchableProjects: projects.filter(project => project.launchCapability?.validated).slice(0, 8),
      failures,
      openTodos,
    }
  }
}
