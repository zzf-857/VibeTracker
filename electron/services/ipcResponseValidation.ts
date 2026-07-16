export class IpcResponseValidationError extends Error {
  constructor(channel: string, detail: string) {
    super(`IPC 返回值不符合契约 (${channel}): ${detail}`)
    this.name = 'IpcResponseValidationError'
  }
}

type ObjectValue = Record<string, unknown>

function fail(channel: string, detail: string): never {
  throw new IpcResponseValidationError(channel, detail)
}

function objectValue(channel: string, value: unknown, label = '返回对象'): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(channel, `${label}必须是对象`)
  return value as ObjectValue
}

function arrayValue(channel: string, value: unknown, label = '返回列表') {
  if (!Array.isArray(value)) fail(channel, `${label}必须是数组`)
  return value
}

function stringValue(channel: string, value: unknown, label: string) {
  if (typeof value !== 'string') fail(channel, `${label}必须是字符串`)
  return value
}

function booleanValue(channel: string, value: unknown, label = '返回值') {
  if (typeof value !== 'boolean') fail(channel, `${label}必须是布尔值`)
  return value
}

function finiteNumber(channel: string, value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(channel, `${label}必须是有限数字`)
  return value
}

function nullableString(channel: string, value: unknown, label: string) {
  if (value !== null && typeof value !== 'string') fail(channel, `${label}必须是字符串或 null`)
}

function nullableNumber(channel: string, value: unknown, label: string) {
  if (value !== null) finiteNumber(channel, value, label)
}

function enumValue(channel: string, value: unknown, label: string, allowed: readonly string[]) {
  const result = stringValue(channel, value, label)
  if (!allowed.includes(result)) fail(channel, `${label}无效`)
  return result
}

function stringArray(channel: string, value: unknown, label: string) {
  const result = arrayValue(channel, value, label)
  result.forEach((item, index) => stringValue(channel, item, `${label}[${index}]`))
  return result as string[]
}

function shaValue(channel: string, value: unknown, label: string) {
  const sha = stringValue(channel, value, label)
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) fail(channel, `${label}无效`)
  return sha
}

function validateCloneData(channel: string, value: unknown, depth = 0, ancestors = new WeakSet<object>()) {
  if (depth > 20) fail(channel, '返回值嵌套过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    finiteNumber(channel, value, '数字字段')
    return
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    fail(channel, `包含不支持的 ${typeof value} 值`)
  }
  if (typeof value !== 'object') fail(channel, '包含未知返回值类型')
  if (ancestors.has(value)) fail(channel, '返回值不能包含循环引用')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const item of value) validateCloneData(channel, item, depth + 1, ancestors)
  } else {
    for (const item of Object.values(value as ObjectValue)) validateCloneData(channel, item, depth + 1, ancestors)
  }
  ancestors.delete(value)
}

function validateTag(channel: string, value: unknown) {
  const tag = objectValue(channel, value, '标签')
  stringValue(channel, tag.id, '标签.id')
  stringValue(channel, tag.name, '标签.name')
  stringValue(channel, tag.color, '标签.color')
  finiteNumber(channel, tag.createdAt, '标签.createdAt')
}

function validateStatus(channel: string, value: unknown, summary = false) {
  const status = objectValue(channel, value, '项目状态')
  stringValue(channel, status.id, '项目状态.id')
  stringValue(channel, status.name, '项目状态.name')
  stringValue(channel, status.color, '项目状态.color')
  finiteNumber(channel, status.sortIndex, '项目状态.sortIndex')
  if (!summary) {
    finiteNumber(channel, status.createdAt, '项目状态.createdAt')
    finiteNumber(channel, status.updatedAt, '项目状态.updatedAt')
  }
  if (status.projectCount !== undefined) finiteNumber(channel, status.projectCount, '项目状态.projectCount')
}

function validateRecordImage(channel: string, value: unknown) {
  const image = objectValue(channel, value, '开发记录图片')
  stringValue(channel, image.id, '图片.id')
  if (image.recordId !== undefined) stringValue(channel, image.recordId, '图片.recordId')
  if (image.commitId !== undefined) stringValue(channel, image.commitId, '图片.commitId')
  stringValue(channel, image.imagePath, '图片.imagePath')
  stringValue(channel, image.caption, '图片.caption')
  finiteNumber(channel, image.sortIndex, '图片.sortIndex')
  finiteNumber(channel, image.createdAt, '图片.createdAt')
}

function validateRecord(channel: string, value: unknown) {
  const record = objectValue(channel, value, '开发记录')
  stringValue(channel, record.id, '开发记录.id')
  stringValue(channel, record.projectId, '开发记录.projectId')
  stringValue(channel, record.title, '开发记录.title')
  stringValue(channel, record.description, '开发记录.description')
  enumValue(channel, record.source, '开发记录.source', ['manual', 'ai'])
  enumValue(channel, record.reviewStatus, '开发记录.reviewStatus', ['draft', 'accepted', 'rejected'])
  stringValue(channel, record.provider, '开发记录.provider')
  stringValue(channel, record.model, '开发记录.model')
  stringValue(channel, record.promptVersion, '开发记录.promptVersion')
  stringValue(channel, record.inputHash, '开发记录.inputHash')
  if (record.generationRunId !== null && record.generationRunId !== undefined) {
    stringValue(channel, record.generationRunId, '开发记录.generationRunId')
  }
  if (record.confidence !== null && record.confidence !== undefined) {
    const confidence = finiteNumber(channel, record.confidence, '开发记录.confidence')
    if (confidence < 0 || confidence > 1) fail(channel, '开发记录.confidence 必须在 0-1 之间')
  }
  nullableNumber(channel, record.userEditedAt, '开发记录.userEditedAt')
  finiteNumber(channel, record.createdAt, '开发记录.createdAt')
  finiteNumber(channel, record.updatedAt, '开发记录.updatedAt')
  stringArray(channel, record.gitShas, '开发记录.gitShas').forEach((sha, index) => shaValue(channel, sha, `开发记录.gitShas[${index}]`))
  stringArray(channel, record.evidence, '开发记录.evidence')
  arrayValue(channel, record.images, '开发记录.images').forEach(image => validateRecordImage(channel, image))
}

function validateGitSyncSummary(channel: string, value: unknown) {
  const sync = objectValue(channel, value, 'Git 同步摘要')
  enumValue(channel, sync.status, 'Git 同步摘要.status', ['never', 'syncing', 'synced', 'failed', 'unavailable'])
  stringValue(channel, sync.branch, 'Git 同步摘要.branch')
  stringValue(channel, sync.headSha, 'Git 同步摘要.headSha')
  finiteNumber(channel, sync.commitCount, 'Git 同步摘要.commitCount')
  nullableNumber(channel, sync.lastScannedAt, 'Git 同步摘要.lastScannedAt')
  stringValue(channel, sync.error, 'Git 同步摘要.error')
  finiteNumber(channel, sync.failureCount, 'Git 同步摘要.failureCount')
  nullableNumber(channel, sync.nextRetryAt, 'Git 同步摘要.nextRetryAt')
  finiteNumber(channel, sync.backfillProcessed, 'Git 同步摘要.backfillProcessed')
  finiteNumber(channel, sync.backfillTotal, 'Git 同步摘要.backfillTotal')
  finiteNumber(channel, sync.backfillProgress, 'Git 同步摘要.backfillProgress')
  booleanValue(channel, sync.backfillResumable, 'Git 同步摘要.backfillResumable')
  finiteNumber(channel, sync.historyLimit, 'Git 同步摘要.historyLimit')
  booleanValue(channel, sync.historyTruncated, 'Git 同步摘要.historyTruncated')
}

function validateProjectAssetWarning(channel: string, value: unknown) {
  const warning = objectValue(channel, value, '项目图片提示')
  enumValue(channel, warning.kind, '项目图片提示.kind', ['cover', 'record-image'])
  stringValue(channel, warning.path, '项目图片提示.path')
  nullableString(channel, warning.recordId, '项目图片提示.recordId')
  nullableString(channel, warning.recordTitle, '项目图片提示.recordTitle')
}

function validateProject(channel: string, value: unknown) {
  const project = objectValue(channel, value, '项目')
  stringValue(channel, project.id, '项目.id')
  stringValue(channel, project.name, '项目.name')
  stringValue(channel, project.description, '项目.description')
  stringValue(channel, project.path, '项目.path')
  stringValue(channel, project.repoUrl, '项目.repoUrl')
  stringValue(channel, project.status, '项目.status')
  stringValue(channel, project.phase, '项目.phase')
  stringValue(channel, project.milestone, '项目.milestone')
  stringValue(channel, project.nextStep, '项目.nextStep')
  nullableString(channel, project.canonicalPath, '项目.canonicalPath')
  stringValue(channel, project.coverImagePath, '项目.coverImagePath')
  stringValue(channel, project.resolvedCoverImagePath, '项目.resolvedCoverImagePath')
  finiteNumber(channel, project.createdAt, '项目.createdAt')
  finiteNumber(channel, project.updatedAt, '项目.updatedAt')
  finiteNumber(channel, project.recordCount, '项目.recordCount')
  finiteNumber(channel, project.commitCount, '项目.commitCount')
  finiteNumber(channel, project.draftCount, '项目.draftCount')
  finiteNumber(channel, project.openTodoCount, '项目.openTodoCount')
  if (project.statusInfo !== null) validateStatus(channel, project.statusInfo, true)
  arrayValue(channel, project.tags, '项目.tags').forEach(tag => validateTag(channel, tag))
  if (project.recentRecord !== null) validateRecord(channel, project.recentRecord)
  if (project.recentCommit !== null) validateRecord(channel, project.recentCommit)
  validateGitSyncSummary(channel, project.gitSync)
  if (project.launchCapability !== null) {
    const capability = objectValue(channel, project.launchCapability, '项目.launchCapability')
    stringValue(channel, capability.profileId, '项目.launchCapability.profileId')
    booleanValue(channel, capability.validated, '项目.launchCapability.validated')
    booleanValue(channel, capability.canOpen, '项目.launchCapability.canOpen')
  }
  if (project.assetWarnings !== undefined) {
    arrayValue(channel, project.assetWarnings, '项目.assetWarnings')
      .forEach(warning => validateProjectAssetWarning(channel, warning))
  }
  if (project.noteblocks !== undefined) {
    arrayValue(channel, project.noteblocks, '项目.noteblocks').forEach(value => {
      const note = objectValue(channel, value, '项目备注')
      stringValue(channel, note.id, '项目备注.id')
      stringValue(channel, note.projectId, '项目备注.projectId')
      stringValue(channel, note.content, '项目备注.content')
      finiteNumber(channel, note.createdAt, '项目备注.createdAt')
      finiteNumber(channel, note.updatedAt, '项目备注.updatedAt')
    })
  }
  if (project.todos !== undefined) {
    arrayValue(channel, project.todos, '项目.todos').forEach(value => {
      const todo = objectValue(channel, value, '项目待办')
      stringValue(channel, todo.id, '项目待办.id')
      stringValue(channel, todo.projectId, '项目待办.projectId')
      stringValue(channel, todo.content, '项目待办.content')
      const completed = finiteNumber(channel, todo.completed, '项目待办.completed')
      if (![0, 1].includes(completed)) fail(channel, '项目待办.completed 无效')
      finiteNumber(channel, todo.createdAt, '项目待办.createdAt')
      finiteNumber(channel, todo.updatedAt, '项目待办.updatedAt')
    })
  }
}

function validateGitCommit(channel: string, value: unknown, trackingRequired = true) {
  const commit = objectValue(channel, value, 'Git 提交')
  shaValue(channel, commit.sha, 'Git 提交.sha')
  stringArray(channel, commit.parentShas, 'Git 提交.parentShas').forEach((sha, index) => shaValue(channel, sha, `Git 提交.parentShas[${index}]`))
  stringValue(channel, commit.authorName, 'Git 提交.authorName')
  stringValue(channel, commit.authorEmail, 'Git 提交.authorEmail')
  finiteNumber(channel, commit.authoredAt, 'Git 提交.authoredAt')
  stringValue(channel, commit.subject, 'Git 提交.subject')
  stringValue(channel, commit.body, 'Git 提交.body')
  stringArray(channel, commit.fileNames, 'Git 提交.fileNames')
  const stats = objectValue(channel, commit.stats, 'Git 提交.stats')
  finiteNumber(channel, stats.added, 'Git 提交.stats.added')
  finiteNumber(channel, stats.deleted, 'Git 提交.stats.deleted')
  finiteNumber(channel, stats.files, 'Git 提交.stats.files')
  if (trackingRequired || commit.disposition !== undefined) {
    enumValue(channel, commit.disposition, 'Git 提交.disposition', ['pending', 'handled', 'ignored'])
  }
  if (trackingRequired || commit.seenAt !== undefined) nullableNumber(channel, commit.seenAt, 'Git 提交.seenAt')
  if ((trackingRequired || commit.activeRecord !== undefined) && commit.activeRecord !== null) {
    const active = objectValue(channel, commit.activeRecord, 'Git 提交.activeRecord')
    stringValue(channel, active.recordId, 'Git 提交.activeRecord.recordId')
    stringValue(channel, active.title, 'Git 提交.activeRecord.title')
    enumValue(channel, active.source, 'Git 提交.activeRecord.source', ['manual', 'ai'])
    enumValue(channel, active.reviewStatus, 'Git 提交.activeRecord.reviewStatus', ['draft', 'accepted'])
  }
}

function validateLaunchCandidate(channel: string, value: unknown) {
  const candidate = objectValue(channel, value, '启动候选')
  stringValue(channel, candidate.name, '启动候选.name')
  stringValue(channel, candidate.executable, '启动候选.executable')
  stringArray(channel, candidate.args, '启动候选.args')
  stringValue(channel, candidate.cwd, '启动候选.cwd')
  const env = objectValue(channel, candidate.env, '启动候选.env')
  Object.entries(env).forEach(([key, item]) => stringValue(channel, item, `启动候选.env.${key}`))
  stringValue(channel, candidate.readyUrl, '启动候选.readyUrl')
  nullableNumber(channel, candidate.readyPort, '启动候选.readyPort')
  stringValue(channel, candidate.reason, '启动候选.reason')
}

function validateInspection(channel: string, value: unknown) {
  const inspection = objectValue(channel, value, '项目扫描结果')
  stringValue(channel, inspection.selectedPath, '扫描结果.selectedPath')
  stringValue(channel, inspection.canonicalPath, '扫描结果.canonicalPath')
  booleanValue(channel, inspection.isGitRepository, '扫描结果.isGitRepository')
  booleanValue(channel, inspection.gitAvailable, '扫描结果.gitAvailable')
  stringValue(channel, inspection.repositoryRoot, '扫描结果.repositoryRoot')
  stringValue(channel, inspection.projectName, '扫描结果.projectName')
  stringValue(channel, inspection.branch, '扫描结果.branch')
  stringValue(channel, inspection.headSha, '扫描结果.headSha')
  booleanValue(channel, inspection.detached, '扫描结果.detached')
  booleanValue(channel, inspection.emptyRepository, '扫描结果.emptyRepository')
  finiteNumber(channel, inspection.commitCount, '扫描结果.commitCount')
  arrayValue(channel, inspection.recentCommits, '扫描结果.recentCommits').forEach(item => validateGitCommit(channel, item, false))
  stringValue(channel, inspection.remoteUrl, '扫描结果.remoteUrl')
  stringArray(channel, inspection.techStack, '扫描结果.techStack')
  stringValue(channel, inspection.readmeSummary, '扫描结果.readmeSummary')
  arrayValue(channel, inspection.launchCandidates, '扫描结果.launchCandidates').forEach(item => validateLaunchCandidate(channel, item))
  stringArray(channel, inspection.assetCandidates, '扫描结果.assetCandidates')
  stringArray(channel, inspection.warnings, '扫描结果.warnings')
}

function validateLaunchProfile(channel: string, value: unknown) {
  const profile = objectValue(channel, value, '启动配置')
  stringValue(channel, profile.id, '启动配置.id')
  stringValue(channel, profile.projectId, '启动配置.projectId')
  stringValue(channel, profile.name, '启动配置.name')
  stringValue(channel, profile.executable, '启动配置.executable')
  stringArray(channel, profile.args, '启动配置.args')
  stringValue(channel, profile.cwd, '启动配置.cwd')
  const env = objectValue(channel, profile.env, '启动配置.env')
  Object.entries(env).forEach(([key, item]) => stringValue(channel, item, `启动配置.env.${key}`))
  stringValue(channel, profile.readyUrl, '启动配置.readyUrl')
  nullableNumber(channel, profile.readyPort, '启动配置.readyPort')
  booleanValue(channel, profile.enabled, '启动配置.enabled')
  booleanValue(channel, profile.validated, '启动配置.validated')
  stringValue(channel, profile.confirmedHash, '启动配置.confirmedHash')
  finiteNumber(channel, profile.createdAt, '启动配置.createdAt')
  finiteNumber(channel, profile.updatedAt, '启动配置.updatedAt')
}

function validateLaunchRuntime(channel: string, value: unknown) {
  const runtime = objectValue(channel, value, '启动状态')
  stringValue(channel, runtime.profileId, '启动状态.profileId')
  stringValue(channel, runtime.projectId, '启动状态.projectId')
  enumValue(channel, runtime.state, '启动状态.state', ['starting', 'running', 'ready', 'failed', 'stopped'])
  nullableNumber(channel, runtime.pid, '启动状态.pid')
  nullableNumber(channel, runtime.startedAt, '启动状态.startedAt')
  nullableNumber(channel, runtime.stoppedAt, '启动状态.stoppedAt')
  stringValue(channel, runtime.error, '启动状态.error')
  arrayValue(channel, runtime.logs, '启动状态.logs').forEach(value => {
    const log = objectValue(channel, value, '启动日志')
    enumValue(channel, log.stream, '启动日志.stream', ['stdout', 'stderr', 'system'])
    stringValue(channel, log.text, '启动日志.text')
    finiteNumber(channel, log.timestamp, '启动日志.timestamp')
  })
}

function validateTask(channel: string, value: unknown) {
  const task = objectValue(channel, value, '后台任务')
  stringValue(channel, task.id, '后台任务.id')
  stringValue(channel, task.kind, '后台任务.kind')
  stringValue(channel, task.projectId, '后台任务.projectId')
  enumValue(channel, task.status, '后台任务.status', ['running', 'completed', 'failed', 'cancelled', 'interrupted'])
  stringValue(channel, task.detail, '后台任务.detail')
  booleanValue(channel, task.canRetry, '后台任务.canRetry')
  if (task.canCancel !== undefined) booleanValue(channel, task.canCancel, '后台任务.canCancel')
  finiteNumber(channel, task.createdAt, '后台任务.createdAt')
  finiteNumber(channel, task.updatedAt, '后台任务.updatedAt')
  if (task.progress !== undefined) {
    const progress = finiteNumber(channel, task.progress, '后台任务.progress')
    if (progress < 0 || progress > 100) fail(channel, '后台任务.progress 必须在 0-100 之间')
  }
  if (task.generationRunId !== undefined) stringValue(channel, task.generationRunId, '后台任务.generationRunId')
}

function validateGitState(channel: string, value: unknown) {
  const state = objectValue(channel, value, 'Git 同步事件')
  stringValue(channel, state.projectId, 'Git 同步事件.projectId')
  enumValue(channel, state.reason, 'Git 同步事件.reason', ['manual', 'scheduled'])
  enumValue(channel, state.status, 'Git 同步事件.status', ['syncing', 'synced', 'failed', 'cancelled'])
  for (const field of ['inserted', 'scanned', 'failureCount', 'processed', 'total'] as const) {
    if (state[field] !== undefined) finiteNumber(channel, state[field], `Git 同步事件.${field}`)
  }
  if (state.nextRetryAt !== undefined) nullableNumber(channel, state.nextRetryAt, 'Git 同步事件.nextRetryAt')
  if (state.error !== undefined) stringValue(channel, state.error, 'Git 同步事件.error')
  if (state.progress !== undefined) {
    const progress = finiteNumber(channel, state.progress, 'Git 同步事件.progress')
    if (progress < 0 || progress > 100) fail(channel, 'Git 同步事件.progress 必须在 0-100 之间')
  }
  if (state.resumed !== undefined) booleanValue(channel, state.resumed, 'Git 同步事件.resumed')
  finiteNumber(channel, state.updatedAt, 'Git 同步事件.updatedAt')
}

function validateAiRules(channel: string, value: unknown, partial = false) {
  const rules = objectValue(channel, value, 'AI 规则')
  const required = <T>(field: string, validator: (item: unknown) => T) => {
    if (!partial || rules[field] !== undefined) validator(rules[field])
  }
  required('version', item => finiteNumber(channel, item, 'AI 规则.version'))
  required('language', item => stringValue(channel, item, 'AI 规则.language'))
  required('toneMode', item => enumValue(channel, item, 'AI 规则.toneMode', ['historical', 'standardized']))
  required('summaryGuidance', item => stringValue(channel, item, 'AI 规则.summaryGuidance'))
  required('recordGuidance', item => stringValue(channel, item, 'AI 规则.recordGuidance'))
  required('exclusions', item => stringArray(channel, item, 'AI 规则.exclusions'))
  required('customRules', item => stringArray(channel, item, 'AI 规则.customRules'))
  if (rules.id !== undefined) stringValue(channel, rules.id, 'AI 规则.id')
  if (rules.projectId !== undefined) stringValue(channel, rules.projectId, 'AI 规则.projectId')
  if (rules.suggestedFromHistory !== undefined) booleanValue(channel, rules.suggestedFromHistory, 'AI 规则.suggestedFromHistory')
  if (rules.createdAt !== undefined) finiteNumber(channel, rules.createdAt, 'AI 规则.createdAt')
}

function validateAiPayload(channel: string, value: unknown) {
  const payload = objectValue(channel, value, 'AI 结构化结果')
  const project = objectValue(channel, payload.project, 'AI 项目建议')
  stringValue(channel, project.name, 'AI 项目建议.name')
  stringValue(channel, project.description, 'AI 项目建议.description')
  stringArray(channel, project.techStack, 'AI 项目建议.techStack')
  stringArray(channel, project.tags, 'AI 项目建议.tags')
  stringValue(channel, project.phase, 'AI 项目建议.phase')
  stringValue(channel, project.phaseReason, 'AI 项目建议.phaseReason')
  const projectConfidence = finiteNumber(channel, project.confidence, 'AI 项目建议.confidence')
  if (projectConfidence < 0 || projectConfidence > 1) fail(channel, 'AI 项目建议.confidence 必须在 0-1 之间')
  stringArray(channel, project.evidence, 'AI 项目建议.evidence')
  arrayValue(channel, payload.records, 'AI 开发记录建议').forEach((value, index) => {
    const record = objectValue(channel, value, `AI 开发记录建议[${index}]`)
    stringValue(channel, record.title, `AI 开发记录建议[${index}].title`)
    stringValue(channel, record.description, `AI 开发记录建议[${index}].description`)
    stringArray(channel, record.gitShas, `AI 开发记录建议[${index}].gitShas`)
      .forEach((sha, shaIndex) => shaValue(channel, sha, `AI 开发记录建议[${index}].gitShas[${shaIndex}]`))
    const confidence = finiteNumber(channel, record.confidence, `AI 开发记录建议[${index}].confidence`)
    if (confidence < 0 || confidence > 1) fail(channel, `AI 开发记录建议[${index}].confidence 必须在 0-1 之间`)
    stringArray(channel, record.evidence, `AI 开发记录建议[${index}].evidence`)
  })
  arrayValue(channel, payload.assetNotes, 'AI 资源说明').forEach((value, index) => {
    const note = objectValue(channel, value, `AI 资源说明[${index}]`)
    stringValue(channel, note.path, `AI 资源说明[${index}].path`)
    stringValue(channel, note.note, `AI 资源说明[${index}].note`)
  })
}

function validateAiRunSummary(channel: string, value: unknown) {
  const run = objectValue(channel, value, 'AI generation run')
  stringValue(channel, run.id, 'run.id')
  stringValue(channel, run.projectId, 'run.projectId')
  stringValue(channel, run.provider, 'run.provider')
  stringValue(channel, run.model, 'run.model')
  stringValue(channel, run.promptVersion, 'run.promptVersion')
  stringValue(channel, run.inputHash, 'run.inputHash')
  stringArray(channel, run.inputShas, 'run.inputShas').forEach((sha, index) => shaValue(channel, sha, `run.inputShas[${index}]`))
  const status = enumValue(channel, run.status, 'run.status', ['running', 'succeeded', 'failed', 'cancelled'])
  finiteNumber(channel, run.rulesVersion, 'run.rulesVersion')
  stringValue(channel, run.error, 'run.error')
  finiteNumber(channel, run.createdAt, 'run.createdAt')
  finiteNumber(channel, run.updatedAt, 'run.updatedAt')
  nullableNumber(channel, run.completedAt, 'run.completedAt')
  finiteNumber(channel, run.draftCount, 'run.draftCount')
  finiteNumber(channel, run.acceptedCount, 'run.acceptedCount')
  finiteNumber(channel, run.rejectedCount, 'run.rejectedCount')
  finiteNumber(channel, run.suggestionApplicationCount, 'run.suggestionApplicationCount')
  return status
}

function validateAiInputSnapshot(channel: string, value: unknown) {
  const snapshot = objectValue(channel, value, 'AI 输入快照')
  if (snapshot.project !== undefined) {
    const project = objectValue(channel, snapshot.project, 'AI 输入快照.project')
    for (const field of ['name', 'description', 'phase', 'milestone', 'nextStep']) {
      if (project[field] !== undefined) stringValue(channel, project[field], `AI 输入快照.project.${field}`)
    }
  }
  if (snapshot.history !== undefined) {
    arrayValue(channel, snapshot.history, 'AI 输入快照.history').forEach((value, index) => {
      const record = objectValue(channel, value, `AI 输入快照.history[${index}]`)
      stringValue(channel, record.title, `AI 输入快照.history[${index}].title`)
      stringValue(channel, record.description, `AI 输入快照.history[${index}].description`)
    })
  }
  if (snapshot.commits !== undefined) {
    arrayValue(channel, snapshot.commits, 'AI 输入快照.commits').forEach(commit => validateGitCommit(channel, commit))
  }
  if (snapshot.assetCandidates !== undefined) stringArray(channel, snapshot.assetCandidates, 'AI 输入快照.assetCandidates')
  if (snapshot.knownTags !== undefined) stringArray(channel, snapshot.knownTags, 'AI 输入快照.knownTags')
  if (snapshot.rules !== undefined) validateAiRules(channel, snapshot.rules, true)
}

function validateLlmSettingsSnapshot(channel: string, value: unknown) {
  const settings = objectValue(channel, value, 'LLM 设置快照')
  if (settings.baseUrl !== undefined) stringValue(channel, settings.baseUrl, 'LLM 设置快照.baseUrl')
  if (settings.model !== undefined) stringValue(channel, settings.model, 'LLM 设置快照.model')
  if (settings.defaultLanguage !== undefined) stringValue(channel, settings.defaultLanguage, 'LLM 设置快照.defaultLanguage')
  if (settings.logGranularity !== undefined) enumValue(channel, settings.logGranularity, 'LLM 设置快照.logGranularity', ['minimal', 'normal', 'detailed'])
  if (settings.toneMode !== undefined) enumValue(channel, settings.toneMode, 'LLM 设置快照.toneMode', ['historical', 'standardized'])
  if (settings.excludedPaths !== undefined) stringArray(channel, settings.excludedPaths, 'LLM 设置快照.excludedPaths')
  if (settings.customRules !== undefined) stringArray(channel, settings.customRules, 'LLM 设置快照.customRules')
  if (settings.hasApiKey !== undefined || settings.apiKey !== undefined) fail(channel, 'LLM 设置快照不能包含 API Key')
}

function validateAiGenerationResult(channel: string, value: unknown) {
  const result = objectValue(channel, value, 'AI 生成结果')
  validateAiPayload(channel, result.payload)
  const metadata = objectValue(channel, result.metadata, 'AI 生成元数据')
  stringValue(channel, metadata.provider, 'AI 生成元数据.provider')
  stringValue(channel, metadata.model, 'AI 生成元数据.model')
  stringValue(channel, metadata.promptVersion, 'AI 生成元数据.promptVersion')
  stringValue(channel, metadata.inputHash, 'AI 生成元数据.inputHash')
  stringArray(channel, result.draftIds, 'AI 生成结果.draftIds')
  stringValue(channel, result.generationRunId, 'AI 生成结果.generationRunId')
  arrayValue(channel, result.drafts, 'AI 生成结果.drafts').forEach(draft => validateRecord(channel, draft))
}

function validateAiRunDetail(channel: string, value: unknown) {
  const run = objectValue(channel, value, 'AI generation run 详情')
  const status = validateAiRunSummary(channel, run)
  const output = objectValue(channel, run.output, 'run.output')
  if (status === 'succeeded' || Object.keys(output).length > 0) validateAiPayload(channel, output)
  validateAiRules(channel, run.rulesSnapshot, true)
  validateLlmSettingsSnapshot(channel, run.settingsSnapshot)
  validateAiInputSnapshot(channel, run.inputSnapshot)
  stringArray(channel, run.replaceDraftIds, 'run.replaceDraftIds')
  arrayValue(channel, run.projectSuggestionApplications, 'run.projectSuggestionApplications').forEach((value, index) => {
    const application = objectValue(channel, value, `项目建议应用[${index}]`)
    stringValue(channel, application.id, `项目建议应用[${index}].id`)
    stringValue(channel, application.projectId, `项目建议应用[${index}].projectId`)
    stringValue(channel, application.generationRunId, `项目建议应用[${index}].generationRunId`)
    stringArray(channel, application.inputShas, `项目建议应用[${index}].inputShas`)
      .forEach((sha, shaIndex) => shaValue(channel, sha, `项目建议应用[${index}].inputShas[${shaIndex}]`))
    objectValue(channel, application.before, `项目建议应用[${index}].before`)
    objectValue(channel, application.applied, `项目建议应用[${index}].applied`)
    finiteNumber(channel, application.createdAt, `项目建议应用[${index}].createdAt`)
  })
  arrayValue(channel, run.drafts, 'run.drafts').forEach(draft => validateRecord(channel, draft))
}

function validateDashboard(channel: string, value: unknown) {
  const result = objectValue(channel, value, 'Dashboard')
  const counts = objectValue(channel, result.counts, 'Dashboard counts')
  for (const field of ['projects', 'pendingGit', 'pendingDrafts', 'openTodos', 'launchable']) {
    finiteNumber(channel, counts[field], `Dashboard counts.${field}`)
  }
  arrayValue(channel, result.recentGit, 'Dashboard recentGit').forEach((value, index) => {
    const commit = objectValue(channel, value, `Dashboard recentGit[${index}]`)
    stringValue(channel, commit.projectId, `Dashboard recentGit[${index}].projectId`)
    stringValue(channel, commit.projectName, `Dashboard recentGit[${index}].projectName`)
    shaValue(channel, commit.sha, `Dashboard recentGit[${index}].sha`)
    stringValue(channel, commit.subject, `Dashboard recentGit[${index}].subject`)
    finiteNumber(channel, commit.authoredAt, `Dashboard recentGit[${index}].authoredAt`)
    enumValue(channel, commit.disposition, `Dashboard recentGit[${index}].disposition`, ['pending'])
    nullableNumber(channel, commit.seenAt, `Dashboard recentGit[${index}].seenAt`)
  })
  for (const field of ['pendingReview', 'recentProjects', 'launchableProjects', 'failures']) {
    arrayValue(channel, result[field], `Dashboard ${field}`).forEach(project => validateProject(channel, project))
  }
  arrayValue(channel, result.openTodos, 'Dashboard openTodos').forEach((value, index) => {
    const todo = objectValue(channel, value, `Dashboard openTodos[${index}]`)
    stringValue(channel, todo.id, `Dashboard openTodos[${index}].id`)
    stringValue(channel, todo.projectId, `Dashboard openTodos[${index}].projectId`)
    stringValue(channel, todo.projectName, `Dashboard openTodos[${index}].projectName`)
    stringValue(channel, todo.content, `Dashboard openTodos[${index}].content`)
    finiteNumber(channel, todo.createdAt, `Dashboard openTodos[${index}].createdAt`)
  })
  arrayValue(channel, result.launchFailures, 'Dashboard launchFailures').forEach((value, index) => {
    const failure = objectValue(channel, value, `Dashboard launchFailures[${index}]`)
    stringValue(channel, failure.projectId, `Dashboard launchFailures[${index}].projectId`)
    stringValue(channel, failure.profileId, `Dashboard launchFailures[${index}].profileId`)
    stringValue(channel, failure.error, `Dashboard launchFailures[${index}].error`)
  })
}

function validatePublicSettings(channel: string, value: unknown) {
  const settings = objectValue(channel, value, '设置')
  stringValue(channel, settings.screenshotsDirectory, 'screenshotsDirectory')
  const llm = objectValue(channel, settings.llm, 'LLM 设置')
  stringValue(channel, llm.baseUrl, 'LLM baseUrl')
  stringValue(channel, llm.model, 'LLM model')
  booleanValue(channel, llm.hasApiKey, 'LLM hasApiKey')
  stringValue(channel, llm.defaultLanguage, 'LLM defaultLanguage')
  enumValue(channel, llm.logGranularity, 'LLM logGranularity', ['minimal', 'normal', 'detailed'])
  enumValue(channel, llm.toneMode, 'LLM toneMode', ['historical', 'standardized'])
  stringArray(channel, llm.excludedPaths, 'LLM excludedPaths')
  stringArray(channel, llm.customRules, 'LLM customRules')
  if (llm.apiKey !== undefined) fail(channel, '公开设置不能包含 API Key')
}

function validateScreenshotMigration(channel: string, value: unknown) {
  const result = objectValue(channel, value, '截图目录迁移结果')
  stringValue(channel, result.screenshotsDirectory, 'screenshotsDirectory')
  finiteNumber(channel, result.moved, 'moved')
  arrayValue(channel, result.cleanupFailures, 'cleanupFailures').forEach((value, index) => {
    const failure = objectValue(channel, value, `cleanupFailures[${index}]`)
    stringValue(channel, failure.path, `cleanupFailures[${index}].path`)
    stringValue(channel, failure.reason, `cleanupFailures[${index}].reason`)
  })
}

function validateDeletionResult(channel: string, value: unknown) {
  const result = objectValue(channel, value, '删除结果')
  booleanValue(channel, result.deleted, 'deleted')
  arrayValue(channel, result.assetFailures, 'assetFailures').forEach((value, index) => {
    const failure = objectValue(channel, value, `assetFailures[${index}]`)
    stringValue(channel, failure.path, `assetFailures[${index}].path`)
    stringValue(channel, failure.reason, `assetFailures[${index}].reason`)
  })
}

function validateGitSyncResult(channel: string, value: unknown) {
  const result = objectValue(channel, value, 'Git 同步结果')
  finiteNumber(channel, result.inserted, 'inserted')
  finiteNumber(channel, result.scanned, 'scanned')
  stringValue(channel, result.headSha, 'headSha')
  booleanValue(channel, result.cursorWasReset, 'cursorWasReset')
  if (result.invalidatedLaunchProfiles !== undefined) finiteNumber(channel, result.invalidatedLaunchProfiles, 'invalidatedLaunchProfiles')
  if (result.scanGeneration !== undefined) stringValue(channel, result.scanGeneration, 'scanGeneration')
  if (result.resumed !== undefined) booleanValue(channel, result.resumed, 'resumed')
  if (result.total !== undefined) finiteNumber(channel, result.total, 'total')
}

function validateAiPreview(channel: string, value: unknown) {
  const preview = objectValue(channel, value, 'AI 输入预览')
  arrayValue(channel, preview.commits, 'AI commits').forEach(item => validateGitCommit(channel, item))
  stringArray(channel, preview.shas, 'AI shas').forEach((sha, index) => shaValue(channel, sha, `AI shas[${index}]`))
  stringArray(channel, preview.files, 'AI files')
  stringArray(channel, preview.assetCandidates, 'AI assetCandidates')
  const totalStats = objectValue(channel, preview.totalStats, 'AI totalStats')
  finiteNumber(channel, totalStats.added, 'AI totalStats.added')
  finiteNumber(channel, totalStats.deleted, 'AI totalStats.deleted')
  finiteNumber(channel, totalStats.files, 'AI totalStats.files')
  finiteNumber(channel, preview.totalPending, 'totalPending')
  nullableString(channel, preview.nextCursor, 'nextCursor')
  nullableNumber(channel, preview.oldestAuthoredAt, 'oldestAuthoredAt')
  nullableNumber(channel, preview.newestAuthoredAt, 'newestAuthoredAt')
}

function validatePage(channel: string, value: unknown, itemValidator: (channel: string, value: unknown) => void) {
  const page = objectValue(channel, value, '分页结果')
  arrayValue(channel, page.items, '分页结果.items').forEach(item => itemValidator(channel, item))
  nullableString(channel, page.nextCursor, '分页结果.nextCursor')
}

const stringChannels = new Set([
  'status:create', 'tag:create', 'project:create-empty', 'record:create',
  'note:create', 'todo:create', 'asset:save-image',
])

const booleanChannels = new Set([
  'status:update', 'status:reorder', 'tag:update', 'tag:delete',
  'record:update', 'record:review',
  'note:update', 'note:delete', 'todo:update', 'todo:delete',
  'launch:delete', 'launch:open', 'task:cancel', 'task:retry',
])

export function validateIpcResponse<T>(channel: string, value: T): T {
  validateCloneData(channel, value)

  if (stringChannels.has(channel)) {
    stringValue(channel, value, '返回值')
    return value
  }
  if (booleanChannels.has(channel)) {
    booleanValue(channel, value)
    return value
  }

  switch (channel) {
    case 'get-app-version': {
      const result = objectValue(channel, value)
      stringValue(channel, result.version, 'version')
      booleanValue(channel, result.isPackaged, 'isPackaged')
      booleanValue(channel, result.isPortable, 'isPortable')
      break
    }
    case 'update-check':
    case 'update-download':
    case 'update-quit-and-install': {
      booleanValue(channel, objectValue(channel, value).success, 'success')
      break
    }
    case 'project:list':
      arrayValue(channel, value).forEach(item => validateProject(channel, item))
      break
    case 'project:get':
      if (value !== null) validateProject(channel, value)
      break
    case 'project:update':
      validateProject(channel, value)
      break
    case 'project:choose-directory':
      if (value !== null) validateInspection(channel, value)
      break
    case 'project:inspect-directory':
      validateInspection(channel, value)
      break
    case 'project:relink': {
      const result = objectValue(channel, value)
      validateInspection(channel, result.inspection)
      if (result.syncResult !== null) validateGitSyncResult(channel, result.syncResult)
      stringValue(channel, result.syncError, 'syncError')
      finiteNumber(channel, result.invalidatedLaunchProfiles, 'invalidatedLaunchProfiles')
      arrayValue(channel, result.assetWarnings, 'assetWarnings')
        .forEach(warning => validateProjectAssetWarning(channel, warning))
      break
    }
    case 'project:import': {
      const result = objectValue(channel, value)
      stringValue(channel, result.projectId, 'projectId')
      validateInspection(channel, result.inspection)
      if (result.syncResult !== null) validateGitSyncResult(channel, result.syncResult)
      stringValue(channel, result.syncError, 'syncError')
      break
    }
    case 'project:delete':
    case 'record:delete':
    case 'record:image:delete':
      validateDeletionResult(channel, value)
      break
    case 'project:open-directory':
    case 'project:open-remote':
    case 'path:open':
    case 'status:delete':
      booleanValue(channel, objectValue(channel, value).ok, 'ok')
      break
    case 'dashboard:get':
      validateDashboard(channel, value)
      break
    case 'status:list':
      arrayValue(channel, value).forEach(item => validateStatus(channel, item))
      break
    case 'tag:list':
      arrayValue(channel, value).forEach(item => validateTag(channel, item))
      break
    case 'git:sync':
      validateGitSyncResult(channel, value)
      break
    case 'git:list':
      validatePage(channel, value, validateGitCommit)
      break
    case 'git:mark-seen':
      finiteNumber(channel, value, '返回值')
      break
    case 'git:set-disposition': {
      const result = objectValue(channel, value)
      stringValue(channel, result.projectId, 'projectId')
      shaValue(channel, result.sha, 'sha')
      enumValue(channel, result.disposition, 'disposition', ['pending', 'handled', 'ignored'])
      finiteNumber(channel, result.seenAt, 'seenAt')
      break
    }
    case 'record:list':
      validatePage(channel, value, validateRecord)
      break
    case 'record:drafts':
      arrayValue(channel, value).forEach(item => validateRecord(channel, item))
      break
    case 'record:image:add':
    case 'record:image:update':
      validateRecordImage(channel, value)
      break
    case 'record:image:reorder':
      arrayValue(channel, value, '开发记录图片列表').forEach(image => validateRecordImage(channel, image))
      break
    case 'settings:get':
    case 'settings:update':
      validatePublicSettings(channel, value)
      break
    case 'settings:choose-screenshots-directory':
      if (value !== null) validateScreenshotMigration(channel, value)
      break
    case 'settings:reset-screenshots-directory':
      validateScreenshotMigration(channel, value)
      break
    case 'ai:test-connection': {
      const result = objectValue(channel, value, 'LLM 连接测试结果')
      booleanValue(channel, result.ok, 'ok')
      stringValue(channel, result.model, 'model')
      enumValue(channel, result.responseType, 'responseType', ['models', 'compatible', 'chat'])
      break
    }
    case 'ai:input-preview':
      validateAiPreview(channel, value)
      break
    case 'ai:rules:get':
      validateAiRules(channel, value)
      break
    case 'ai:rules:list':
      arrayValue(channel, value).forEach(item => validateAiRules(channel, item))
      break
    case 'ai:rules:save': {
      const result = objectValue(channel, value, 'AI 规则保存结果')
      stringValue(channel, result.id, '规则 ID')
      finiteNumber(channel, result.version, '规则版本')
      break
    }
    case 'ai:apply-project-suggestion': {
      const result = objectValue(channel, value)
      stringValue(channel, result.projectId, 'projectId')
      stringValue(channel, result.generationRunId, 'generationRunId')
      stringValue(channel, result.applicationId, 'applicationId')
      arrayValue(channel, result.inputShas, 'inputShas').forEach(sha => stringValue(channel, sha, 'Git SHA'))
      arrayValue(channel, result.appliedTagIds, 'appliedTagIds').forEach(id => stringValue(channel, id, '标签 ID'))
      arrayValue(channel, result.createdTags, 'createdTags').forEach(tag => validateTag(channel, tag))
      break
    }
    case 'ai:generate-drafts':
    case 'ai:runs:retry':
      validateAiGenerationResult(channel, value)
      break
    case 'ai:runs:list':
      arrayValue(channel, value).forEach(item => validateAiRunSummary(channel, item))
      break
    case 'ai:runs:get':
      validateAiRunDetail(channel, value)
      break
    case 'launch:list':
      arrayValue(channel, value).forEach(item => validateLaunchProfile(channel, item))
      break
    case 'launch:save':
    case 'launch:confirm':
      validateLaunchProfile(channel, value)
      break
    case 'launch:start':
      validateLaunchRuntime(channel, value)
      break
    case 'launch:stop':
    case 'launch:status':
      if (value !== null) validateLaunchRuntime(channel, value)
      break
    case 'launch:state':
      validateLaunchRuntime(channel, value)
      break
    case 'git:state':
      validateGitState(channel, value)
      break
    case 'asset:choose-images':
      if (value !== null) {
        if (Array.isArray(value)) value.forEach(item => stringValue(channel, item, '图片路径'))
        else stringValue(channel, value, '图片路径')
      }
      break
    case 'task:list':
      arrayValue(channel, value, '后台任务列表').forEach(task => validateTask(channel, task))
      break
    case 'task:progress':
      validateTask(channel, value)
      break
    default:
      break
  }
  return value
}
