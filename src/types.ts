export interface Tag {
  id: string
  name: string
  color: string
  createdAt: number
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
  status: 'developing' | 'completed' | 'paused'
  progress: number
  createdAt: number
  updatedAt: number
  tags?: Tag[]
  noteblocks?: NoteBlock[]
  todos?: Todo[]
}

export interface IpcRenderer {
  invoke(channel: 'get-projects'): Promise<Project[]>
  invoke(channel: 'get-project', id: string): Promise<Project | null>
  invoke(channel: 'create-project', data: Partial<Project> & { tagIds?: string[] }): Promise<string>
  invoke(channel: 'update-project', id: string, data: Partial<Project> & { tagIds?: string[] }): Promise<boolean>
  invoke(channel: 'delete-project', id: string): Promise<boolean>
  
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
