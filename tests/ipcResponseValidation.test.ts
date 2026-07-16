import assert from 'node:assert/strict'
import test from 'node:test'
import { validateIpcResponse } from '../electron/services/ipcResponseValidation.ts'

const sha = 'a'.repeat(40)

function gitCommitFixture() {
  return {
    sha,
    parentShas: [],
    authorName: 'Dev',
    authorEmail: 'dev@example.test',
    authoredAt: 1,
    subject: 'commit',
    body: '',
    fileNames: ['README.md'],
    stats: { added: 1, deleted: 0, files: 1 },
    disposition: 'pending',
    seenAt: null,
    activeRecord: null,
  }
}

function imageFixture() {
  return {
    id: 'image-1', recordId: 'record-1', commitId: 'record-1',
    imagePath: 'C:/shots/one.png', caption: '说明', sortIndex: 0, createdAt: 1,
  }
}

function recordFixture() {
  return {
    id: 'record-1', projectId: 'project-1', title: '记录', description: '说明',
    source: 'ai', reviewStatus: 'draft', provider: 'openai-compatible', model: 'model',
    promptVersion: 'v1', inputHash: 'hash', generationRunId: 'run-1', confidence: 0.8,
    userEditedAt: null, createdAt: 1, updatedAt: 2, gitShas: [sha], evidence: ['commit'],
    images: [imageFixture()],
  }
}

function projectFixture() {
  return {
    id: 'project-1', name: 'Project', description: '本地项目', path: 'C:/repo',
    repoUrl: '', status: 'status-1', phase: '开发中', milestone: '', nextStep: '',
    canonicalPath: 'C:/repo', coverImagePath: '', resolvedCoverImagePath: '',
    createdAt: 1, updatedAt: 2, recordCount: 0, commitCount: 0, draftCount: 1,
    openTodoCount: 0,
    statusInfo: { id: 'status-1', name: '开发中', color: '#334455', sortIndex: 0 },
    tags: [{ id: 'tag-1', name: 'Electron', color: '#112233', createdAt: 1 }],
    recentRecord: null,
    recentCommit: null,
    gitSync: {
      status: 'synced', branch: 'main', headSha: sha, commitCount: 1, lastScannedAt: 2,
      error: '', failureCount: 0, nextRetryAt: null, backfillProcessed: 1,
      backfillTotal: 1, backfillProgress: 100, backfillResumable: false,
      historyLimit: 0, historyTruncated: false,
    },
    launchCapability: null,
  }
}

function aiPayloadFixture() {
  return {
    project: {
      name: 'Project', description: '本地项目', techStack: ['Electron'], tags: ['Electron'],
      phase: '开发中', phaseReason: '仍在迭代', confidence: 0.8, evidence: ['README'],
    },
    records: [{
      title: '完成闭环', description: '完成导入与同步', gitShas: [sha], confidence: 0.9, evidence: ['commit'],
    }],
    assetNotes: [{ path: 'C:/repo/cover.png', note: '封面候选' }],
  }
}

test('IPC response schemas accept complete core domain results and push events', () => {
  const project = projectFixture()
  assert.deepEqual(validateIpcResponse('project:list', [project]), [project])
  const projectDetail = {
    ...project,
    noteblocks: [],
    todos: [],
    assetWarnings: [{
      kind: 'cover', path: 'C:/old-repo/cover.png', recordId: null, recordTitle: null,
    }],
  }
  assert.deepEqual(validateIpcResponse('project:get', projectDetail), projectDetail)

  const commit = gitCommitFixture()
  assert.deepEqual(validateIpcResponse('git:list', { items: [commit], nextCursor: null }), {
    items: [commit], nextCursor: null,
  })

  const createdTag = { id: 'tag-1', name: 'Electron', color: '#112233', createdAt: 1 }
  const suggestion = {
    projectId: 'project-1', generationRunId: 'run-1', applicationId: 'application-1',
    inputShas: [sha], appliedTagIds: ['tag-1'], createdTags: [createdTag],
  }
  assert.deepEqual(validateIpcResponse('ai:apply-project-suggestion', suggestion), suggestion)

  const task = {
    id: 'task-1', kind: 'git-sync', projectId: 'project-1', status: 'interrupted',
    detail: '应用退出', canRetry: true, canCancel: false, progress: 50, createdAt: 1, updatedAt: 2,
  }
  assert.deepEqual(validateIpcResponse('task:list', [task]), [task])
  assert.deepEqual(validateIpcResponse('task:progress', task), task)

  const gitState = {
    projectId: 'project-1', reason: 'scheduled', status: 'syncing', processed: 1,
    total: 2, progress: 50, resumed: true, updatedAt: 2,
  }
  assert.deepEqual(validateIpcResponse('git:state', gitState), gitState)

  const launchState = {
    profileId: 'profile-1', projectId: 'project-1', state: 'ready', pid: 123,
    startedAt: 1, stoppedAt: null, error: '',
    logs: [{ stream: 'system', text: 'ready', timestamp: 2 }],
  }
  assert.deepEqual(validateIpcResponse('launch:state', launchState), launchState)
  assert.deepEqual(validateIpcResponse('record:image:update', imageFixture()), imageFixture())
  assert.equal(validateIpcResponse('task:cancel', true), true)
})

test('IPC response schemas validate AI generation history and nested snapshots', () => {
  const payload = aiPayloadFixture()
  const generation = {
    payload,
    metadata: { provider: 'openai-compatible', model: 'model', promptVersion: 'v1', inputHash: 'hash' },
    draftIds: ['record-1'], generationRunId: 'run-1', drafts: [recordFixture()],
  }
  assert.deepEqual(validateIpcResponse('ai:generate-drafts', generation), generation)

  const run = {
    id: 'run-1', projectId: 'project-1', provider: 'openai-compatible', model: 'model',
    promptVersion: 'v1', inputHash: 'hash', inputShas: [sha], status: 'succeeded',
    rulesVersion: 1, error: '', createdAt: 1, updatedAt: 2, completedAt: 2,
    draftCount: 1, acceptedCount: 0, rejectedCount: 0, suggestionApplicationCount: 1,
    output: payload,
    rulesSnapshot: {
      version: 1, language: 'zh-CN', toneMode: 'historical', summaryGuidance: '',
      recordGuidance: '', exclusions: [], customRules: [],
    },
    settingsSnapshot: {
      baseUrl: 'http://127.0.0.1/v1', model: 'model', defaultLanguage: 'zh-CN',
      logGranularity: 'minimal', toneMode: 'historical', excludedPaths: [], customRules: [],
    },
    inputSnapshot: {
      project: { name: 'Project', description: '', phase: '', milestone: '', nextStep: '' },
      history: [], commits: [gitCommitFixture()], assetCandidates: [], knownTags: [],
      rules: { language: 'zh-CN', toneMode: 'historical', summaryGuidance: '', recordGuidance: '', exclusions: [], customRules: [] },
    },
    replaceDraftIds: [],
    projectSuggestionApplications: [{
      id: 'application-1', projectId: 'project-1', generationRunId: 'run-1', inputShas: [sha],
      before: { name: 'Old' }, applied: { name: 'Project' }, createdAt: 2,
    }],
    drafts: [recordFixture()],
  }
  assert.deepEqual(validateIpcResponse('ai:runs:get', run), run)
})

test('IPC response schemas reject missing fields, invalid enums, and unsafe nested types', () => {
  const project = projectFixture()
  const { description: _description, ...missingDescription } = project
  assert.throws(() => validateIpcResponse('project:list', [missingDescription]), /项目.description必须是字符串/)

  assert.throws(() => validateIpcResponse('git:list', {
    items: [{ ...gitCommitFixture(), sha: 'not-a-sha' }], nextCursor: null,
  }), /Git 提交.sha无效/)

  assert.throws(() => validateIpcResponse('settings:get', {
    screenshotsDirectory: 'C:/shots',
    llm: {
      baseUrl: '', model: '', hasApiKey: false, apiKey: 'must-not-leak', defaultLanguage: 'zh-CN',
      logGranularity: 'minimal', toneMode: 'historical', excludedPaths: [], customRules: [],
    },
  }), /不能包含 API Key/)

  assert.throws(() => validateIpcResponse('launch:status', {
    profileId: 'profile-1', projectId: 'project-1', state: 'unknown', pid: 123,
    startedAt: 1, stoppedAt: null, error: '', logs: [],
  }), /启动状态.state无效/)

  assert.throws(() => validateIpcResponse('git:state', {
    projectId: 'project-1', reason: 'timer', status: 'syncing', updatedAt: 1,
  }), /Git 同步事件.reason无效/)

  assert.throws(() => validateIpcResponse('record:image:reorder', [{ id: 'image-1' }]), /图片.imagePath必须是字符串/)
})

test('IPC response schemas reject undefined, non-finite values, and cycles before renderer delivery', () => {
  assert.throws(() => validateIpcResponse('unknown', undefined), /undefined/)
  assert.throws(() => validateIpcResponse('unknown', { value: Number.NaN }), /有限数字/)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.throws(() => validateIpcResponse('unknown', cyclic), /循环引用/)
})
