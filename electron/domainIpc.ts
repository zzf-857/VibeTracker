import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import path from 'node:path'
import { AssetService } from './services/assetService'
import { DatabaseService } from './services/databaseService'
import { findProjectAssetCandidates, inspectProjectDirectory, runGit } from './services/gitService'
import { persistProjectRelinkMetadata, ProjectGitOperationLock } from './services/gitRepository'
import { GitSyncCoordinator, GitSyncScheduler } from './services/gitSyncScheduler'
import { LaunchProfileService, LaunchRunService, ProcessManager } from './services/launchService'
import {
  AI_PROMPT_VERSION,
  computeLlmInputHash,
  filterCommitFiles,
  LlmService,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  type LlmGenerateInput,
  type LlmSettingsSnapshot,
} from './services/llmService'
import { SettingsService } from './services/settingsService'
import { ScreenshotDirectoryService } from './services/screenshotDirectoryService'
import { TaskService, type BackgroundTaskRecord, type BackgroundTaskStatus } from './services/taskService'
import { expectFiniteNumber, expectId, expectObject, expectObjectFields, expectString, expectStringArray, validateImportLaunchCandidate, ValidationError } from './services/validation'
import type { SqliteDatabase } from './services/databaseMigrations'
import { authorizeAssetPathForPersistence, authorizeAssetPaths } from './services/assetPolicy'
import { isTrustedRendererUrl } from './services/rendererTrust'
import { validateIpcResponse } from './services/ipcResponseValidation'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>
let db: Database.Database
const activeTasks = new Map<string, { cancel: () => boolean; canCancel: () => boolean }>()
const retryTasks = new Map<string, (event: IpcMainInvokeEvent) => Promise<unknown>>()

function assertTrustedSender(event: IpcMainInvokeEvent, devServerUrl?: string) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || owner.isDestroyed()) throw new Error('拒绝来自未知窗口的 IPC 请求')
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  const rendererFile = path.join(process.env.APP_ROOT || path.join(__dirname, '..'), 'dist', 'index.html')
  if (!isTrustedRendererUrl(senderUrl, { devServerUrl, rendererFile })) {
    throw new Error('拒绝来自非应用页面的 IPC 请求')
  }
}

function ensureSerializable(channel: string, value: unknown) {
  try {
    structuredClone(value)
  } catch {
    throw new Error('主进程返回了不可序列化的数据')
  }
  return validateIpcResponse(channel, value)
}

function register(channel: string, devServerUrl: string | undefined, handler: Handler) {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedSender(event, devServerUrl)
    try {
      return ensureSerializable(channel, await handler(event, ...args))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[DomainIPC:${channel}]`, message)
      if (error instanceof ValidationError) throw error
      throw new Error(message)
    }
  })
}

function getProjectRow(projectId: string) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown> | undefined
  if (!project) throw new Error('项目不存在')
  return project
}

function expectExistingStatusId(value: unknown, label = '状态 ID') {
  const statusId = expectId(value, label)
  if (!db.prepare('SELECT 1 FROM project_statuses WHERE id = ?').get(statusId)) {
    throw new ValidationError('项目状态不存在')
  }
  return statusId
}

function expectExistingTagIds(value: unknown, label = '标签') {
  const tagIds = [...new Set(expectStringArray(value, label, 100).map(id => expectId(id, '标签 ID')))]
  if (!tagIds.length) return tagIds
  const placeholders = tagIds.map(() => '?').join(',')
  const count = db.prepare(`SELECT COUNT(*) AS count FROM tags WHERE id IN (${placeholders})`).get(...tagIds) as { count: number | bigint }
  if (Number(count.count) !== tagIds.length) throw new ValidationError('标签包含不存在的 ID')
  return tagIds
}

function expectColor(value: unknown, label: string) {
  const color = expectString(value, label, { required: true, max: 20 })
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ValidationError(`${label}必须是 6 位十六进制颜色`)
  return color.toUpperCase()
}

function expectGitSha(value: unknown, label = 'Git SHA') {
  const sha = expectString(value, label, { required: true, max: 64 })
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new ValidationError(`${label}格式无效`)
  return sha.toLowerCase()
}

function developmentDuration(name: string) {
  if (app.isPackaged) return undefined
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 && value <= 60_000 ? value : undefined
}

function assertUniqueName(table: 'project_statuses' | 'tags', name: string, excludeId = '') {
  const rows = db.prepare(`SELECT id, name FROM ${table}`).all() as Array<{ id: string; name: string }>
  if (rows.some(row => row.id !== excludeId && row.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
    throw new ValidationError('名称已存在')
  }
}

function taskEmitter(
  taskHistory: TaskService,
  event: IpcMainInvokeEvent,
  kind: string,
  projectId: string,
  context: Record<string, unknown> = {},
  retry?: (event: IpcMainInvokeEvent) => Promise<unknown>,
) {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const controller = new AbortController()
  let cancelled = false
  let cancellationLocked = false
  const emit = (status: BackgroundTaskStatus, detail = '', progress?: number) => {
    if (cancelled && status !== 'cancelled') return
    const updatedAt = Date.now()
    const generationRunId = typeof context.generationRunId === 'string' ? context.generationRunId : undefined
    const retryableKind = ['git-sync', 'git-sync-scheduled', 'ai-generate', 'assets-migrate'].includes(kind)
    const task: BackgroundTaskRecord = {
      id,
      kind,
      projectId,
      status,
      detail,
      canRetry: (status === 'failed' || status === 'interrupted') && (Boolean(retry) || retryableKind),
      canCancel: status === 'running' && !cancellationLocked,
      createdAt,
      updatedAt,
      ...(generationRunId ? { generationRunId } : {}),
      ...(progress === undefined ? {} : { progress }),
    }
    try {
      taskHistory.upsert(task, context)
    } catch (error) {
      console.error('[Tasks] Unable to persist task progress:', error)
    }
    if (!event.sender.isDestroyed()) {
      event.sender.send('task:progress', validateIpcResponse('task:progress', task))
    }
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      activeTasks.delete(id)
      if (status === 'failed' && retry) {
        retryTasks.set(id, retry)
        while (retryTasks.size > 50) retryTasks.delete(retryTasks.keys().next().value as string)
      } else {
        retryTasks.delete(id)
      }
    }
  }
  const cancel = () => {
    if (cancelled || cancellationLocked) return false
    cancelled = true
    controller.abort()
    emit('cancelled', '用户已取消任务')
    return true
  }
  const lockCancellation = () => { cancellationLocked = true }
  activeTasks.set(id, { cancel, canCancel: () => !cancelled && !cancellationLocked })
  emit('running', '', 0)
  return { id, emit, signal: controller.signal, lockCancellation }
}

export function setupDomainIpc(databaseConnection: Database.Database, devServerUrl?: string) {
  db = databaseConnection
  const database = new DatabaseService(db)
  const taskHistory = new TaskService(db as unknown as SqliteDatabase)
  const recoveredTasks = taskHistory.recoverInterrupted()
  if (recoveredTasks > 0) console.warn(`[Tasks] Recovered ${recoveredTasks} interrupted background task(s)`)
  const recoveredAiRuns = database.recoverInterruptedAiGenerationRuns()
  if (recoveredAiRuns > 0) {
    console.warn(`[AI] Recovered ${recoveredAiRuns} interrupted generation run(s) from the previous application session`)
  }
  const settings = new SettingsService()
  const assets = new AssetService(db as unknown as SqliteDatabase, settings)
  const screenshotDirectories = new ScreenshotDirectoryService(
    db as unknown as SqliteDatabase,
    settings,
    app.getPath('userData'),
  )
  void assets.reconcileManagedAssets().catch(error => console.error('[Assets] Managed asset reconciliation failed:', error))
  void screenshotDirectories.ready().catch(error => console.error('[Assets] Screenshot directory recovery failed:', error))
  const llm = new LlmService(settings)
  const launchProfiles = new LaunchProfileService(db)
  const launchRuns = new LaunchRunService(db)
  const recoveredLaunchRuns = launchRuns.recoverInterrupted()
  if (recoveredLaunchRuns > 0) {
    console.warn(`[Launch] Recovered ${recoveredLaunchRuns} interrupted launch run(s) from the previous application session`)
  }
  const gitOperationLock = new ProjectGitOperationLock()
  const activeAiGenerations = new Set<string>()
  const processManager = new ProcessManager(state => {
    const payload = validateIpcResponse('launch:state', state)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('launch:state', payload)
    }
  }, undefined, { history: launchRuns })
  const scheduledGitTaskIds = new Map<string, string>()
  const gitSyncCoordinator = new GitSyncCoordinator(db as unknown as SqliteDatabase, {
    lock: gitOperationLock,
    onState: state => {
      const payload = validateIpcResponse('git:state', state)
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('git:state', payload)
      }
      if (state.reason !== 'scheduled') return
      let taskId = scheduledGitTaskIds.get(state.projectId)
      if (state.status === 'syncing') {
        taskId = taskId || crypto.randomUUID()
        scheduledGitTaskIds.set(state.projectId, taskId)
        activeTasks.set(taskId, {
          cancel: () => gitSyncScheduler.cancelProject(state.projectId),
          canCancel: () => true,
        })
      }
      if (!taskId) return
      const status: BackgroundTaskStatus = state.status === 'syncing'
        ? 'running'
        : state.status === 'synced'
          ? 'completed'
          : state.status === 'cancelled'
            ? 'cancelled'
            : 'failed'
      const detail = state.status === 'syncing'
        ? state.total
          ? `${state.resumed ? '继续' : '正在'}回填 Git 历史 ${state.processed || 0}/${state.total}`
          : '正在自动扫描本地 Git 提交'
        : state.status === 'synced'
          ? state.resumed
            ? state.inserted
              ? `已从断点继续完成，发现 ${state.inserted} 个新提交`
              : '已从断点继续完成，Git 已是最新状态'
            : state.inserted
              ? `自动同步发现 ${state.inserted} 个新提交`
              : '自动同步完成，Git 已是最新状态'
          : state.status === 'cancelled'
            ? '自动 Git 同步已取消'
            : state.error || '自动 Git 同步失败'
      const existing = taskHistory.get(taskId)?.task
      const scheduledTask: BackgroundTaskRecord = {
        id: taskId,
        kind: 'git-sync-scheduled',
        projectId: state.projectId,
        status,
        detail,
        progress: state.status === 'syncing' ? state.progress || 0 : 100,
        canRetry: status === 'failed',
        canCancel: status === 'running',
        createdAt: existing?.createdAt || state.updatedAt,
        updatedAt: state.updatedAt,
      }
      try { taskHistory.upsert(scheduledTask) } catch (error) { console.error('[Tasks] Unable to persist scheduled Git task:', error) }
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('task:progress', validateIpcResponse('task:progress', scheduledTask))
        }
      }
      if (state.status !== 'syncing') {
        scheduledGitTaskIds.delete(state.projectId)
        activeTasks.delete(taskId)
      }
    },
  })
  const gitSyncScheduler = new GitSyncScheduler(db as unknown as SqliteDatabase, gitSyncCoordinator, {
    intervalMs: developmentDuration('VIBETRACKER_E2E_GIT_SCHEDULER_INTERVAL_MS'),
    syncIntervalMs: developmentDuration('VIBETRACKER_E2E_GIT_SYNC_INTERVAL_MS'),
  })

  const getEffectiveAiRules = async (projectId: string) => {
    const saved = database.getAiRules(projectId)
    if (saved) return saved
    const publicSettings = await settings.getPublic()
    const records = database.getRecordsPage(projectId, { limit: 20 }).items
    const averageLength = records.length
      ? Math.round(records.reduce((sum, record) => sum + String(record.description || '').length, 0) / records.length)
      : 160
    return {
      version: 0,
      language: publicSettings.llm.defaultLanguage,
      toneMode: publicSettings.llm.toneMode,
      summaryGuidance: '说明项目解决的问题、当前能力与边界。',
      recordGuidance: `参考历史记录的简洁程度，每条约 ${Math.max(80, Math.min(500, averageLength))} 字；陈述已完成的事实，不夸大。`,
      exclusions: ['node_modules/**', 'dist/**', 'build/**', '*.lock', '.env*'],
      customRules: ['优先使用已有标签', '每条记录必须关联真实 Git SHA'],
      suggestedFromHistory: true,
    }
  }
  const hasLiveLaunchRuntime = (profileId: string) => {
    const runtime = processManager.get(profileId)
    return Boolean(runtime && (['starting', 'running', 'ready'].includes(runtime.state) || runtime.pid !== null))
  }
  const hasLiveProjectRuntime = (projectId: string) => processManager.list().some(runtime => (
    runtime.projectId === projectId
    && (['starting', 'running', 'ready'].includes(runtime.state) || runtime.pid !== null)
  ))
  const mergeLiveLaunchCapabilities = <T extends object>(projects: T[]): T[] => {
    const liveByProject = new Map(
      processManager.list()
        .filter(runtime => ['starting', 'running', 'ready'].includes(runtime.state) || runtime.pid !== null)
        .map(runtime => [runtime.projectId, runtime] as const),
    )
    return projects.map(project => {
      const runtime = liveByProject.get(String((project as { id?: unknown }).id || ''))
      if (!runtime) return project
      const profile = launchProfiles.get(runtime.profileId)
      if (!profile) return project
      return {
        ...project,
        launchCapability: {
          profileId: profile.id,
          validated: profile.validated,
          canOpen: Boolean(profile.readyUrl),
        },
      } as T
    })
  }

  const syncProject = (event: IpcMainInvokeEvent, projectId: string) => {
    if (gitSyncCoordinator.isActive(projectId)) {
      return gitSyncCoordinator.sync(projectId, { reason: 'manual' })
    }
    const task = taskEmitter(taskHistory, event, 'git-sync', projectId)
    return gitSyncCoordinator.sync(projectId, {
      reason: 'manual',
      signal: task.signal,
      onProgress: state => {
        if (state.status !== 'syncing') return
        const detail = state.total
          ? `${state.resumed ? '继续' : '正在'}回填 Git 历史 ${state.processed || 0}/${state.total}`
          : '正在扫描本地 Git 提交'
        task.emit('running', detail, state.progress || 0)
      },
    }).then(result => {
      task.emit('completed', `发现 ${result.inserted} 个新提交`, 100)
      return result
    }).catch(error => {
      if (!task.signal.aborted) task.emit('failed', error instanceof Error ? error.message : String(error))
      throw error
    })
  }

  const migrateScreenshotsDirectory = async (event: IpcMainInvokeEvent, targetDirectory: string) => {
    const retry = (retryEvent: IpcMainInvokeEvent) => migrateScreenshotsDirectory(retryEvent, targetDirectory)
    const task = taskEmitter(taskHistory, event, 'assets-migrate', '', { targetDirectory }, retry)
    try {
      const result = await screenshotDirectories.migrateTo(targetDirectory, {
        signal: task.signal,
        onProgress: progress => task.emit('running', progress.detail, progress.progress),
        onCommitStart: task.lockCancellation,
      })
      task.emit('completed', result.cleanupFailures.length
        ? `已迁移 ${result.moved} 个托管文件，${result.cleanupFailures.length} 个旧副本待下次启动清理`
        : `已迁移 ${result.moved} 个托管文件`, 100)
      return result
    } catch (error) {
      if (!task.signal.aborted) task.emit('failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const replayAiContext = (inputSnapshotValue: unknown, settingsSnapshotValue: unknown, commits: ReturnType<DatabaseService['getAiInput']>) => {
    const snapshot = expectObject(inputSnapshotValue, 'AI 输入快照')
    const projectSnapshot = expectObject(snapshot.project, 'AI 输入快照项目')
    const historySnapshot = Array.isArray(snapshot.history) ? snapshot.history : []
    const rulesSnapshot = expectObject(snapshot.rules, 'AI 规则快照')
    const toneMode = expectString(rulesSnapshot.toneMode, 'AI 规则快照风格', { required: true, max: 30 })
    if (!['historical', 'standardized'].includes(toneMode)) throw new ValidationError('AI 规则快照风格无效')
    const generationInput: LlmGenerateInput = {
      project: {
        name: expectString(projectSnapshot.name, '快照项目名称', { required: true, max: 200 }),
        description: expectString(projectSnapshot.description, '快照项目简介', { max: 5_000 }),
        phase: expectString(projectSnapshot.phase, '快照项目阶段', { max: 200 }),
        milestone: expectString(projectSnapshot.milestone, '快照项目里程碑', { max: 500 }),
        nextStep: expectString(projectSnapshot.nextStep, '快照项目下一步', { max: 500 }),
      },
      history: historySnapshot.slice(0, 50).map((value, index) => {
        const record = expectObject(value, `历史快照[${index}]`)
        return {
          title: expectString(record.title, `历史快照[${index}].title`, { max: 240 }),
          description: expectString(record.description, `历史快照[${index}].description`, { max: 8_000 }),
        }
      }),
      commits,
      assetCandidates: snapshot.assetCandidates === undefined
        ? []
        : expectStringArray(snapshot.assetCandidates, '截图候选快照', 50),
      knownTags: expectStringArray(snapshot.knownTags, '标签快照', 500),
      rules: {
        language: expectString(rulesSnapshot.language, 'AI 规则快照语言', { required: true, max: 50 }),
        toneMode,
        summaryGuidance: expectString(rulesSnapshot.summaryGuidance, 'AI 简介规则快照', { max: 3_000 }),
        recordGuidance: expectString(rulesSnapshot.recordGuidance, 'AI 记录规则快照', { max: 3_000 }),
        exclusions: expectStringArray(rulesSnapshot.exclusions, 'AI 排除路径快照', 200),
        customRules: expectStringArray(rulesSnapshot.customRules, 'AI 自定义规则快照', 100),
      },
    }
    const settingsSnapshot = expectObject(settingsSnapshotValue, 'LLM 设置快照')
    const logGranularity = expectString(settingsSnapshot.logGranularity, '日志粒度快照', { required: true, max: 20 })
    if (!['minimal', 'normal', 'detailed'].includes(logGranularity)) throw new ValidationError('日志粒度快照无效')
    const settingsToneMode = expectString(settingsSnapshot.toneMode, '设置风格快照', { required: true, max: 30 })
    if (!['historical', 'standardized'].includes(settingsToneMode)) throw new ValidationError('设置风格快照无效')
    const llmSettings: LlmSettingsSnapshot = {
      baseUrl: expectString(settingsSnapshot.baseUrl, 'Base URL 快照', { required: true, max: 2_048 }),
      model: expectString(settingsSnapshot.model, 'Model 快照', { required: true, max: 300 }),
      defaultLanguage: expectString(settingsSnapshot.defaultLanguage, '默认语言快照', { required: true, max: 50 }),
      logGranularity: logGranularity as LlmSettingsSnapshot['logGranularity'],
      toneMode: settingsToneMode as LlmSettingsSnapshot['toneMode'],
      excludedPaths: expectStringArray(settingsSnapshot.excludedPaths, '全局排除路径快照', 200),
      customRules: expectStringArray(settingsSnapshot.customRules, '全局生成规则快照', 100),
    }
    return { generationInput, llmSettings }
  }

  const generateAiDrafts = async (
    event: IpcMainInvokeEvent,
    projectId: string,
    shas: string[],
    replaceDraftIds: string[],
    replay?: { inputSnapshot: unknown; settingsSnapshot: unknown; rulesVersion: number },
    providerId = OPENAI_COMPATIBLE_PROVIDER_ID,
  ) => {
    if (activeAiGenerations.has(projectId)) throw new Error('该项目已有 AI 生成任务正在进行')
    activeAiGenerations.add(projectId)
    try {
      return await gitOperationLock.run(projectId, async () => {
        const project = getProjectRow(projectId)
        const commits = database.getAiInput(projectId, shas)
        if (commits.length !== shas.length) throw new Error('提交范围包含已处理、已忽略、未同步、不可达或不属于该项目的 SHA')

        const validateUsage = () => {
          const usage = database.getDevelopmentRecordUsage(projectId, shas)
          if (usage.some(item => item.reviewStatus === 'accepted')) {
            throw new Error('提交范围中已有 Git SHA 生成了正式开发记录，请选择尚未处理的提交')
          }
          const replaceSet = new Set(replaceDraftIds)
          const uncoveredDraft = usage.find(item => item.reviewStatus === 'draft' && !replaceSet.has(item.recordId))
          if (uncoveredDraft) throw new Error('提交范围已有待审核草稿；请先审核，或从原生成结果执行重新生成')
        }
        validateUsage()
        if (replaceDraftIds.length) {
          const placeholders = replaceDraftIds.map(() => '?').join(',')
          const replaceRows = db.prepare(`
            SELECT dr.id, link.gitSha FROM development_records dr
            LEFT JOIN development_record_git_commits link ON link.recordId = dr.id
            WHERE dr.projectId = ? AND dr.source = 'ai' AND dr.reviewStatus = 'draft'
              AND dr.id IN (${placeholders})
          `).all(projectId, ...replaceDraftIds) as Array<{ id: string; gitSha: string | null }>
          const foundIds = new Set(replaceRows.map(row => row.id))
          if (foundIds.size !== replaceDraftIds.length) throw new Error('待替换草稿不存在或已被审核，请刷新后重试')
          if (replaceRows.some(row => row.gitSha && !shas.includes(row.gitSha))) {
            throw new Error('重新生成范围必须包含旧草稿关联的全部 Git SHA')
          }
        }

        let generationInput: LlmGenerateInput
        let llmSettings: LlmSettingsSnapshot
        let rulesVersion = replay?.rulesVersion || 0
        if (replay) {
          const restored = replayAiContext(replay.inputSnapshot, replay.settingsSnapshot, commits)
          generationInput = restored.generationInput
          llmSettings = restored.llmSettings
        } else {
          const repositoryPath = expectString(project.canonicalPath || project.path, '项目路径', { required: true, max: 4_096, trim: false })
          const [rules, publicSettings, assetCandidates] = await Promise.all([
            getEffectiveAiRules(projectId),
            settings.getPublic(),
            findProjectAssetCandidates(repositoryPath),
          ])
          const knownTags = (db.prepare('SELECT name FROM tags ORDER BY name').all() as Array<{ name: string }>).map(tag => tag.name)
          const history = database.getRecordsPage(projectId, { limit: 8 }).items.map(record => ({
            title: String(record.title || ''),
            description: String(record.description || ''),
          }))
          generationInput = {
            project: {
              name: String(project.name), description: String(project.description || ''),
              phase: String(project.phase || ''), milestone: String(project.milestone || ''), nextStep: String(project.nextStep || ''),
            },
            history,
            commits,
            assetCandidates,
            knownTags,
            rules: {
              language: String(rules.language), toneMode: String(rules.toneMode),
              summaryGuidance: String(rules.summaryGuidance || ''), recordGuidance: String(rules.recordGuidance || ''),
              exclusions: rules.exclusions as string[], customRules: rules.customRules as string[],
            },
          }
          llmSettings = {
            baseUrl: publicSettings.llm.baseUrl,
            model: publicSettings.llm.model,
            defaultLanguage: publicSettings.llm.defaultLanguage,
            logGranularity: publicSettings.llm.logGranularity,
            toneMode: publicSettings.llm.toneMode,
            excludedPaths: publicSettings.llm.excludedPaths,
            customRules: publicSettings.llm.customRules,
          }
          rulesVersion = Number(rules.version || 0)
        }

        const inputHash = computeLlmInputHash(generationInput, llmSettings)
        const generationRunId = database.beginAiGenerationRun({
          projectId,
          provider: providerId,
          model: llmSettings.model,
          promptVersion: AI_PROMPT_VERSION,
          inputHash,
          inputShas: shas,
          rulesVersion,
          rulesSnapshot: generationInput.rules,
          settingsSnapshot: llmSettings,
          inputSnapshot: generationInput,
          replaceDraftIds,
        })
        const task = taskEmitter(taskHistory, event, 'ai-generate', projectId, { generationRunId })
        try {
          const result = await llm.generate(generationInput, task.signal, llmSettings, providerId)
          if (!result.payload.records.length) throw new Error('模型没有生成任何开发记录草稿')
          if (task.signal.aborted) throw new Error('操作已取消')
          if (database.getAiInput(projectId, shas).length !== shas.length) {
            throw new Error('生成期间 Git 提交已变为已处理、已忽略或不可达，未写入草稿')
          }
          validateUsage()
          const persisted = database.completeAiGenerationRun(generationRunId, {
            inputHash: result.metadata.inputHash,
            output: result.payload,
            records: result.payload.records.map(record => ({
              title: record.title, description: record.description, gitShas: record.gitShas,
              confidence: record.confidence, evidence: record.evidence,
            })),
          })
          task.emit('completed', `生成 ${persisted.draftIds.length} 条待审核草稿`, 100)
          const detail = database.getAiGenerationRun(projectId, generationRunId)
          return { ...result, ...persisted, drafts: detail?.drafts || [] }
        } catch (error) {
          const cancelled = task.signal.aborted
          const message = cancelled ? '操作已取消' : error instanceof Error ? error.message : String(error)
          database.finishAiGenerationRun(generationRunId, cancelled ? 'cancelled' : 'failed', message)
          if (!cancelled) task.emit('failed', message)
          throw new Error(message, { cause: error })
        }
      })
    } finally {
      activeAiGenerations.delete(projectId)
    }
  }

  register('project:list', devServerUrl, () => mergeLiveLaunchCapabilities(database.getProjectSummaries()))
  register('project:get', devServerUrl, (_, projectId) => {
    const project = database.getProject(expectId(projectId, '项目 ID'))
    return project ? mergeLiveLaunchCapabilities([project])[0] : null
  })
  register('project:update', devServerUrl, async (_, projectIdValue, value) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const project = getProjectRow(projectId)
    const input = expectObjectFields(value, '项目更新', [
      'name', 'description', 'status', 'repoUrl', 'coverImagePath',
      'phase', 'milestone', 'nextStep', 'tagIds',
    ])
    const fields: string[] = []
    const values: unknown[] = []
    let nextCoverImagePath: string | undefined
    const add = (column: string, next: unknown) => { fields.push(`${column} = ?`); values.push(next) }
    if (input.name !== undefined) add('name', expectString(input.name, '项目名称', { required: true, max: 200 }))
    if (input.description !== undefined) add('description', expectString(input.description, '项目简介', { max: 5_000 }))
    if (input.status !== undefined) {
      add('status', expectExistingStatusId(input.status))
    }
    if (input.repoUrl !== undefined) add('repoUrl', expectString(input.repoUrl, 'Remote URL', { max: 2_048, trim: false }))
    if (input.coverImagePath !== undefined) {
      const coverImagePath = expectString(input.coverImagePath, '封面路径', { max: 4_096, trim: false })
      nextCoverImagePath = authorizeAssetPathForPersistence(db, coverImagePath, { projectId })
      add('coverImagePath', nextCoverImagePath)
    }
    if (input.phase !== undefined) add('phase', expectString(input.phase, '阶段', { max: 200 }))
    if (input.milestone !== undefined) add('milestone', expectString(input.milestone, '里程碑', { max: 500 }))
    if (input.nextStep !== undefined) add('nextStep', expectString(input.nextStep, '下一步', { max: 500 }))
    const tagIds = input.tagIds === undefined ? undefined : expectExistingTagIds(input.tagIds)
    const now = Date.now()
    db.transaction(() => {
      if (fields.length) {
        fields.push('updatedAt = ?')
        values.push(now, projectId)
        db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      }
      if (tagIds) {
        db.prepare('DELETE FROM project_tags WHERE projectId = ?').run(projectId)
        const insertTag = db.prepare('INSERT OR IGNORE INTO project_tags (projectId, tagId) VALUES (?, ?)')
        tagIds.forEach(tagId => insertTag.run(projectId, tagId))
        if (!fields.length) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, projectId)
      }
    })()
    if (nextCoverImagePath !== undefined) {
      const failures = await assets.reconcileManagedPaths([
        String(project.coverImagePath || ''),
        nextCoverImagePath,
      ])
      if (failures.length) console.error('[Assets] Project cover cleanup failed:', failures)
    }
    return database.getProject(projectId)
  })
  register('dashboard:get', devServerUrl, () => {
    const summary = database.getDashboardSummary()
    const launchFailureByProfile = new Map(launchRuns.listCurrentFailures().map(failure => [failure.profileId, {
      projectId: failure.projectId,
      profileId: failure.profileId,
      error: failure.error,
    }]))
    processManager.list().filter(state => state.state === 'failed').forEach(state => {
      launchFailureByProfile.set(state.profileId, {
        projectId: state.projectId,
        profileId: state.profileId,
        error: state.error,
      })
    })
    return {
      ...summary,
      pendingReview: mergeLiveLaunchCapabilities(summary.pendingReview),
      recentProjects: mergeLiveLaunchCapabilities(summary.recentProjects),
      launchableProjects: mergeLiveLaunchCapabilities(summary.launchableProjects),
      failures: mergeLiveLaunchCapabilities(summary.failures),
      launchFailures: [...launchFailureByProfile.values()],
    }
  })

  register('status:list', devServerUrl, () => {
    const statuses = db.prepare('SELECT * FROM project_statuses ORDER BY sortIndex, createdAt').all() as Array<Record<string, unknown>>
    const counts = db.prepare('SELECT status, COUNT(*) AS count FROM projects GROUP BY status').all() as Array<{ status: string; count: number | bigint }>
    const countByStatus = new Map(counts.map(item => [item.status, Number(item.count)]))
    return statuses.map(status => ({ ...status, projectCount: countByStatus.get(String(status.id)) || 0 }))
  })
  register('status:create', devServerUrl, (_, value) => {
    const input = expectObjectFields(value, '状态', ['name', 'color'])
    const name = expectString(input.name, '状态名称', { required: true, max: 80 })
    const color = expectColor(input.color, '状态颜色')
    assertUniqueName('project_statuses', name)
    const id = crypto.randomUUID()
    const now = Date.now()
    const maxSort = db.prepare('SELECT COALESCE(MAX(sortIndex), -1) AS value FROM project_statuses').get() as { value: number }
    db.prepare('INSERT INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, color, Number(maxSort.value) + 1, now, now)
    return id
  })
  register('status:update', devServerUrl, (_, statusIdValue, value) => {
    const statusId = expectId(statusIdValue, '状态 ID')
    const input = expectObjectFields(value, '状态', ['name', 'color', 'sortIndex'])
    const current = db.prepare('SELECT * FROM project_statuses WHERE id = ?').get(statusId) as Record<string, unknown> | undefined
    if (!current) throw new Error('状态不存在')
    const name = input.name === undefined ? String(current.name) : expectString(input.name, '状态名称', { required: true, max: 80 })
    const color = input.color === undefined ? String(current.color) : expectColor(input.color, '状态颜色')
    const sortIndex = input.sortIndex === undefined
      ? Number(current.sortIndex)
      : expectFiniteNumber(input.sortIndex, '状态顺序', { integer: true, min: 0, max: 10_000 })
    if (!Number.isInteger(sortIndex) || sortIndex < 0 || sortIndex > 10_000) throw new ValidationError('状态顺序无效')
    assertUniqueName('project_statuses', name, statusId)
    db.prepare('UPDATE project_statuses SET name = ?, color = ?, sortIndex = ?, updatedAt = ? WHERE id = ?')
      .run(name, color, sortIndex, Date.now(), statusId)
    return true
  })
  register('status:delete', devServerUrl, (_, statusIdValue) => {
    const statusId = expectId(statusIdValue, '状态 ID')
    const statusCount = db.prepare('SELECT COUNT(*) AS count FROM project_statuses').get() as { count: number | bigint }
    if (Number(statusCount.count) <= 1) return { ok: false, reason: '至少需要保留一个状态' }
    const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE status = ?').get(statusId) as { count: number | bigint }
    if (Number(projectCount.count) > 0) return { ok: false, reason: '仍有项目正在使用该状态' }
    return { ok: db.prepare('DELETE FROM project_statuses WHERE id = ?').run(statusId).changes > 0 }
  })
  register('status:reorder', devServerUrl, (_, orderedIdsValue) => {
    const orderedIds = expectStringArray(orderedIdsValue, '状态顺序', 200).map(id => expectId(id, '状态 ID'))
    const existing = (db.prepare('SELECT id FROM project_statuses').all() as Array<{ id: string }>).map(item => item.id)
    if (orderedIds.length !== existing.length || new Set(orderedIds).size !== existing.length || existing.some(id => !orderedIds.includes(id))) {
      throw new ValidationError('状态顺序必须包含全部状态且不能重复')
    }
    const update = db.prepare('UPDATE project_statuses SET sortIndex = ?, updatedAt = ? WHERE id = ?')
    const now = Date.now()
    db.transaction(() => orderedIds.forEach((id, index) => update.run(index, now, id)))()
    return true
  })

  register('tag:list', devServerUrl, () => db.prepare('SELECT * FROM tags ORDER BY createdAt DESC').all())
  register('tag:create', devServerUrl, (_, value) => {
    const input = expectObjectFields(value, '标签', ['name', 'color'])
    const name = expectString(input.name, '标签名称', { required: true, max: 80 })
    const color = expectColor(input.color, '标签颜色')
    assertUniqueName('tags', name)
    const id = crypto.randomUUID()
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)').run(id, name, color, Date.now())
    return id
  })
  register('tag:update', devServerUrl, (_, tagIdValue, value) => {
    const tagId = expectId(tagIdValue, '标签 ID')
    const input = expectObjectFields(value, '标签', ['name', 'color'])
    const current = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId) as { name: string; color: string } | undefined
    if (!current) throw new Error('标签不存在')
    const name = input.name === undefined ? current.name : expectString(input.name, '标签名称', { required: true, max: 80 })
    const color = input.color === undefined ? current.color : expectColor(input.color, '标签颜色')
    assertUniqueName('tags', name, tagId)
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, tagId)
    return true
  })
  register('tag:delete', devServerUrl, (_, tagIdValue) => db.prepare('DELETE FROM tags WHERE id = ?').run(expectId(tagIdValue, '标签 ID')).changes > 0)

  register('project:choose-directory', devServerUrl, async event => {
    const e2eDirectory = process.env.VIBETRACKER_E2E_PROJECT_DIR
    if (e2eDirectory && !app.isPackaged) {
      const inspection = await inspectProjectDirectory(e2eDirectory)
      authorizeAssetPaths(inspection.assetCandidates)
      return inspection
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('窗口不可用')
    const selected = await dialog.showOpenDialog(owner, { properties: ['openDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    const inspection = await inspectProjectDirectory(selected.filePaths[0])
    authorizeAssetPaths(inspection.assetCandidates)
    return inspection
  })
  register('project:open-directory', devServerUrl, async (_, projectIdValue) => {
    const project = getProjectRow(expectId(projectIdValue, '项目 ID'))
    const localPath = expectString(project.canonicalPath || project.path, '项目路径', { required: true, max: 4_096, trim: false })
    const error = await shell.openPath(path.resolve(localPath))
    return error ? { ok: false, reason: error } : { ok: true }
  })
  register('project:open-remote', devServerUrl, async (_, projectIdValue) => {
    const project = getProjectRow(expectId(projectIdValue, '项目 ID'))
    const raw = expectString(project.repoUrl, 'Remote URL', { required: true, max: 2_048, trim: false })
    let url: URL
    try { url = new URL(raw) } catch { throw new ValidationError('Remote URL 无效') }
    if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError('Remote URL 仅支持 HTTP/HTTPS')
    await shell.openExternal(url.toString())
    return { ok: true }
  })

  register('project:inspect-directory', devServerUrl, async (_, selectedPath) => {
    const inspection = await inspectProjectDirectory(expectString(selectedPath, '项目路径', { required: true, max: 4_096, trim: false }))
    authorizeAssetPaths(inspection.assetCandidates)
    return inspection
  })

  register('project:relink', devServerUrl, async (event, projectIdValue, selectedPathValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const selectedPath = expectString(selectedPathValue, '项目路径', { required: true, max: 4_096, trim: false })
    const prepared = await gitOperationLock.run(projectId, async () => {
      const project = getProjectRow(projectId)
      if (hasLiveProjectRuntime(projectId)) throw new Error('项目仍在运行，请先停止后再重新关联仓库')
      const inspection = await inspectProjectDirectory(selectedPath)
      authorizeAssetPaths(inspection.assetCandidates)
      if (!inspection.isGitRepository) throw new Error('重新关联需要选择 Git 仓库')
      const duplicate = db.prepare('SELECT name FROM projects WHERE canonicalPath = ? AND id <> ? LIMIT 1')
        .get(inspection.canonicalPath, projectId) as { name: string } | undefined
      if (duplicate) throw new Error(`该目录已关联到项目「${duplicate.name}」`)

      const state = database.getGitSyncState(projectId)
      const anchorSha = String(state?.lastSyncedSha || '')
      if (anchorSha) {
        let containsAnchor = true
        try {
          await runGit(inspection.repositoryRoot, ['cat-file', '-e', `${anchorSha}^{commit}`], 10_000)
        } catch {
          containsAnchor = false
        }
        const oldRemote = String(state?.remoteUrl || project.repoUrl || '')
        if (!containsAnchor && (!oldRemote || !inspection.remoteUrl || oldRemote !== inspection.remoteUrl)) {
          throw new Error('所选仓库与当前项目的 Git 历史不兼容；为避免混合两个项目，请将它作为新项目导入')
        }
      }

      const metadata = persistProjectRelinkMetadata(db as unknown as SqliteDatabase, projectId, inspection)
      return { inspection, ...metadata, assetWarnings: database.getRelinkAssetWarnings(projectId) }
    })

    let syncResult: Awaited<ReturnType<typeof syncProject>> | null = null
    let syncError = ''
    try {
      syncResult = await syncProject(event, projectId)
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error)
    }
    return {
      inspection: prepared.inspection,
      syncResult: syncResult ? { ...syncResult, invalidatedLaunchProfiles: prepared.invalidatedLaunchProfiles } : null,
      syncError,
      invalidatedLaunchProfiles: prepared.invalidatedLaunchProfiles,
      assetWarnings: prepared.assetWarnings,
    }
  })

  register('project:import', devServerUrl, async (event, value) => {
    const input = expectObjectFields(value, '导入参数', [
      'selectedPath', 'name', 'description', 'status', 'tagIds',
      'coverImagePath', 'gitHistoryLimit', 'launchCandidate',
    ])
    const selectedPath = expectString(input.selectedPath, '项目路径', { required: true, max: 4_096, trim: false })
    // Always rescan in the main process. Renderer inspection data is display-only and never trusted for creation.
    const inspection = await inspectProjectDirectory(selectedPath)
    const name = expectString(input.name, '项目名称', { required: true, max: 200 })
    const description = expectString(input.description, '项目简介', { max: 5_000 })
    const status = input.status ? expectExistingStatusId(input.status) : undefined
    const tagIds = input.tagIds === undefined ? [] : expectExistingTagIds(input.tagIds)
    const gitHistoryLimit = input.gitHistoryLimit === undefined
      ? 0
      : expectFiniteNumber(input.gitHistoryLimit, 'Git 历史基线数量', { integer: true, min: 0, max: 100_000 })
    const requestedCoverImagePath = input.coverImagePath === undefined ? '' : expectString(input.coverImagePath, '封面路径', { max: 4_096, trim: false })
    const coverImagePath = authorizeAssetPathForPersistence(db, requestedCoverImagePath, {
      roots: [inspection.repositoryRoot, inspection.canonicalPath],
    })
    const projectId = database.importProject(inspection, { name, description, status, tagIds, coverImagePath, gitHistoryLimit })
    if (coverImagePath) {
      const failures = await assets.reconcileManagedPaths([coverImagePath])
      if (failures.length) console.error('[Assets] Imported project cover reconciliation failed:', failures)
    }
    let syncResult = null
    let syncError = ''
    if (inspection.isGitRepository) {
      const task = taskEmitter(taskHistory, event, 'git-sync', projectId)
      try {
        syncResult = await gitSyncCoordinator.sync(projectId, {
          reason: 'manual',
          signal: task.signal,
          onProgress: state => {
            if (state.status !== 'syncing') return
            const detail = state.total
              ? `${state.resumed ? '继续' : '正在'}导入 Git 历史 ${state.processed || 0}/${state.total}`
              : '正在扫描本地 Git 提交'
            task.emit('running', detail, state.progress || 0)
          },
        })
        task.emit('completed', `已导入 ${syncResult.inserted} 个 Git 提交`, 100)
      } catch (error) {
        syncError = task.signal.aborted ? '首次 Git 同步已取消' : error instanceof Error ? error.message : String(error)
        if (!task.signal.aborted) task.emit('failed', syncError)
      }
    }
    if (input.launchCandidate) {
      const candidate = validateImportLaunchCandidate(projectId, input.launchCandidate)
      try {
        await gitOperationLock.run(projectId, async () => {
          await launchProfiles.save(candidate)
        })
      } catch (error) {
        await gitOperationLock.run(projectId, () => assets.deleteProject(projectId))
        throw error
      }
    }
    return { projectId, inspection, syncResult, syncError }
  })

  register('project:create-empty', devServerUrl, (_, value) => {
    const input = expectObjectFields(value, '项目', ['name', 'description', 'status', 'tagIds'])
    const id = crypto.randomUUID()
    const now = Date.now()
    const name = expectString(input.name, '项目名称', { required: true, max: 200 })
    const description = expectString(input.description, '项目简介', { max: 5_000 })
    const tagIds = input.tagIds === undefined ? [] : expectExistingTagIds(input.tagIds)
    const defaultStatus = (db.prepare('SELECT id FROM project_statuses ORDER BY sortIndex LIMIT 1').get() as { id: string } | undefined)?.id || 'status-developing'
    const status = input.status ? expectExistingStatusId(input.status) : defaultStatus
    db.transaction(() => {
      db.prepare(`INSERT INTO projects (id, name, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, name, description, status, now, now)
      const insertTag = db.prepare('INSERT OR IGNORE INTO project_tags (projectId, tagId) VALUES (?, ?)')
      tagIds.forEach(tagId => insertTag.run(id, tagId))
    })()
    return id
  })

  register('project:delete', devServerUrl, async (_, projectIdValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    return gitOperationLock.run(projectId, async () => {
      getProjectRow(projectId)
      await processManager.stopProject(projectId)
      return assets.deleteProject(projectId)
    })
  })

  register('git:sync', devServerUrl, async (event, projectIdValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    return syncProject(event, projectId)
  })

  register('git:list', devServerUrl, (_, projectIdValue, optionsValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const options = optionsValue === undefined ? {} : expectObjectFields(optionsValue, '分页参数', ['cursor', 'limit'])
    return database.getGitCommits(projectId, {
      cursor: options.cursor === undefined ? undefined : typeof options.cursor === 'number' ? options.cursor : expectString(options.cursor, '分页游标', { required: true, max: 300, trim: false }),
      limit: options.limit === undefined ? undefined : expectFiniteNumber(options.limit, '分页数量', { integer: true, min: 1, max: 200 }),
    })
  })
  register('git:mark-seen', devServerUrl, (_, projectIdValue, shasValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const shas = expectStringArray(shasValue, 'Git SHA', 200).map((sha, index) => expectGitSha(sha, `Git SHA[${index}]`))
    return database.markGitCommitsSeen(projectId, shas)
  })
  register('git:set-disposition', devServerUrl, (_, projectIdValue, shaValue, dispositionValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const disposition = expectString(dispositionValue, '提交处理状态', { required: true, max: 20 })
    if (!['pending', 'handled', 'ignored'].includes(disposition)) throw new ValidationError('提交处理状态无效')
    return database.setGitCommitDisposition(
      projectId,
      expectGitSha(shaValue),
      disposition as 'pending' | 'handled' | 'ignored',
    )
  })

  register('record:list', devServerUrl, (_, projectIdValue, optionsValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const options = optionsValue === undefined ? {} : expectObjectFields(optionsValue, '分页参数', ['cursor', 'limit', 'reviewStatus'])
    const reviewStatus = options.reviewStatus === undefined
      ? undefined
      : expectString(options.reviewStatus, '审核状态', { required: true, max: 20 })
    if (reviewStatus && !['draft', 'accepted', 'rejected'].includes(reviewStatus)) throw new ValidationError('审核状态无效')
    return database.getRecordsPage(projectId, {
      cursor: options.cursor === undefined ? undefined : typeof options.cursor === 'number' ? options.cursor : expectString(options.cursor, '分页游标', { required: true, max: 300, trim: false }),
      limit: options.limit === undefined ? undefined : expectFiniteNumber(options.limit, '分页数量', { integer: true, min: 1, max: 100 }),
      reviewStatus,
    })
  })
  register('record:create', devServerUrl, (_, value) => {
    const input = expectObjectFields(value, '开发记录', [
      'projectId', 'title', 'description', 'imagePaths', 'gitShas', 'createdAt',
    ])
    const projectId = expectId(input.projectId, '项目 ID')
    getProjectRow(projectId)
    const imagePaths = [...new Set((input.imagePaths === undefined ? [] : expectStringArray(input.imagePaths, '图片路径', 50))
      .map(imagePath => authorizeAssetPathForPersistence(db, imagePath, { projectId })))]
    const gitShas = input.gitShas === undefined
      ? []
      : expectStringArray(input.gitShas, 'Git SHA', 200).map((sha, index) => expectGitSha(sha, `Git SHA[${index}]`))
    const recordId = database.createManualRecord({
      projectId,
      title: expectString(input.title, '标题', { required: true, max: 240 }),
      description: expectString(input.description, '内容', { max: 8_000 }),
      imagePaths,
      gitShas,
      createdAt: input.createdAt === undefined ? undefined : expectFiniteNumber(input.createdAt, '记录时间', { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER }),
    })
    imagePaths.forEach(imagePath => assets.attachToRecord(imagePath, projectId, recordId))
    return recordId
  })
  register('record:update', devServerUrl, (_, recordIdValue, value) => {
    const recordId = expectId(recordIdValue, '开发记录 ID')
    const input = expectObjectFields(value, '开发记录', ['title', 'description', 'createdAt'])
    return database.updateRecord(recordId, {
      title: input.title === undefined ? undefined : expectString(input.title, '标题', { required: true, max: 240 }),
      description: input.description === undefined ? undefined : expectString(input.description, '内容', { max: 8_000 }),
      createdAt: input.createdAt === undefined ? undefined : expectFiniteNumber(input.createdAt, '记录时间', { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER }),
    })
  })
  register('record:delete', devServerUrl, async (_, recordId) => assets.deleteRecord(expectId(recordId, '开发记录 ID')))
  register('record:drafts', devServerUrl, (_, projectId) => database.getAiDrafts(expectId(projectId, '项目 ID')))
  register('record:review', devServerUrl, (_, recordIdValue, value) => {
    const input = expectObjectFields(value, '审核参数', ['status', 'title', 'description', 'ignoreGitShas'])
    const status = expectString(input.status, '审核状态', { required: true, max: 20 })
    if (status !== 'accepted' && status !== 'rejected') throw new ValidationError('审核状态必须是 accepted 或 rejected')
    if (input.ignoreGitShas !== undefined && typeof input.ignoreGitShas !== 'boolean') {
      throw new ValidationError('忽略 Git 提交标记必须是布尔值')
    }
    return database.reviewDraft(expectId(recordIdValue, '草稿 ID'), status, {
      title: input.title === undefined ? undefined : expectString(input.title, '标题', { required: true, max: 240 }),
      description: input.description === undefined ? undefined : expectString(input.description, '内容', { max: 8_000 }),
      ignoreGitShas: input.ignoreGitShas === true,
    })
  })
  register('record:image:add', devServerUrl, (_, recordIdValue, value) => {
    const recordId = expectId(recordIdValue, '开发记录 ID')
    const record = database.getAcceptedRecordContext(recordId)
    if (!record) throw new ValidationError('正式开发记录不存在或尚未通过审核')
    const input = expectObjectFields(value, '开发记录图片', ['imagePath', 'caption'])
    const imagePath = authorizeAssetPathForPersistence(
      db,
      expectString(input.imagePath, '图片路径', { required: true, max: 4_096, trim: false }),
      { projectId: record.projectId },
    )
    const image = database.addRecordImage(
      recordId,
      imagePath,
      input.caption === undefined ? '' : expectString(input.caption, '图片说明', { max: 1_000, trim: false }),
    )
    assets.attachToRecord(imagePath, record.projectId, recordId)
    return image
  })
  register('record:image:update', devServerUrl, (_, recordIdValue, imageIdValue, value) => {
    const input = expectObjectFields(value, '开发记录图片', ['caption'])
    if (input.caption === undefined) throw new ValidationError('必须提供图片说明')
    return database.updateRecordImage(
      expectId(recordIdValue, '开发记录 ID'),
      expectId(imageIdValue, '图片 ID'),
      expectString(input.caption, '图片说明', { max: 1_000, trim: false }),
    )
  })
  register('record:image:reorder', devServerUrl, (_, recordIdValue, orderedIdsValue) => {
    const orderedIds = expectStringArray(orderedIdsValue, '图片排序', 200)
      .map((imageId, index) => expectId(imageId, `图片排序[${index}]`))
    return database.reorderRecordImages(expectId(recordIdValue, '开发记录 ID'), orderedIds)
  })
  register('record:image:delete', devServerUrl, (_, recordIdValue, imageIdValue) => assets.deleteRecordImage(
    expectId(recordIdValue, '开发记录 ID'),
    expectId(imageIdValue, '图片 ID'),
  ))

  register('note:create', devServerUrl, (_, projectIdValue, contentValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    getProjectRow(projectId)
    const content = expectString(contentValue, '备注内容', { required: true, max: 20_000 })
    const id = crypto.randomUUID()
    const now = Date.now()
    db.transaction(() => {
      db.prepare('INSERT INTO noteblocks (id, projectId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(id, projectId, content, now, now)
      db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, projectId)
    })()
    return id
  })
  register('note:update', devServerUrl, (_, noteIdValue, contentValue) => {
    const noteId = expectId(noteIdValue, '备注 ID')
    const content = expectString(contentValue, '备注内容', { required: true, max: 20_000 })
    const note = db.prepare('SELECT projectId FROM noteblocks WHERE id = ?').get(noteId) as { projectId: string } | undefined
    if (!note) throw new Error('备注不存在')
    const now = Date.now()
    db.transaction(() => {
      db.prepare('UPDATE noteblocks SET content = ?, updatedAt = ? WHERE id = ?').run(content, now, noteId)
      db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, note.projectId)
    })()
    return true
  })
  register('note:delete', devServerUrl, (_, noteIdValue) => {
    const noteId = expectId(noteIdValue, '备注 ID')
    const note = db.prepare('SELECT projectId FROM noteblocks WHERE id = ?').get(noteId) as { projectId: string } | undefined
    if (!note) return false
    const now = Date.now()
    return db.transaction(() => {
      const deleted = db.prepare('DELETE FROM noteblocks WHERE id = ?').run(noteId).changes > 0
      if (deleted) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, note.projectId)
      return deleted
    })()
  })
  register('todo:create', devServerUrl, (_, projectIdValue, contentValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    getProjectRow(projectId)
    const content = expectString(contentValue, '待办内容', { required: true, max: 5_000 })
    const id = crypto.randomUUID()
    const now = Date.now()
    db.transaction(() => {
      db.prepare('INSERT INTO todos (id, projectId, content, completed, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)').run(id, projectId, content, now, now)
      db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, projectId)
    })()
    return id
  })
  register('todo:update', devServerUrl, (_, todoIdValue, value) => {
    const todoId = expectId(todoIdValue, '待办 ID')
    const input = expectObjectFields(value, '待办', ['content', 'completed'])
    if (input.completed !== undefined && typeof input.completed !== 'boolean') {
      throw new ValidationError('待办完成状态必须是布尔值')
    }
    const todo = db.prepare('SELECT projectId, content, completed FROM todos WHERE id = ?').get(todoId) as { projectId: string; content: string; completed: number } | undefined
    if (!todo) throw new Error('待办不存在')
    const content = input.content === undefined ? todo.content : expectString(input.content, '待办内容', { required: true, max: 5_000 })
    const completed = input.completed === undefined ? Boolean(todo.completed) : input.completed
    const now = Date.now()
    db.transaction(() => {
      db.prepare('UPDATE todos SET content = ?, completed = ?, updatedAt = ? WHERE id = ?').run(content, completed ? 1 : 0, now, todoId)
      db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, todo.projectId)
    })()
    return true
  })
  register('todo:delete', devServerUrl, (_, todoIdValue) => {
    const todoId = expectId(todoIdValue, '待办 ID')
    const todo = db.prepare('SELECT projectId FROM todos WHERE id = ?').get(todoId) as { projectId: string } | undefined
    if (!todo) return false
    const now = Date.now()
    return db.transaction(() => {
      const deleted = db.prepare('DELETE FROM todos WHERE id = ?').run(todoId).changes > 0
      if (deleted) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, todo.projectId)
      return deleted
    })()
  })

  register('settings:get', devServerUrl, () => settings.getPublic())
  register('settings:update', devServerUrl, (_, value) => settings.update(value))
  register('settings:choose-screenshots-directory', devServerUrl, async event => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('窗口不可用')
    const e2eDirectory = process.env.VIBETRACKER_E2E_SCREENSHOTS_DIR
    if (e2eDirectory && !app.isPackaged) return migrateScreenshotsDirectory(event, e2eDirectory)
    const selected = await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    return migrateScreenshotsDirectory(event, selected.filePaths[0])
  })
  register('settings:reset-screenshots-directory', devServerUrl, event => (
    migrateScreenshotsDirectory(event, screenshotDirectories.getDefaultDirectory())
  ))
  register('ai:test-connection', devServerUrl, (_, value) => {
    const input = value === undefined ? {} : expectObjectFields(value, 'LLM 连接测试参数', ['providerId', 'baseUrl', 'model', 'apiKey'])
    const baseUrl = input.baseUrl === undefined
      ? undefined
      : expectString(input.baseUrl, 'Base URL', { required: true, max: 2_048 })
    if (baseUrl) {
      let parsed: URL
      try { parsed = new URL(baseUrl) } catch { throw new ValidationError('Base URL 不是有效 URL') }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new ValidationError('Base URL 仅支持 HTTP/HTTPS')
    }
    return llm.testConnection({
      providerId: input.providerId === undefined ? undefined : expectString(input.providerId, 'Provider ID', { required: true, max: 100 }),
      baseUrl,
      model: input.model === undefined ? undefined : expectString(input.model, 'Model', { required: true, max: 300 }),
      apiKey: input.apiKey === undefined ? undefined : expectString(input.apiKey, 'API Key', { required: true, max: 8_192, trim: false }),
    })
  })
  register('ai:input-preview', devServerUrl, async (_, projectIdValue, optionsValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const project = getProjectRow(projectId)
    const options = optionsValue === undefined ? {} : expectObjectFields(optionsValue, 'AI 输入范围', ['cursor', 'authoredAfter', 'authoredBefore', 'limit'])
    const cursor = options.cursor === undefined
      ? undefined
      : expectString(options.cursor, 'AI 输入分页游标', { required: true, max: 200, trim: false })
    if (cursor && !/^\d+\|[0-9a-f]{40,64}$/i.test(cursor)) throw new ValidationError('AI 输入分页游标无效')
    const authoredAfter = options.authoredAfter === undefined
      ? undefined
      : expectFiniteNumber(options.authoredAfter, '起始提交时间', { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER })
    const authoredBefore = options.authoredBefore === undefined
      ? undefined
      : expectFiniteNumber(options.authoredBefore, '结束提交时间', { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER })
    if (authoredAfter !== undefined && authoredBefore !== undefined && authoredAfter > authoredBefore) {
      throw new ValidationError('起始提交时间不能晚于结束提交时间')
    }
    const preview = database.getAiInputPreview(projectId, {
      cursor,
      authoredAfter,
      authoredBefore,
      limit: options.limit === undefined
        ? undefined
        : expectFiniteNumber(options.limit, 'AI 输入分页数量', { integer: true, min: 1, max: 100 }),
    })
    const repositoryPath = expectString(project.canonicalPath || project.path, '项目路径', { required: true, max: 4_096, trim: false })
    const [publicSettings, projectRules, assetCandidates] = await Promise.all([
      settings.getPublic(),
      Promise.resolve(database.getAiRules(projectId)),
      findProjectAssetCandidates(repositoryPath),
    ])
    const commits = filterCommitFiles(preview.commits, [
      ...publicSettings.llm.excludedPaths,
      ...(projectRules?.exclusions || []),
    ])
    return {
      ...preview,
      commits,
      assetCandidates,
      files: [...new Set(commits.flatMap(commit => commit.fileNames))].sort(),
      totalStats: {
        ...preview.totalStats,
        files: commits.reduce((sum, commit) => sum + commit.fileNames.length, 0),
      },
    }
  })
  register('ai:rules:get', devServerUrl, async (_, projectIdValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    return getEffectiveAiRules(projectId)
  })
  register('ai:rules:list', devServerUrl, (_, projectIdValue) => database.listAiRules(expectId(projectIdValue, '项目 ID')))
  register('ai:rules:save', devServerUrl, (_, projectIdValue, value) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const input = expectObjectFields(value, 'AI 规则', [
      'language', 'toneMode', 'summaryGuidance', 'recordGuidance', 'exclusions', 'customRules',
    ])
    const toneMode = expectString(input.toneMode, '风格模式', { required: true, max: 30 })
    if (!['historical', 'standardized'].includes(toneMode)) throw new ValidationError('风格模式无效')
    return database.saveAiRules(projectId, {
      language: expectString(input.language, '语言', { required: true, max: 30 }),
      toneMode,
      summaryGuidance: expectString(input.summaryGuidance, '简介规则', { max: 3_000 }),
      recordGuidance: expectString(input.recordGuidance, '记录规则', { max: 3_000 }),
      exclusions: expectStringArray(input.exclusions, '排除路径', 200),
      customRules: expectStringArray(input.customRules, '自定义规则', 100),
    })
  })
  register('ai:apply-project-suggestion', devServerUrl, (_, projectIdValue, value) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const input = expectObjectFields(value, 'AI 项目建议', [
      'generationRunId', 'name', 'description', 'phase', 'tagNames',
    ])
    const generationRunId = expectId(input.generationRunId, 'AI generation run ID')
    const tagNames = expectStringArray(input.tagNames, '建议标签', 100)
      .map((tagName, index) => expectString(tagName, `建议标签[${index}]`, { required: true, max: 80 }))
    return database.applyAiProjectSuggestion(projectId, generationRunId, {
      name: expectString(input.name, '项目名称建议', { required: true, max: 200 }),
      description: expectString(input.description, '项目简介建议', { max: 5_000 }),
      phase: expectString(input.phase, '项目阶段建议', { max: 200 }),
      tagNames,
    })
  })
  register('ai:generate-drafts', devServerUrl, async (event, projectIdValue, shasValue, optionsValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const shas = [...new Set(expectStringArray(shasValue, 'Git SHA', 200).map((sha, index) => expectGitSha(sha, `Git SHA[${index}]`)))]
    if (!shas.length) throw new ValidationError('至少选择一个 Git SHA')
    const options = optionsValue === undefined ? {} : expectObjectFields(optionsValue, '生成选项', ['replaceDraftIds'])
    const replaceDraftIds = options.replaceDraftIds === undefined
      ? []
      : [...new Set(expectStringArray(options.replaceDraftIds, '待替换草稿', 30).map(id => expectId(id, '草稿 ID')))]
    return generateAiDrafts(event, projectId, shas, replaceDraftIds)
  })
  register('ai:runs:list', devServerUrl, (_, projectIdValue) => (
    database.getAiGenerationRuns(expectId(projectIdValue, '项目 ID'))
  ))
  register('ai:runs:get', devServerUrl, (_, projectIdValue, generationRunIdValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const generationRunId = expectId(generationRunIdValue, 'AI generation run ID')
    const run = database.getAiGenerationRun(projectId, generationRunId)
    if (!run) throw new Error('AI generation run 不存在')
    return run
  })
  register('ai:runs:retry', devServerUrl, async (event, projectIdValue, generationRunIdValue) => {
    const projectId = expectId(projectIdValue, '项目 ID')
    const generationRunId = expectId(generationRunIdValue, 'AI generation run ID')
    const run = database.getAiGenerationRun(projectId, generationRunId)
    if (!run) throw new Error('AI generation run 不存在')
    if (run.status === 'running') throw new Error('该 AI generation run 仍在执行')
    const shas = [...new Set((run.inputShas as string[]).map((sha, index) => expectGitSha(sha, `历史 Git SHA[${index}]`)))]
    if (!shas.length) throw new Error('该 AI generation run 没有可重试的 Git SHA')
    const currentDraftIds = (run.drafts as unknown as Array<{ id: unknown; reviewStatus?: unknown }>)
      .filter(draft => draft.reviewStatus === 'draft')
      .map(draft => expectId(draft.id, '历史草稿 ID'))
    const replaceDraftIds = run.status === 'succeeded'
      ? currentDraftIds
      : (run.replaceDraftIds as string[]).map(id => expectId(id, '待替换草稿 ID'))
    return generateAiDrafts(event, projectId, shas, replaceDraftIds, {
      inputSnapshot: run.inputSnapshot,
      settingsSnapshot: run.settingsSnapshot,
      rulesVersion: Number(run.rulesVersion || 0),
    }, expectString(run.provider, '历史 Provider ID', { required: true, max: 100 }))
  })

  register('launch:list', devServerUrl, (_, projectId) => launchProfiles.list(expectId(projectId, '项目 ID')))
  register('launch:save', devServerUrl, async (_, value) => {
    const input = expectObjectFields(value, '启动配置', [
      'id', 'projectId', 'name', 'executable', 'args', 'cwd', 'env',
      'readyUrl', 'readyPort', 'enabled',
    ])
    const projectId = expectId(input.projectId, '项目 ID')
    const profileId = input.id === undefined ? '' : expectId(input.id, '启动配置 ID')
    return gitOperationLock.run(projectId, async () => {
      getProjectRow(projectId)
      if (profileId && hasLiveLaunchRuntime(profileId)) throw new Error('启动配置正在运行，请先停止后再修改')
      return launchProfiles.save(value)
    })
  })
  register('launch:confirm', devServerUrl, async (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    const existing = launchProfiles.get(profileId)
    if (!existing) throw new Error('启动配置不存在')
    return gitOperationLock.run(existing.projectId, async () => {
      getProjectRow(existing.projectId)
      return launchProfiles.confirm(profileId)
    })
  })
  register('launch:delete', devServerUrl, async (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    const existing = launchProfiles.get(profileId)
    if (!existing) return false
    return gitOperationLock.run(existing.projectId, async () => {
      getProjectRow(existing.projectId)
      await processManager.dispose(profileId)
      return launchProfiles.delete(profileId)
    })
  })
  register('launch:start', devServerUrl, async (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    const existing = launchProfiles.get(profileId)
    if (!existing) throw new Error('启动配置不存在')
    return gitOperationLock.run(existing.projectId, async () => {
      getProjectRow(existing.projectId)
      const profile = launchProfiles.get(profileId)
      if (!profile) throw new Error('启动配置不存在')
      return processManager.start(profile)
    })
  })
  register('launch:stop', devServerUrl, async (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    const projectId = launchProfiles.get(profileId)?.projectId || processManager.get(profileId)?.projectId
    if (!projectId) return processManager.stop(profileId)
    return gitOperationLock.run(projectId, () => processManager.stop(profileId))
  })
  register('launch:status', devServerUrl, (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    return processManager.get(profileId) || launchRuns.getLatestRuntime(profileId)
  })
  register('launch:open', devServerUrl, async (_, profileIdValue) => {
    const profileId = expectId(profileIdValue, '启动配置 ID')
    const existing = launchProfiles.get(profileId)
    if (!existing) throw new Error('启动配置不存在')
    return gitOperationLock.run(existing.projectId, async () => {
      const profile = launchProfiles.get(profileId)
      if (!profile?.readyUrl) throw new Error('启动配置没有可打开的 URL')
      const runtime = processManager.get(profileId)
      if (runtime?.state !== 'ready') throw new Error('项目尚未达到可打开的就绪状态')
      await shell.openExternal(profile.readyUrl)
      return true
    })
  })

  register('asset:save-image', devServerUrl, (_, dataUrl, fileName) => assets.saveImageData(
    expectString(dataUrl, '图片数据', { required: true, max: 30 * 1024 * 1024, trim: false }),
    expectString(fileName, '文件名', { max: 300 }),
  ))
  register('asset:choose-images', devServerUrl, async (event, multipleValue) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('窗口不可用')
    if (multipleValue !== undefined && typeof multipleValue !== 'boolean') {
      throw new ValidationError('图片多选标记必须是布尔值')
    }
    const multiple = multipleValue === true
    const e2eImages = process.env.VIBETRACKER_E2E_IMAGE_PATHS
    if (e2eImages && !app.isPackaged) {
      let parsed: unknown
      try { parsed = JSON.parse(e2eImages) } catch { throw new Error('E2E 图片路径配置无效') }
      const filePaths = expectStringArray(parsed, 'E2E 图片路径', 20)
      authorizeAssetPaths(filePaths)
      return multiple ? filePaths : filePaths[0] || null
    }
    const result = await dialog.showOpenDialog(owner, {
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (result.canceled) return null
    authorizeAssetPaths(result.filePaths)
    return multiple ? result.filePaths : result.filePaths[0] || null
  })
  register('path:open', devServerUrl, async (_, localPath) => {
    const resolved = path.resolve(expectString(localPath, '本地路径', { required: true, max: 4_096, trim: false }))
    const error = await shell.openPath(resolved)
    return error ? { ok: false, reason: error } : { ok: true }
  })
  register('task:list', devServerUrl, () => taskHistory.list(50).map(task => ({
    ...task,
    canCancel: task.status === 'running' && Boolean(activeTasks.get(task.id)?.canCancel()),
  })))
  register('task:cancel', devServerUrl, (_, taskIdValue) => {
    const taskId = expectId(taskIdValue, '任务 ID')
    const task = activeTasks.get(taskId)
    if (!task) return false
    return task.cancel()
  })
  register('task:retry', devServerUrl, async (event, taskIdValue) => {
    const taskId = expectId(taskIdValue, '任务 ID')
    const retry = retryTasks.get(taskId)
    if (retry) {
      retryTasks.delete(taskId)
      await retry(event)
      return true
    }
    const stored = taskHistory.get(taskId)
    if (stored?.task.kind === 'assets-migrate' && typeof stored.context.targetDirectory === 'string') {
      await migrateScreenshotsDirectory(event, stored.context.targetDirectory)
      return true
    }
    return false
  })

  return { processManager, gitSyncScheduler }
}
