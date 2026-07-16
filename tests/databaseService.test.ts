import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { DatabaseService } from '../electron/services/databaseService.ts'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'
import { deleteRecordAndManagedAssets } from '../electron/services/assetService.ts'
import { persistProjectRelinkMetadata } from '../electron/services/gitRepository.ts'

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-database-service-'))
  const dbPath = path.join(directory, 'test.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  migrateDatabase(db, { dbPath })
  const compatibleDatabase = {
    prepare: (sql: string) => db.prepare(sql),
    transaction: (operation: () => unknown) => () => {
      db.exec('BEGIN')
      try {
        const result = operation()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { directory, db, service: new DatabaseService(compatibleDatabase as never) }
}

test('project import rejects a legacy row that only has the same local path', () => {
  const { directory, db, service } = createFixture()
  try {
    const localPath = 'F:\\AI\\LegacyProject'
    db.prepare('INSERT INTO projects (id, name, path, canonicalPath, createdAt, updatedAt) VALUES (?, ?, ?, NULL, ?, ?)')
      .run('legacy-project', '旧项目', localPath.toLowerCase(), 1, 1)
    assert.throws(() => service.importProject({
      selectedPath: localPath,
      canonicalPath: localPath,
      isGitRepository: false,
      gitAvailable: true,
      repositoryRoot: localPath,
      projectName: 'LegacyProject',
      branch: '',
      headSha: '',
      detached: false,
      emptyRepository: false,
      commitCount: 0,
      recentCommits: [],
      remoteUrl: '',
      techStack: [],
      readmeSummary: '',
      launchCandidates: [],
      assetCandidates: [],
      warnings: [],
    }, { name: '重复项目', description: '' }), /该目录已导入为项目「旧项目」/)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count, 1)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('project details keep relinked repository image references visible until users replace them', () => {
  const { directory, db, service } = createFixture()
  try {
    const oldRoot = path.join(directory, 'old-repository')
    const newRoot = path.join(directory, 'new-repository')
    const oldCover = path.join(oldRoot, 'cover.png')
    const oldRecordImage = path.join(oldRoot, 'record.png')
    const managedOldImage = path.join(oldRoot, 'managed.png')
    db.prepare(`
      INSERT INTO projects (
        id, name, path, canonicalPath, coverImagePath, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('project-relink', '重关联项目', oldRoot, oldRoot, oldCover, 1, 1)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, '', 'manual', 'accepted', ?, ?)
    `).run('record-relink', 'project-relink', '旧仓库截图记录', 1, 1)
    db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, '', 0, ?), (?, ?, ?, '', 1, ?)
    `).run(
      'image-external', 'record-relink', oldRecordImage, 1,
      'image-managed', 'record-relink', managedOldImage, 1,
    )
    db.prepare(`
      INSERT INTO managed_assets (id, projectId, recordId, path, kind, createdAt)
      VALUES (?, ?, ?, ?, 'record-image', ?)
    `).run('managed-1', 'project-relink', 'record-relink', managedOldImage, 1)

    persistProjectRelinkMetadata(db, 'project-relink', {
      selectedPath: newRoot,
      canonicalPath: newRoot,
      isGitRepository: true,
      gitAvailable: true,
      repositoryRoot: newRoot,
      projectName: 'new-repository',
      branch: 'main',
      headSha: 'a'.repeat(40),
      detached: false,
      emptyRepository: false,
      commitCount: 1,
      recentCommits: [],
      remoteUrl: '',
      techStack: [],
      readmeSummary: '',
      launchCandidates: [],
      assetCandidates: [],
      warnings: [],
    }, 2)

    const project = service.getProject('project-relink') as { assetWarnings: Array<Record<string, unknown>> }
    assert.deepEqual(project.assetWarnings, [{
      kind: 'cover', path: oldCover, recordId: null, recordTitle: null,
    }, {
      kind: 'record-image', path: oldRecordImage,
      recordId: 'record-relink', recordTitle: '旧仓库截图记录',
    }])

    db.prepare('UPDATE projects SET coverImagePath = ? WHERE id = ?')
      .run(path.join(newRoot, 'cover.png'), 'project-relink')
    db.prepare('DELETE FROM development_record_images WHERE id = ?').run('image-external')
    assert.deepEqual(service.getRelinkAssetWarnings('project-relink'), [])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('updating an accepted development record refreshes project activity and rejects invalid targets', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '记录编辑', 1, 10)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'manual', 'accepted', ?, ?)
    `).run('record-1', 'project-1', '旧标题', '旧内容', 20, 20)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'ai', 'draft', ?, ?)
    `).run('draft-1', 'project-1', '草稿标题', '草稿内容', 30, 30)

    assert.equal(service.updateRecord('record-1', {
      title: '新标题', description: '新内容', createdAt: 40,
    }), true)
    const record = db.prepare(`
      SELECT title, description, createdAt, updatedAt, userEditedAt
      FROM development_records WHERE id = ?
    `).get('record-1') as Record<string, string | number>
    const project = db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }
    assert.deepEqual({ title: record.title, description: record.description, createdAt: record.createdAt }, {
      title: '新标题', description: '新内容', createdAt: 40,
    })
    assert.equal(record.updatedAt, project.updatedAt)
    assert.equal(record.userEditedAt, project.updatedAt)
    assert.ok(project.updatedAt > 10)

    const activityTime = project.updatedAt
    assert.equal(service.updateRecord('record-1', {
      title: '新标题', description: '新内容', createdAt: 40,
    }), true)
    const unchanged = db.prepare(`
      SELECT updatedAt, userEditedAt FROM development_records WHERE id = ?
    `).get('record-1') as { updatedAt: number; userEditedAt: number }
    assert.equal(unchanged.updatedAt, activityTime)
    assert.equal(unchanged.userEditedAt, activityTime)
    assert.equal((db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }).updatedAt, activityTime)
    assert.equal(service.updateRecord('missing-record', { title: '不存在' }), false)
    assert.equal(service.updateRecord('draft-1', { title: '不能越过审核' }), false)
    assert.equal(service.updateRecord('record-1', {}), false)
    assert.equal((db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }).updatedAt, activityTime)
    assert.equal((db.prepare('SELECT title FROM development_records WHERE id = ?').get('draft-1') as { title: string }).title, '草稿标题')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI project suggestions atomically update metadata, reuse tags, and create missing tags once', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, description, phase, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('project-1', '旧名称', '旧简介', '旧阶段', 1, 10)
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      .run('tag-existing', 'React', '#61DAFB', 1)
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      .run('tag-preserved', '保留标签', '#FFFFFF', 2)
    db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)')
      .run('project-1', 'tag-preserved')
    db.prepare(`
      INSERT INTO ai_generation_runs (
        id, projectId, provider, model, promptVersion, inputHash,
        inputShasJson, outputJson, createdAt, updatedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run-project-suggestion', 'project-1', 'openai-compatible', 'test-model', 'v1', 'hash',
      JSON.stringify(['a'.repeat(40)]), JSON.stringify({ project: { name: 'AI 建议名称' } }), 5, 5, 5,
    )

    const first = service.applyAiProjectSuggestion('project-1', 'run-project-suggestion', {
      name: 'AI 建议名称',
      description: 'AI 建议简介',
      phase: '验证阶段',
      tagNames: ['react', 'Electron', 'Electron'],
    })
    assert.equal(first.createdTags.length, 1)
    assert.equal(first.generationRunId, 'run-project-suggestion')
    assert.deepEqual(first.inputShas, ['a'.repeat(40)])
    assert.equal(first.createdTags[0].name, 'Electron')
    const project = db.prepare('SELECT name, description, phase, updatedAt FROM projects WHERE id = ?')
      .get('project-1') as { name: string; description: string; phase: string; updatedAt: number }
    assert.deepEqual({ name: project.name, description: project.description, phase: project.phase }, {
      name: 'AI 建议名称', description: 'AI 建议简介', phase: '验证阶段',
    })
    assert.ok(project.updatedAt > 10)
    const linkedNames = (db.prepare(`
      SELECT t.name FROM project_tags pt JOIN tags t ON t.id = pt.tagId
      WHERE pt.projectId = ? ORDER BY t.name
    `).all('project-1') as Array<{ name: string }>).map(item => item.name)
    assert.deepEqual(new Set(linkedNames), new Set(['保留标签', 'React', 'Electron']))

    const second = service.applyAiProjectSuggestion('project-1', 'run-project-suggestion', {
      name: 'AI 建议名称', description: 'AI 建议简介', phase: '验证阶段', tagNames: ['REACT', 'electron'],
    })
    assert.equal(second.createdTags.length, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tags').get() as { count: number }).count, 3)
    const traced = service.getAiGenerationRun('project-1', 'run-project-suggestion')
    assert.equal(traced?.projectSuggestionApplications.length, 2)
    assert.equal(traced?.projectSuggestionApplications[0].generationRunId, 'run-project-suggestion')
    assert.equal(traced?.projectSuggestionApplications[1].before.name, '旧名称')

    assert.throws(() => service.applyAiProjectSuggestion('missing-project', 'run-project-suggestion', {
      name: '不存在', description: '', phase: '', tagNames: ['不应残留'],
    }), /项目不存在/)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tags WHERE name = ?').get('不应残留') as { count: number }).count, 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('accepting an AI draft refreshes project activity while rejected or repeated reviews do not', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '草稿审核', 1, 10)
    const insertDraft = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'ai', 'draft', ?, ?)
    `)
    insertDraft.run('draft-accepted', 'project-1', 'AI 标题', 'AI 内容', 20, 20)
    insertDraft.run('draft-rejected', 'project-1', '不采用', '不采用', 21, 21)
    insertDraft.run('draft-unchanged', 'project-1', 'AI 原样', 'AI 原样内容', 22, 22)

    assert.equal(service.reviewDraft('draft-accepted', 'accepted', { title: '审核后标题', description: '审核后内容' }), true)
    const accepted = db.prepare(`
      SELECT title, description, reviewStatus, updatedAt, userEditedAt
      FROM development_records WHERE id = ?
    `).get('draft-accepted') as Record<string, string | number>
    const project = db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }
    assert.deepEqual({ title: accepted.title, description: accepted.description, reviewStatus: accepted.reviewStatus }, {
      title: '审核后标题', description: '审核后内容', reviewStatus: 'accepted',
    })
    assert.equal(accepted.updatedAt, project.updatedAt)
    assert.equal(accepted.userEditedAt, project.updatedAt)
    assert.ok(project.updatedAt > 10)

    assert.equal(service.reviewDraft('draft-unchanged', 'accepted', {
      title: 'AI 原样', description: 'AI 原样内容',
    }), true)
    const unchanged = db.prepare(`
      SELECT reviewStatus, userEditedAt FROM development_records WHERE id = ?
    `).get('draft-unchanged') as { reviewStatus: string; userEditedAt: number | null }
    assert.equal(unchanged.reviewStatus, 'accepted')
    assert.equal(unchanged.userEditedAt, null)

    const activityTime = (db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }).updatedAt
    assert.equal(service.reviewDraft('draft-accepted', 'accepted'), false)
    assert.equal(service.reviewDraft('draft-rejected', 'rejected'), true)
    assert.equal((db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }).updatedAt, activityTime)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI regeneration replaces old drafts atomically and preserves them when replacement validation fails', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '原子重新生成', 1, 10)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'ai', 'draft', ?, ?)
    `).run('old-draft', 'project-1', '旧草稿', '旧内容', 20, 20)
    const sha = 'a'.repeat(40)
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      .run('old-draft', sha)

    assert.throws(() => service.insertAiDrafts({
      projectId: 'project-1', provider: 'test', model: 'test-model', promptVersion: 'v1', inputHash: 'hash-failed',
      inputShas: [sha], output: {}, replaceDraftIds: ['missing-draft'],
      records: [{ title: '不应保存', description: '', gitShas: [sha], confidence: 0.5, evidence: [] }],
    }), /待替换草稿已发生变化/)
    assert.equal((db.prepare('SELECT reviewStatus FROM development_records WHERE id = ?').get('old-draft') as { reviewStatus: string }).reviewStatus, 'draft')
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, error FROM ai_generation_runs ORDER BY createdAt LIMIT 1
    `).get() as object) }, {
      status: 'failed', error: '待替换草稿已发生变化，请刷新后重试',
    })

    const generated = service.insertAiDrafts({
      projectId: 'project-1', provider: 'test', model: 'test-model', promptVersion: 'v1', inputHash: 'hash-success',
      inputShas: [sha], output: { ok: true }, replaceDraftIds: ['old-draft'],
      records: [{ title: '新草稿', description: '新内容', gitShas: [sha], confidence: 0.9, evidence: ['commit'] }],
    })
    assert.equal(generated.draftIds.length, 1)
    assert.equal((db.prepare('SELECT reviewStatus FROM development_records WHERE id = ?').get('old-draft') as { reviewStatus: string }).reviewStatus, 'rejected')
    const usage = service.getDevelopmentRecordUsage('project-1', [sha])
    assert.deepEqual(usage.map(item => ({ recordId: item.recordId, status: item.reviewStatus })), [
      { recordId: generated.draftIds[0], status: 'draft' },
    ])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI generation runs preserve snapshots and reviewed drafts for reopening', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '运行历史', 1, 1)
    const sha = 'f'.repeat(40)
    db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, reachable, createdAt)
      VALUES ('git-1', 'project-1', ?, 'history', 10, 1, 10)
    `).run(sha)
    const generationRunId = service.beginAiGenerationRun({
      projectId: 'project-1', provider: 'openai-compatible', model: 'model-a', promptVersion: 'prompt-v1',
      inputShas: [sha], rulesVersion: 3,
      rulesSnapshot: { language: 'zh-CN', customRules: ['保留事实'] },
      settingsSnapshot: { baseUrl: 'http://127.0.0.1/v1', model: 'model-a' },
      inputSnapshot: { project: { name: '运行历史' }, commits: [{ sha }] },
    })
    const persisted = service.completeAiGenerationRun(generationRunId, {
      inputHash: 'hash-a',
      output: { project: { name: '建议名称' }, records: [], assetNotes: [] },
      records: [{ title: '可恢复草稿', description: '内容', gitShas: [sha], confidence: 0.9, evidence: ['commit'] }],
    })

    const reopened = service.getAiGenerationRun('project-1', generationRunId)
    assert.equal(reopened?.status, 'succeeded')
    assert.equal(reopened?.rulesVersion, 3)
    assert.deepEqual(reopened?.inputShas, [sha])
    assert.deepEqual(reopened?.rulesSnapshot, { language: 'zh-CN', customRules: ['保留事实'] })
    assert.equal(reopened?.drafts[0]?.reviewStatus, 'draft')
    assert.equal(service.reviewDraft(persisted.draftIds[0], 'accepted'), true)

    const reviewed = service.getAiGenerationRun('project-1', generationRunId)
    assert.equal(reviewed?.drafts[0]?.reviewStatus, 'accepted')
    const summary = service.getAiGenerationRuns('project-1')[0]
    assert.deepEqual({ status: summary.status, draftCount: summary.draftCount, acceptedCount: summary.acceptedCount }, {
      status: 'succeeded', draftCount: 0, acceptedCount: 1,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('startup recovery turns interrupted AI generation runs into retryable failures', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '中断恢复', 1, 1)
    const generationRunId = service.beginAiGenerationRun({
      projectId: 'project-1', provider: 'openai-compatible', model: 'model-a', promptVersion: 'prompt-v1',
      inputShas: ['a'.repeat(40)], rulesVersion: 1,
      rulesSnapshot: { language: 'zh-CN' },
      settingsSnapshot: { baseUrl: 'http://127.0.0.1/v1', model: 'model-a' },
      inputSnapshot: { project: { name: '中断恢复' }, commits: [{ sha: 'a'.repeat(40) }] },
    })

    assert.equal(service.recoverInterruptedAiGenerationRuns(1_234), 1)
    const recovered = service.getAiGenerationRun('project-1', generationRunId)
    assert.equal(recovered?.status, 'failed')
    assert.equal(recovered?.completedAt, 1_234)
    assert.match(recovered?.error || '', /应用上次退出时 AI 生成仍在执行/)
    assert.equal(service.recoverInterruptedAiGenerationRuns(2_000), 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('record and Git pagination do not skip rows that share the same timestamp', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '复合游标', 1, 1)
    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, 'project-1', ?, 'manual', 'accepted', 1000, 1000)
    `)
    ;['record-a', 'record-b', 'record-c'].forEach(id => insertRecord.run(id, id))
    const recordPage1 = service.getRecordsPage('project-1', { limit: 2 })
    const recordPage2 = service.getRecordsPage('project-1', { limit: 2, cursor: recordPage1.nextCursor! })
    assert.deepEqual([...recordPage1.items, ...recordPage2.items].map(item => item.id), ['record-c', 'record-b', 'record-a'])

    const insertCommit = db.prepare(`
      INSERT INTO git_commits (
        id, projectId, sha, subject, authoredAt, createdAt
      ) VALUES (?, 'project-1', ?, ?, 2000, 2000)
    `)
    ;['a', 'b', 'c'].forEach(letter => {
      const sha = letter.repeat(40)
      insertCommit.run(`git-${letter}`, sha, `commit-${letter}`)
    })
    const gitPage1 = service.getGitCommits('project-1', { limit: 2 })
    const gitPage2 = service.getGitCommits('project-1', { limit: 2, cursor: gitPage1.nextCursor! })
    assert.deepEqual([...gitPage1.items, ...gitPage2.items].map(item => item.subject), ['commit-c', 'commit-b', 'commit-a'])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('project summaries prefer a validated Launch Profile over a newer unvalidated candidate', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '启动摘要', 1, 1)
    const insert = db.prepare(`
      INSERT INTO launch_profiles (
        id, projectId, name, executable, cwd, readyUrl, enabled, validated, confirmedHash, createdAt, updatedAt
      ) VALUES (?, 'project-1', ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `)
    insert.run('validated-profile', '已确认', process.execPath, process.cwd(), 'http://127.0.0.1:5173', 1, 'confirmed', 10, 10)
    insert.run('new-candidate', '新候选', process.execPath, process.cwd(), '', 0, '', 20, 20)

    const project = service.getProjectSummaries().find(item => item.id === 'project-1')
    assert.deepEqual(project?.launchCapability, {
      profileId: 'validated-profile',
      validated: true,
      canOpen: true,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('single-project detail queries only the requested summary and does not preload the record timeline', () => {
  const { directory, db, service } = createFixture()
  try {
    const insertProject = db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    insertProject.run('project-1', '目标项目', 1, 20)
    insertProject.run('project-2', '其他项目', 1, 10)
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      .run('tag-1', '目标标签', '#74A9FF', 1)
    db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)').run('project-1', 'tag-1')
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('record-1', 'project-1', '最近记录', 'manual', 'accepted', 30, 30)
    `).run()
    db.prepare(`
      INSERT INTO noteblocks (id, projectId, content, createdAt, updatedAt)
      VALUES ('note-1', 'project-1', '目标备注', 1, 1), ('note-2', 'project-2', '其他备注', 1, 1)
    `).run()
    db.prepare(`
      INSERT INTO todos (id, projectId, content, completed, createdAt, updatedAt)
      VALUES ('todo-1', 'project-1', '目标待办', 0, 1, 1), ('todo-2', 'project-2', '其他待办', 0, 1, 1)
    `).run()

    const summaries = service.getProjectSummaries('project-1')
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0].id, 'project-1')
    assert.deepEqual((summaries[0].tags as Array<{ id: string }>).map(tag => tag.id), ['tag-1'])
    assert.equal((summaries[0].recentCommit as { id: string }).id, 'record-1')

    const detail = service.getProject('project-1') as Record<string, unknown>
    assert.deepEqual((detail.noteblocks as Array<{ id: string }>).map(note => note.id), ['note-1'])
    assert.deepEqual((detail.todos as Array<{ id: string }>).map(todo => todo.id), ['todo-1'])
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'commits'), false)
    assert.equal(service.getProjectSummaries('missing-project').length, 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('current Git and AI queries exclude unreachable history while accepted records keep their SHA trace', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '历史重写', 1, 1)
    const currentSha = 'c'.repeat(40)
    const archivedSha = 'a'.repeat(40)
    const insertCommit = db.prepare(`
      INSERT INTO git_commits (
        id, projectId, sha, subject, authoredAt, reachable, lastSeenGeneration, createdAt
      ) VALUES (?, 'project-1', ?, ?, ?, ?, ?, ?)
    `)
    insertCommit.run('git-current', currentSha, 'current fact', 2000, 1, 'generation-2', 2000)
    insertCommit.run('git-archived', archivedSha, 'rewritten fact', 1000, 0, 'generation-1', 1000)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('record-1', 'project-1', '保留历史证据', 'ai', 'accepted', 3000, 3000)
    `).run()
    db.prepare(`
      INSERT INTO development_record_git_commits (recordId, gitSha) VALUES ('record-1', ?)
    `).run(archivedSha)

    assert.deepEqual(service.getGitCommits('project-1').items.map(commit => commit.sha), [currentSha])
    assert.deepEqual(service.getAiInput('project-1', [archivedSha]), [])
    assert.deepEqual(service.getAiInputPreview('project-1').shas, [currentSha])
    assert.deepEqual(service.getRecordsPage('project-1').items[0].gitShas, [archivedSha])
    assert.deepEqual((service.getDashboardSummary().recentGit as Array<{ sha: string }>).map(commit => commit.sha), [currentSha])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('manual records consume Git commits while ignore and restore keep the pending queue explicit', async () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '提交消费', 1, 1)
    const firstSha = 'a'.repeat(40)
    const secondSha = 'b'.repeat(40)
    const insertCommit = db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, reachable, createdAt)
      VALUES (?, 'project-1', ?, ?, ?, 1, ?)
    `)
    insertCommit.run('git-a', firstSha, 'first', 1000, 1000)
    insertCommit.run('git-b', secondSha, 'second', 2000, 2000)

    assert.equal(service.markGitCommitsSeen('project-1', [firstSha]), 1)
    assert.ok(service.getGitCommits('project-1').items.find(commit => commit.sha === firstSha)?.seenAt)

    const recordId = service.createManualRecord({
      projectId: 'project-1', title: '手工归档', gitShas: [firstSha],
    })
    assert.deepEqual(service.getRecordsPage('project-1').items[0].gitShas, [firstSha])
    assert.deepEqual(service.getAiInputPreview('project-1').shas, [secondSha])
    assert.equal(service.getDashboardSummary().counts.pendingGit, 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT disposition, handledByRecordId FROM git_commit_tracking
      WHERE projectId = 'project-1' AND gitSha = ?
    `).get(firstSha) as object) }, { disposition: 'handled', handledByRecordId: recordId })

    service.setGitCommitDisposition('project-1', secondSha, 'ignored')
    assert.deepEqual(service.getAiInputPreview('project-1').shas, [])
    assert.equal(service.getDashboardSummary().counts.pendingGit, 0)
    service.setGitCommitDisposition('project-1', secondSha, 'pending')
    assert.deepEqual(service.getAiInputPreview('project-1').shas, [secondSha])

    db.prepare(`UPDATE projects SET updatedAt = 1 WHERE id = 'project-1'`).run()
    await deleteRecordAndManagedAssets(db as never, recordId)
    assert.ok((db.prepare(`
      SELECT updatedAt FROM projects WHERE id = 'project-1'
    `).get() as { updatedAt: number }).updatedAt > 1)
    assert.equal((db.prepare(`
      SELECT disposition FROM git_commit_tracking WHERE projectId = 'project-1' AND gitSha = ?
    `).get(firstSha) as { disposition: string }).disposition, 'pending')
    assert.equal(service.getGitCommits('project-1').items.find(commit => commit.sha === firstSha)?.activeRecord, null)
    assert.deepEqual(new Set(service.getAiInputPreview('project-1').shas), new Set([firstSha, secondSha]))
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Git facts expose their active draft or accepted record and reject manual disposition changes', async () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '活跃关联', 1, 1)
    const draftSha = 'e'.repeat(40)
    const acceptedSha = 'f'.repeat(40)
    const insertCommit = db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, reachable, createdAt)
      VALUES (?, 'project-1', ?, ?, ?, 1, ?)
    `)
    insertCommit.run('git-draft', draftSha, 'draft fact', 1000, 1000)
    insertCommit.run('git-accepted', acceptedSha, 'accepted fact', 2000, 2000)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('draft-1', 'project-1', '待审核草稿', 'ai', 'draft', 3000, 3000)
    `).run()
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      .run('draft-1', draftSha)

    let facts = service.getGitCommits('project-1').items
    const draftFact = facts.find(commit => commit.sha === draftSha)
    assert.equal(draftFact?.disposition, 'pending')
    assert.deepEqual(draftFact?.activeRecord, {
      recordId: 'draft-1', title: '待审核草稿', source: 'ai', reviewStatus: 'draft',
    })
    assert.throws(() => service.setGitCommitDisposition('project-1', draftSha, 'ignored'), /待审核草稿/)

    assert.equal(service.markGitCommitsSeen('project-1', [draftSha]), 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT disposition, handledByRecordId, seenAt FROM git_commit_tracking
      WHERE projectId = 'project-1' AND gitSha = ?
    `).get(draftSha) as object) }, {
      disposition: 'pending', handledByRecordId: null,
      seenAt: service.getGitCommits('project-1').items.find(commit => commit.sha === draftSha)?.seenAt,
    })

    assert.equal(service.reviewDraft('draft-1', 'accepted', { title: '审核后的正式记录' }), true)
    facts = service.getGitCommits('project-1').items
    const acceptedDraftFact = facts.find(commit => commit.sha === draftSha)
    assert.equal(acceptedDraftFact?.disposition, 'handled')
    assert.deepEqual(acceptedDraftFact?.activeRecord, {
      recordId: 'draft-1', title: '审核后的正式记录', source: 'ai', reviewStatus: 'accepted',
    })
    assert.throws(() => service.setGitCommitDisposition('project-1', draftSha, 'pending'), /正式开发记录/)
    assert.equal(service.markGitCommitsSeen('project-1', [draftSha]), 1)

    const manualRecordId = service.createManualRecord({
      projectId: 'project-1', title: '手工正式记录', gitShas: [acceptedSha],
    })
    const manualFact = service.getGitCommits('project-1').items.find(commit => commit.sha === acceptedSha)
    assert.deepEqual(manualFact?.activeRecord, {
      recordId: manualRecordId, title: '手工正式记录', source: 'manual', reviewStatus: 'accepted',
    })
    assert.throws(() => service.setGitCommitDisposition('project-1', acceptedSha, 'ignored'), /正式开发记录/)

    await deleteRecordAndManagedAssets(db as never, manualRecordId)
    const releasedFact = service.getGitCommits('project-1').items.find(commit => commit.sha === acceptedSha)
    assert.equal(releasedFact?.disposition, 'pending')
    assert.equal(releasedFact?.activeRecord, null)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI rejection distinguishes retryable drafts from explicitly ignored Git commits', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '拒绝语义', 1, 1)
    const retrySha = 'c'.repeat(40)
    const ignoredSha = 'd'.repeat(40)
    const insertCommit = db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, reachable, createdAt)
      VALUES (?, 'project-1', ?, ?, ?, 1, ?)
    `)
    insertCommit.run('git-c', retrySha, 'retry', 1000, 1000)
    insertCommit.run('git-d', ignoredSha, 'ignore', 2000, 2000)
    const insertDraft = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, 'project-1', ?, 'ai', 'draft', ?, ?)
    `)
    insertDraft.run('draft-retry', 'retry', 1, 1)
    insertDraft.run('draft-ignore', 'ignore', 1, 1)
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)').run('draft-retry', retrySha)
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)').run('draft-ignore', ignoredSha)

    assert.equal(service.reviewDraft('draft-retry', 'rejected'), true)
    assert.equal(service.reviewDraft('draft-ignore', 'rejected', { ignoreGitShas: true }), true)
    assert.deepEqual(service.getAiInputPreview('project-1').shas, [retrySha])
    assert.equal((db.prepare(`
      SELECT disposition FROM git_commit_tracking WHERE projectId = 'project-1' AND gitSha = ?
    `).get(ignoredSha) as { disposition: string }).disposition, 'ignored')

    assert.throws(() => service.insertAiDrafts({
      projectId: 'project-1', provider: 'test', model: 'model', promptVersion: 'v1', inputHash: 'duplicate',
      inputShas: [retrySha], output: {}, records: [
        { title: 'one', description: '', gitShas: [retrySha], confidence: 0.8, evidence: [] },
        { title: 'two', description: '', gitShas: [retrySha], confidence: 0.7, evidence: [] },
      ],
    }), /不能同时分配/)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('formal record images enforce review ownership, caption limits, complete ordering, and activity timestamps', () => {
  const { directory, db, service } = createFixture()
  try {
    const insertProject = db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    insertProject.run('project-1', '图片编辑', 1, 10)
    insertProject.run('project-2', '另一项目', 1, 10)
    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    insertRecord.run('record-1', 'project-1', '正式记录', 'manual', 'accepted', 20, 20)
    insertRecord.run('record-2', 'project-2', '另一正式记录', 'manual', 'accepted', 20, 20)
    insertRecord.run('draft-1', 'project-1', '待审核', 'ai', 'draft', 20, 20)
    insertRecord.run('rejected-1', 'project-1', '已拒绝', 'ai', 'rejected', 20, 20)

    const first = service.addRecordImage('record-1', 'C:\\images\\first.png', '第一张', 100)
    const second = service.addRecordImage('record-1', 'C:\\images\\second.png', '', 110)
    const other = service.addRecordImage('record-2', 'C:\\images\\other.png', '', 115)
    assert.deepEqual(
      [first, second].map(image => ({ recordId: image.recordId, commitId: image.commitId, sortIndex: image.sortIndex })),
      [
        { recordId: 'record-1', commitId: 'record-1', sortIndex: 0 },
        { recordId: 'record-1', commitId: 'record-1', sortIndex: 1 },
      ],
    )
    assert.deepEqual({ ...(db.prepare(`
      SELECT dr.updatedAt AS recordUpdatedAt, p.updatedAt AS projectUpdatedAt
      FROM development_records dr JOIN projects p ON p.id = dr.projectId WHERE dr.id = 'record-1'
    `).get() as object) }, { recordUpdatedAt: 110, projectUpdatedAt: 110 })

    assert.throws(() => service.addRecordImage('draft-1', 'C:\\images\\draft.png'), /尚未通过审核/)
    assert.throws(() => service.addRecordImage('rejected-1', 'C:\\images\\rejected.png'), /尚未通过审核/)
    assert.throws(() => service.addRecordImage('missing', 'C:\\images\\missing.png'), /尚未通过审核/)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM development_record_images').get() as { count: number }).count, 3)

    const updated = service.updateRecordImage('record-1', first.id, '新的说明', 120)
    assert.equal(updated.caption, '新的说明')
    assert.equal((db.prepare('SELECT caption FROM development_record_images WHERE id = ?').get(first.id) as { caption: string }).caption, '新的说明')
    assert.throws(() => service.updateRecordImage('record-2', first.id, '越权'), /不属于/)
    assert.throws(() => service.updateRecordImage('record-1', first.id, 'x'.repeat(1_001)), /说明过长/)
    assert.equal((db.prepare('SELECT caption FROM development_record_images WHERE id = ?').get(first.id) as { caption: string }).caption, '新的说明')

    const reordered = service.reorderRecordImages('record-1', [second.id, first.id], 130)
    assert.deepEqual(reordered.map(image => [image.id, image.sortIndex]), [[second.id, 0], [first.id, 1]])
    const ordering = () => (db.prepare(`
      SELECT id, sortIndex FROM development_record_images
      WHERE recordId = 'record-1' ORDER BY sortIndex
    `).all() as Array<{ id: string; sortIndex: number }>).map(image => [image.id, image.sortIndex])
    const stableOrdering = [[second.id, 0], [first.id, 1]]
    assert.deepEqual(ordering(), stableOrdering)
    assert.throws(() => service.reorderRecordImages('record-1', [first.id, first.id]), /重复 ID/)
    assert.throws(() => service.reorderRecordImages('record-1', [first.id]), /完整包含/)
    assert.throws(() => service.reorderRecordImages('record-1', [first.id, second.id, 'extra-image']), /完整包含/)
    assert.throws(() => service.reorderRecordImages('record-1', [first.id, other.id]), /完整包含/)
    assert.throws(() => service.reorderRecordImages('draft-1', []), /尚未通过审核/)
    assert.deepEqual(ordering(), stableOrdering)
    assert.deepEqual({ ...(db.prepare(`
      SELECT dr.updatedAt AS recordUpdatedAt, p.updatedAt AS projectUpdatedAt
      FROM development_records dr JOIN projects p ON p.id = dr.projectId WHERE dr.id = 'record-1'
    `).get() as object) }, { recordUpdatedAt: 130, projectUpdatedAt: 130 })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('record page batch hydration keeps every image and Git SHA on its owning record', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', '批量时间线', 1, 1)
    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, 'project-1', ?, 'manual', 'accepted', ?, ?)
    `)
    insertRecord.run('record-a', '记录 A', 10, 10)
    insertRecord.run('record-b', '记录 B', 20, 20)
    const insertImage = db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertImage.run('image-a-2', 'record-a', 'C:\\images\\a-2.png', 'A2', 1, 12)
    insertImage.run('image-b-1', 'record-b', 'C:\\images\\b-1.png', 'B1', 0, 21)
    insertImage.run('image-a-1', 'record-a', 'C:\\images\\a-1.png', 'A1', 0, 11)
    const insertSha = db.prepare(`
      INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)
    `)
    const shaA1 = 'a'.repeat(40)
    const shaA2 = 'b'.repeat(40)
    const shaB1 = 'c'.repeat(40)
    insertSha.run('record-a', shaA2)
    insertSha.run('record-b', shaB1)
    insertSha.run('record-a', shaA1)

    const items = service.getRecordsPage('project-1', { limit: 10 }).items
    const byId = new Map(items.map(item => [String(item.id), item]))
    assert.deepEqual((byId.get('record-a')?.images as Array<Record<string, unknown>>).map(image => ({
      id: image.id, recordId: image.recordId, commitId: image.commitId, sortIndex: image.sortIndex,
    })), [
      { id: 'image-a-1', recordId: 'record-a', commitId: 'record-a', sortIndex: 0 },
      { id: 'image-a-2', recordId: 'record-a', commitId: 'record-a', sortIndex: 1 },
    ])
    assert.deepEqual(byId.get('record-a')?.gitShas, [shaA1, shaA2])
    assert.deepEqual((byId.get('record-b')?.images as Array<Record<string, unknown>>).map(image => image.id), ['image-b-1'])
    assert.deepEqual(byId.get('record-b')?.gitShas, [shaB1])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI input preview paginates the complete pending range and respects date filters', () => {
  const { directory, db, service } = createFixture()
  try {
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-1', 'AI 范围分页', 1, 1)
    const insertCommit = db.prepare(`
      INSERT INTO git_commits (
        id, projectId, sha, subject, authoredAt, fileNamesJson, statsJson, createdAt
      ) VALUES (?, 'project-1', ?, ?, ?, '[]', '{"added":1,"deleted":0,"files":0}', ?)
    `)
    const shas = Array.from({ length: 6 }, (_, index) => (index + 1).toString(16).padStart(40, '0'))
    shas.forEach((sha, index) => insertCommit.run(`commit-${index + 1}`, sha, `提交 ${index + 1}`, (index + 1) * 100, (index + 1) * 100))
    db.prepare(`
      INSERT INTO git_commit_tracking (projectId, gitSha, disposition, updatedAt)
      VALUES ('project-1', ?, 'ignored', 1)
    `).run(shas[2])
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('draft-1', 'project-1', '占用提交', 'ai', 'draft', 1, 1)
    `).run()
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      .run('draft-1', shas[3])

    const first = service.getAiInputPreview('project-1', {
      limit: 1,
      authoredAfter: 150,
      authoredBefore: 550,
    })
    assert.equal(first.totalPending, 2)
    assert.equal(first.oldestAuthoredAt, 200)
    assert.equal(first.newestAuthoredAt, 500)
    assert.deepEqual(first.shas, [shas[1]])
    assert.match(first.nextCursor || '', /^200\|[0-9a-f]{40}$/)

    const second = service.getAiInputPreview('project-1', {
      cursor: first.nextCursor || undefined,
      limit: 1,
      authoredAfter: 150,
      authoredBefore: 550,
    })
    assert.deepEqual(second.shas, [shas[4]])
    assert.equal(second.nextCursor, null)

    const complete = service.getAiInputPreview('project-1', { limit: 10 })
    assert.equal(complete.totalPending, 4)
    assert.deepEqual(complete.shas, [shas[0], shas[1], shas[4], shas[5]])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
