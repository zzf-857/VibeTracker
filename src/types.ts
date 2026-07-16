export interface Tag {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface ProjectStatus {
  id: string
  name: string
  color: string
  sortIndex: number
  createdAt: number
  updatedAt: number
  projectCount?: number
}

export interface CommitImage {
  id: string
  recordId?: string
  commitId: string
  imagePath: string
  caption: string
  sortIndex: number
  createdAt: number
}

export interface DevelopmentRecord {
  id: string
  projectId: string
  title: string
  description: string
  createdAt: number
  updatedAt: number
  source?: 'manual' | 'ai'
  reviewStatus?: 'draft' | 'accepted' | 'rejected'
  gitShas?: string[]
  provider?: string
  model?: string
  promptVersion?: string
  inputHash?: string
  generationRunId?: string
  confidence?: number
  evidence?: string[]
  userEditedAt?: number | null
  images?: CommitImage[]
}

/** @deprecated Compatibility type for the retired v1 detail screen. */
export interface ProjectCommit extends DevelopmentRecord {
  progressDelta: number
}

export interface GitSyncSummary {
  status: 'never' | 'syncing' | 'synced' | 'failed' | 'unavailable'
  branch: string
  headSha: string
  commitCount: number
  lastScannedAt: number | null
  error: string
  failureCount?: number
  nextRetryAt?: number | null
  backfillProcessed?: number
  backfillTotal?: number
  backfillProgress?: number
  backfillResumable?: boolean
  historyLimit?: number
  historyTruncated?: boolean
}

export interface GitSyncStateEvent {
  projectId: string
  reason: 'manual' | 'scheduled'
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

export interface LaunchCapability {
  profileId: string
  validated: boolean
  canOpen: boolean
}

export interface ProjectAssetWarning {
  kind: 'cover' | 'record-image'
  path: string
  recordId: string | null
  recordTitle: string | null
}

export interface NoteBlock {
  id: string
  projectId: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface Todo {
  id: string
  projectId: string
  content: string
  completed: number
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  path: string
  repoUrl: string
  status: string
  statusInfo?: ProjectStatus
  phase?: string
  milestone?: string
  nextStep?: string
  canonicalPath?: string | null
  coverImagePath: string
  resolvedCoverImagePath?: string
  recentRecord?: DevelopmentRecord
  /** @deprecated Renderer v1 compatibility alias for recentRecord. */
  recentCommit?: DevelopmentRecord
  recordCount?: number
  /** @deprecated Renderer v1 compatibility alias for recordCount. */
  commitCount?: number
  draftCount?: number
  openTodoCount?: number
  gitSync?: GitSyncSummary
  launchCapability?: LaunchCapability | null
  assetWarnings?: ProjectAssetWarning[]
  createdAt: number
  updatedAt: number
  tags?: Tag[]
  noteblocks?: NoteBlock[]
  todos?: Todo[]
  records?: DevelopmentRecord[]
  /** @deprecated Renderer v1 compatibility alias for records. */
  commits?: DevelopmentRecord[]
}

export interface GitCommitFact {
  sha: string
  parentShas: string[]
  authorName: string
  authorEmail: string
  authoredAt: number
  subject: string
  body: string
  fileNames: string[]
  stats: { added: number; deleted: number; files: number }
  disposition?: 'pending' | 'handled' | 'ignored'
  seenAt?: number | null
  activeRecord?: {
    recordId: string
    title: string
    source: 'manual' | 'ai'
    reviewStatus: 'draft' | 'accepted'
  } | null
}

export interface LaunchCandidate {
  name: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  readyUrl: string
  readyPort: number | null
  reason: string
}

export interface ProjectInspection {
  selectedPath: string
  canonicalPath: string
  isGitRepository: boolean
  gitAvailable: boolean
  repositoryRoot: string
  projectName: string
  branch: string
  headSha: string
  detached: boolean
  emptyRepository: boolean
  commitCount: number
  recentCommits: GitCommitFact[]
  remoteUrl: string
  techStack: string[]
  readmeSummary: string
  launchCandidates: LaunchCandidate[]
  assetCandidates: string[]
  warnings: string[]
}

export interface LaunchProfile {
  id: string
  projectId: string
  name: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  readyUrl: string
  readyPort: number | null
  enabled: boolean
  validated: boolean
  confirmedHash: string
  createdAt: number
  updatedAt: number
}

export type LaunchStateName = 'starting' | 'running' | 'ready' | 'failed' | 'stopped'

export interface LaunchRuntimeState {
  profileId: string
  projectId: string
  state: LaunchStateName
  pid: number | null
  startedAt: number | null
  stoppedAt: number | null
  error: string
  logs: Array<{ stream: 'stdout' | 'stderr' | 'system'; text: string; timestamp: number }>
}

export interface PublicAppSettings {
  screenshotsDirectory: string
  llm: {
    baseUrl: string
    model: string
    hasApiKey: boolean
    defaultLanguage: string
    logGranularity: 'minimal' | 'normal' | 'detailed'
    toneMode: 'historical' | 'standardized'
    excludedPaths: string[]
    customRules: string[]
  }
}

export interface ScreenshotDirectoryMigrationResult {
  screenshotsDirectory: string
  moved: number
  cleanupFailures: Array<{ path: string; reason: string }>
}

export interface TaskProgress {
  id: string
  kind: string
  projectId: string
  generationRunId?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  detail: string
  progress?: number
  canRetry: boolean
  canCancel?: boolean
  createdAt: number
  updatedAt: number
}

export interface AiInputPreviewOptions {
  cursor?: string
  limit?: number
  authoredAfter?: number
  authoredBefore?: number
}

export interface AiInputPreview {
  commits: GitCommitFact[]
  shas: string[]
  files: string[]
  assetCandidates: string[]
  totalStats: { added: number; deleted: number; files: number }
  nextCursor: string | null
  totalPending: number
  oldestAuthoredAt: number | null
  newestAuthoredAt: number | null
}

export interface VibeApi {
  apiVersion: 1
  app: {
    getVersion(): Promise<AppVersionInfo>
    checkForUpdates(): Promise<UpdateCommandResult>
    downloadUpdate(): Promise<UpdateCommandResult>
    quitAndInstallUpdate(): Promise<UpdateCommandResult>
    onUpdateMessage(listener: (payload: UpdateMessagePayload) => void): () => void
  }
  projects: {
    list(): Promise<Project[]>
    get(projectId: string): Promise<Project | null>
    update(projectId: string, input: unknown): Promise<Project>
    chooseDirectory(): Promise<ProjectInspection | null>
    inspectDirectory(selectedPath: string): Promise<ProjectInspection>
    relink(projectId: string, selectedPath: string): Promise<{
      inspection: ProjectInspection
      syncResult: { inserted: number; scanned: number; headSha: string; cursorWasReset: boolean; invalidatedLaunchProfiles: number } | null
      syncError: string
      invalidatedLaunchProfiles: number
      assetWarnings: ProjectAssetWarning[]
    }>
    import(input: unknown): Promise<{
      projectId: string
      inspection: ProjectInspection
      syncResult: { inserted: number; scanned: number; headSha: string; cursorWasReset: boolean } | null
      syncError: string
    }>
    createEmpty(input: unknown): Promise<string>
    delete(projectId: string): Promise<{ deleted: boolean; assetFailures: unknown[] }>
    openDirectory(projectId: string): Promise<{ ok: boolean; reason?: string }>
    openRemote(projectId: string): Promise<{ ok: boolean; reason?: string }>
  }
  dashboard: { get(): Promise<DashboardSummary> }
  taxonomy: {
    listStatuses(): Promise<ProjectStatus[]>
    createStatus(input: unknown): Promise<string>
    updateStatus(statusId: string, input: unknown): Promise<boolean>
    deleteStatus(statusId: string): Promise<{ ok: boolean; reason?: string }>
    reorderStatuses(orderedIds: string[]): Promise<boolean>
    listTags(): Promise<Tag[]>
    createTag(input: unknown): Promise<string>
    updateTag(tagId: string, input: unknown): Promise<boolean>
    deleteTag(tagId: string): Promise<boolean>
  }
  git: {
    sync(projectId: string): Promise<{ inserted: number; scanned: number; headSha: string; cursorWasReset: boolean }>
    list(projectId: string, options?: unknown): Promise<{ items: GitCommitFact[]; nextCursor: string | null }>
    markSeen(projectId: string, shas: string[]): Promise<number>
    setDisposition(projectId: string, sha: string, disposition: 'pending' | 'handled' | 'ignored'): Promise<{ projectId: string; sha: string; disposition: 'pending' | 'handled' | 'ignored'; seenAt: number }>
    onState(listener: (state: GitSyncStateEvent) => void): () => void
  }
  records: {
    list(projectId: string, options?: unknown): Promise<{ items: DevelopmentRecord[]; nextCursor: string | null }>
    create(input: unknown): Promise<string>
    update(recordId: string, input: unknown): Promise<boolean>
    delete(recordId: string): Promise<{ deleted: boolean; assetFailures: unknown[] }>
    drafts(projectId: string): Promise<DevelopmentRecord[]>
    review(recordId: string, input: unknown): Promise<boolean>
    addImage(recordId: string, input: { imagePath: string; caption?: string }): Promise<CommitImage>
    updateImage(recordId: string, imageId: string, input: { caption: string }): Promise<CommitImage>
    reorderImages(recordId: string, orderedIds: string[]): Promise<CommitImage[]>
    deleteImage(recordId: string, imageId: string): Promise<{
      deleted: boolean
      assetFailures: Array<{ path: string; reason: string }>
    }>
  }
  notes: {
    create(projectId: string, content: string): Promise<string>
    update(noteId: string, content: string): Promise<boolean>
    delete(noteId: string): Promise<boolean>
  }
  todos: {
    create(projectId: string, content: string): Promise<string>
    update(todoId: string, input: unknown): Promise<boolean>
    delete(todoId: string): Promise<boolean>
  }
  settings: {
    get(): Promise<PublicAppSettings>
    update(input: unknown): Promise<PublicAppSettings>
    chooseScreenshotsDirectory(): Promise<ScreenshotDirectoryMigrationResult | null>
    resetScreenshotsDirectory(): Promise<ScreenshotDirectoryMigrationResult>
    testLlm(input?: { providerId?: string; baseUrl: string; model: string; apiKey?: string }): Promise<{
      ok: boolean
      model: string
      responseType: 'models' | 'compatible' | 'chat'
    }>
  }
  ai: {
    preview(projectId: string, options?: AiInputPreviewOptions): Promise<AiInputPreview>
    getRules(projectId: string): Promise<AiRules>
    listRules(projectId: string): Promise<AiRules[]>
    saveRules(projectId: string, input: unknown): Promise<{ id: string; version: number }>
    applyProjectSuggestion(projectId: string, input: {
      generationRunId: string
      name: string
      description: string
      phase: string
      tagNames: string[]
    }): Promise<{
      projectId: string
      generationRunId: string
      applicationId: string
      inputShas: string[]
      appliedTagIds: string[]
      createdTags: Tag[]
    }>
    generateDrafts(projectId: string, shas: string[], options?: { replaceDraftIds?: string[] }): Promise<AiGenerationResult>
    listRuns(projectId: string): Promise<AiGenerationRunSummary[]>
    getRun(projectId: string, generationRunId: string): Promise<AiGenerationRunDetail>
    retryRun(projectId: string, generationRunId: string): Promise<AiGenerationResult>
  }
  launch: {
    list(projectId: string): Promise<LaunchProfile[]>
    save(input: unknown): Promise<LaunchProfile>
    confirm(profileId: string): Promise<LaunchProfile>
    delete(profileId: string): Promise<boolean>
    start(profileId: string): Promise<LaunchRuntimeState>
    stop(profileId: string): Promise<LaunchRuntimeState | null>
    status(profileId: string): Promise<LaunchRuntimeState | null>
    open(profileId: string): Promise<boolean>
    onState(listener: (state: LaunchRuntimeState) => void): () => void
  }
  assets: {
    saveImage(dataUrl: string, fileName: string): Promise<string>
    chooseImages(multiple?: boolean): Promise<string | string[] | null>
  }
  tasks: {
    list(): Promise<TaskProgress[]>
    onProgress(listener: (task: TaskProgress) => void): () => void
    cancel(taskId: string): Promise<boolean>
    retry(taskId: string): Promise<boolean>
  }
}

export interface AiRules {
  id?: string
  version: number
  language: string
  toneMode: 'historical' | 'standardized'
  summaryGuidance: string
  recordGuidance: string
  exclusions: string[]
  customRules: string[]
  suggestedFromHistory?: boolean
}

export interface AiGeneratedPayload {
  project: {
    name: string; description: string; techStack: string[]; tags: string[]; phase: string;
    phaseReason: string; confidence: number; evidence: string[]
  }
  records: Array<{ title: string; description: string; gitShas: string[]; confidence: number; evidence: string[] }>
  assetNotes: Array<{ path: string; note: string }>
}

export interface AiGenerationResult {
  payload: AiGeneratedPayload
  metadata: { provider: string; model: string; promptVersion: string; inputHash: string }
  draftIds: string[]
  generationRunId: string
  drafts: DevelopmentRecord[]
}

export type AiGenerationRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface AiGenerationRunSummary {
  id: string
  projectId: string
  provider: string
  model: string
  promptVersion: string
  inputHash: string
  inputShas: string[]
  status: AiGenerationRunStatus
  rulesVersion: number
  error: string
  createdAt: number
  updatedAt: number
  completedAt: number | null
  draftCount: number
  acceptedCount: number
  rejectedCount: number
  suggestionApplicationCount: number
}

export interface AiProjectSuggestionApplication {
  id: string
  projectId: string
  generationRunId: string
  inputShas: string[]
  before: Record<string, unknown>
  applied: Record<string, unknown>
  createdAt: number
}

export interface AiGenerationRunDetail extends AiGenerationRunSummary {
  output: AiGeneratedPayload
  rulesSnapshot: Partial<AiRules>
  settingsSnapshot: Partial<Omit<PublicAppSettings['llm'], 'hasApiKey'>>
  inputSnapshot: {
    project?: { name?: string; description?: string; phase?: string; milestone?: string; nextStep?: string }
    history?: Array<{ title: string; description: string }>
    commits?: GitCommitFact[]
    assetCandidates?: string[]
    knownTags?: string[]
    rules?: Partial<AiRules>
  }
  replaceDraftIds: string[]
  projectSuggestionApplications: AiProjectSuggestionApplication[]
  drafts: DevelopmentRecord[]
}

export interface DashboardSummary {
  counts: { projects: number; pendingGit: number; pendingDrafts: number; openTodos: number; launchable: number }
  recentGit: Array<{ projectId: string; projectName: string; sha: string; subject: string; authoredAt: number; disposition: 'pending'; seenAt: number | null }>
  pendingReview: Project[]
  recentProjects: Project[]
  launchableProjects: Project[]
  failures: Project[]
  openTodos: Array<{ id: string; projectId: string; projectName: string; content: string; createdAt: number }>
  launchFailures: Array<{ projectId: string; profileId: string; error: string }>
}

export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'error'
  | 'downloading'
  | 'downloaded'
  | 'portable'
  | 'dev'

export interface UpdateMessagePayload {
  status: UpdateStatus
  version?: string
  percent?: number
  error?: string
  isPortable?: boolean
}

export interface AppVersionInfo {
  version: string
  isPackaged: boolean
  isPortable: boolean
}

export interface UpdateCommandResult {
  success: boolean
  status?: UpdateStatus
  error?: string
  isPortable?: boolean
  updateInfo?: unknown
}

declare global {
  interface Window {
    vibe: VibeApi
  }
}
