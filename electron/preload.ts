import { ipcRenderer, contextBridge } from 'electron'

// 允许渲染进程调用的 IPC 通道白名单
const ALLOWED_INVOKE_CHANNELS = [
  'get-app-version',
  'update-check',
  'update-download',
  'update-quit-and-install',
  'project:list',
  'project:get',
  'project:update',
  'project:choose-directory',
  'project:inspect-directory',
  'project:relink',
  'project:import',
  'project:create-empty',
  'project:delete',
  'project:open-directory',
  'project:open-remote',
  'dashboard:get',
  'status:list',
  'status:create',
  'status:update',
  'status:delete',
  'status:reorder',
  'tag:list',
  'tag:create',
  'tag:update',
  'tag:delete',
  'git:sync',
  'git:list',
  'git:mark-seen',
  'git:set-disposition',
  'record:list',
  'record:create',
  'record:update',
  'record:delete',
  'record:drafts',
  'record:review',
  'record:image:add',
  'record:image:update',
  'record:image:reorder',
  'record:image:delete',
  'note:create',
  'note:update',
  'note:delete',
  'todo:create',
  'todo:update',
  'todo:delete',
  'settings:get',
  'settings:update',
  'settings:choose-screenshots-directory',
  'settings:reset-screenshots-directory',
  'ai:test-connection',
  'ai:input-preview',
  'ai:rules:get',
  'ai:rules:list',
  'ai:rules:save',
  'ai:apply-project-suggestion',
  'ai:generate-drafts',
  'ai:runs:list',
  'ai:runs:get',
  'ai:runs:retry',
  'launch:list',
  'launch:save',
  'launch:confirm',
  'launch:delete',
  'launch:start',
  'launch:stop',
  'launch:status',
  'launch:open',
  'asset:save-image',
  'asset:choose-images',
  'task:list',
  'task:cancel',
  'task:retry',
] as const

const ALLOWED_ON_CHANNELS = [
  'update-message',
  'git:state',
  'launch:state',
  'task:progress',
] as const

function isAllowedInvoke(channel: string): boolean {
  return (ALLOWED_INVOKE_CHANNELS as readonly string[]).includes(channel)
}

function isAllowedOn(channel: string): boolean {
  return (ALLOWED_ON_CHANNELS as readonly string[]).includes(channel)
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!isAllowedInvoke(channel)) return Promise.reject(new Error(`未授权的 IPC 通道: ${channel}`))
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe(channel: string, listener: (...args: unknown[]) => void) {
  if (!isAllowedOn(channel)) return () => undefined
  const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// Versioned, domain-oriented API. No arbitrary channel bridge is exposed.
contextBridge.exposeInMainWorld('vibe', {
  apiVersion: 1,
  app: {
    getVersion: () => invoke('get-app-version'),
    checkForUpdates: () => invoke('update-check'),
    downloadUpdate: () => invoke('update-download'),
    quitAndInstallUpdate: () => invoke('update-quit-and-install'),
    onUpdateMessage: (listener: (...args: unknown[]) => void) => subscribe('update-message', listener),
  },
  projects: {
    list: () => invoke('project:list'),
    get: (projectId: string) => invoke('project:get', projectId),
    update: (projectId: string, input: unknown) => invoke('project:update', projectId, input),
    chooseDirectory: () => invoke('project:choose-directory'),
    inspectDirectory: (selectedPath: string) => invoke('project:inspect-directory', selectedPath),
    relink: (projectId: string, selectedPath: string) => invoke('project:relink', projectId, selectedPath),
    import: (input: unknown) => invoke('project:import', input),
    createEmpty: (input: unknown) => invoke('project:create-empty', input),
    delete: (projectId: string) => invoke('project:delete', projectId),
    openDirectory: (projectId: string) => invoke('project:open-directory', projectId),
    openRemote: (projectId: string) => invoke('project:open-remote', projectId),
  },
  dashboard: { get: () => invoke('dashboard:get') },
  taxonomy: {
    listStatuses: () => invoke('status:list'),
    createStatus: (input: unknown) => invoke('status:create', input),
    updateStatus: (statusId: string, input: unknown) => invoke('status:update', statusId, input),
    deleteStatus: (statusId: string) => invoke('status:delete', statusId),
    reorderStatuses: (orderedIds: string[]) => invoke('status:reorder', orderedIds),
    listTags: () => invoke('tag:list'),
    createTag: (input: unknown) => invoke('tag:create', input),
    updateTag: (tagId: string, input: unknown) => invoke('tag:update', tagId, input),
    deleteTag: (tagId: string) => invoke('tag:delete', tagId),
  },
  git: {
    sync: (projectId: string) => invoke('git:sync', projectId),
    list: (projectId: string, options?: unknown) => invoke('git:list', projectId, options),
    markSeen: (projectId: string, shas: string[]) => invoke('git:mark-seen', projectId, shas),
    setDisposition: (projectId: string, sha: string, disposition: string) => invoke('git:set-disposition', projectId, sha, disposition),
    onState: (listener: (...args: unknown[]) => void) => subscribe('git:state', listener),
  },
  records: {
    list: (projectId: string, options?: unknown) => invoke('record:list', projectId, options),
    create: (input: unknown) => invoke('record:create', input),
    update: (recordId: string, input: unknown) => invoke('record:update', recordId, input),
    delete: (recordId: string) => invoke('record:delete', recordId),
    drafts: (projectId: string) => invoke('record:drafts', projectId),
    review: (recordId: string, input: unknown) => invoke('record:review', recordId, input),
    addImage: (recordId: string, input: unknown) => invoke('record:image:add', recordId, input),
    updateImage: (recordId: string, imageId: string, input: unknown) => invoke('record:image:update', recordId, imageId, input),
    reorderImages: (recordId: string, orderedIds: string[]) => invoke('record:image:reorder', recordId, orderedIds),
    deleteImage: (recordId: string, imageId: string) => invoke('record:image:delete', recordId, imageId),
  },
  notes: {
    create: (projectId: string, content: string) => invoke('note:create', projectId, content),
    update: (noteId: string, content: string) => invoke('note:update', noteId, content),
    delete: (noteId: string) => invoke('note:delete', noteId),
  },
  todos: {
    create: (projectId: string, content: string) => invoke('todo:create', projectId, content),
    update: (todoId: string, input: unknown) => invoke('todo:update', todoId, input),
    delete: (todoId: string) => invoke('todo:delete', todoId),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (input: unknown) => invoke('settings:update', input),
    chooseScreenshotsDirectory: () => invoke('settings:choose-screenshots-directory'),
    resetScreenshotsDirectory: () => invoke('settings:reset-screenshots-directory'),
    testLlm: (input?: unknown) => invoke('ai:test-connection', input),
  },
  ai: {
    preview: (projectId: string, options?: unknown) => invoke('ai:input-preview', projectId, options),
    getRules: (projectId: string) => invoke('ai:rules:get', projectId),
    listRules: (projectId: string) => invoke('ai:rules:list', projectId),
    saveRules: (projectId: string, input: unknown) => invoke('ai:rules:save', projectId, input),
    applyProjectSuggestion: (projectId: string, input: unknown) => invoke('ai:apply-project-suggestion', projectId, input),
    generateDrafts: (projectId: string, shas: string[], options?: unknown) => invoke('ai:generate-drafts', projectId, shas, options),
    listRuns: (projectId: string) => invoke('ai:runs:list', projectId),
    getRun: (projectId: string, generationRunId: string) => invoke('ai:runs:get', projectId, generationRunId),
    retryRun: (projectId: string, generationRunId: string) => invoke('ai:runs:retry', projectId, generationRunId),
  },
  launch: {
    list: (projectId: string) => invoke('launch:list', projectId),
    save: (input: unknown) => invoke('launch:save', input),
    confirm: (profileId: string) => invoke('launch:confirm', profileId),
    delete: (profileId: string) => invoke('launch:delete', profileId),
    start: (profileId: string) => invoke('launch:start', profileId),
    stop: (profileId: string) => invoke('launch:stop', profileId),
    status: (profileId: string) => invoke('launch:status', profileId),
    open: (profileId: string) => invoke('launch:open', profileId),
    onState: (listener: (...args: unknown[]) => void) => subscribe('launch:state', listener),
  },
  assets: {
    saveImage: (dataUrl: string, fileName: string) => invoke('asset:save-image', dataUrl, fileName),
    chooseImages: (multiple = false) => invoke('asset:choose-images', multiple),
  },
  tasks: {
    list: () => invoke('task:list'),
    onProgress: (listener: (...args: unknown[]) => void) => subscribe('task:progress', listener),
    cancel: (taskId: string) => invoke('task:cancel', taskId),
    retry: (taskId: string) => invoke('task:retry', taskId),
  },
})
