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
  commitId: string
  imagePath: string
  caption: string
  sortIndex: number
  createdAt: number
}

export interface ProjectCommit {
  id: string
  projectId: string
  title: string
  description: string
  progressDelta: number
  createdAt: number
  updatedAt: number
  images?: CommitImage[]
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
  status: string
  statusInfo?: ProjectStatus
  progress: number
  coverImagePath: string
  resolvedCoverImagePath?: string
  recentCommit?: ProjectCommit
  commitCount?: number
  createdAt: number
  updatedAt: number
  tags?: Tag[]
  noteblocks?: NoteBlock[]
  todos?: Todo[]
  commits?: ProjectCommit[]
}

export interface IpcRenderer {
  invoke(channel: 'get-projects'): Promise<Project[]>
  invoke(channel: 'get-project', id: string): Promise<Project | null>
  invoke(channel: 'create-project', data: Partial<Project> & { tagIds?: string[] }): Promise<string>
  invoke(channel: 'update-project', id: string, data: Partial<Project> & { tagIds?: string[] }): Promise<boolean>
  invoke(channel: 'delete-project', id: string): Promise<boolean>

  invoke(channel: 'get-statuses'): Promise<ProjectStatus[]>
  invoke(channel: 'create-status', data: { name: string; color: string }): Promise<string>
  invoke(channel: 'update-status', id: string, data: Partial<Pick<ProjectStatus, 'name' | 'color' | 'sortIndex'>>): Promise<boolean>
  invoke(channel: 'delete-status', id: string): Promise<{ ok: boolean; reason?: string }>
  invoke(channel: 'reorder-statuses', orderedIds: string[]): Promise<boolean>
  invoke(channel: 'select-image'): Promise<string | null>
  invoke(channel: 'read-image-data-url', imagePath: string): Promise<string | null>

  invoke(channel: 'get-commits', projectId: string): Promise<ProjectCommit[]>
  invoke(channel: 'create-commit', data: { projectId: string; title: string; description?: string; progressDelta?: number; imagePath?: string }): Promise<string>
  invoke(channel: 'update-commit', id: string, data: Partial<Pick<ProjectCommit, 'title' | 'description' | 'progressDelta'>>): Promise<boolean>
  invoke(channel: 'delete-commit', id: string): Promise<boolean>
  invoke(channel: 'add-commit-image', commitId: string, imagePath: string, caption?: string): Promise<string>
  invoke(channel: 'delete-commit-image', id: string): Promise<boolean>
  
  invoke(channel: 'get-tags'): Promise<Tag[]>
  invoke(channel: 'create-tag', data: { name: string; color: string }): Promise<string>
  invoke(channel: 'update-tag', id: string, data: { name: string; color: string }): Promise<boolean>
  invoke(channel: 'delete-tag', id: string): Promise<boolean>
  
  invoke(channel: 'create-noteblock', projectId: string, content: string): Promise<string>
  invoke(channel: 'update-noteblock', id: string, content: string): Promise<boolean>
  invoke(channel: 'delete-noteblock', id: string): Promise<boolean>
  
  invoke(channel: 'create-todo', projectId: string, content: string): Promise<string>
  invoke(channel: 'update-todo', id: string, data: Partial<Todo>): Promise<boolean>
  invoke(channel: 'delete-todo', id: string): Promise<boolean>
  
  on(channel: string, listener: (...args: any[]) => void): void
  off(channel: string, ...omit: any[]): void
  send(channel: string, ...args: any[]): void
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer
  }
}
