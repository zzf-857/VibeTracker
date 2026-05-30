import { ipcRenderer, contextBridge } from 'electron'

// 允许渲染进程调用的 IPC 通道白名单
const ALLOWED_INVOKE_CHANNELS = [
  'get-projects',
  'get-project',
  'create-project',
  'update-project',
  'delete-project',
  'get-statuses',
  'create-status',
  'update-status',
  'delete-status',
  'reorder-statuses',
  'select-image',
  'open-local-path',
  'open-external-url',
  'read-image-data-url',
  'get-commits',
  'create-commit',
  'update-commit',
  'delete-commit',
  'add-commit-image',
  'delete-commit-image',
  'get-tags',
  'create-tag',
  'update-tag',
  'delete-tag',
  'create-noteblock',
  'update-noteblock',
  'delete-noteblock',
  'create-todo',
  'update-todo',
  'delete-todo',
] as const

const ALLOWED_ON_CHANNELS = [
  'main-process-message',
] as const

function isAllowedInvoke(channel: string): boolean {
  return (ALLOWED_INVOKE_CHANNELS as readonly string[]).includes(channel)
}

function isAllowedOn(channel: string): boolean {
  return (ALLOWED_ON_CHANNELS as readonly string[]).includes(channel)
}

// --------- Expose safe API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (...args: any[]) => void) {
    if (!isAllowedOn(channel)) {
      console.warn(`[preload] 拦截了未授权的 on 通道: ${channel}`)
      return
    }
    return ipcRenderer.on(channel, (_event, ...args) => listener(...args))
  },
  off(channel: string, listener: (...args: any[]) => void) {
    if (!isAllowedOn(channel)) return
    return ipcRenderer.off(channel, listener)
  },
  send(channel: string, ...args: any[]) {
    if (!isAllowedOn(channel)) {
      console.warn(`[preload] 拦截了未授权的 send 通道: ${channel}`)
      return
    }
    return ipcRenderer.send(channel, ...args)
  },
  invoke(channel: string, ...args: any[]) {
    if (!isAllowedInvoke(channel)) {
      return Promise.reject(new Error(`未授权的 IPC 通道: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
})
