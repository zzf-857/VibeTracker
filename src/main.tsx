import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

if (!window.ipcRenderer) {
  const fallbackStatuses = [
    { id: 'status-developing', name: '开发中', color: '#74A9FF', sortIndex: 0, createdAt: Date.now(), updatedAt: Date.now(), projectCount: 0 },
    { id: 'status-completed', name: '完成', color: '#63D693', sortIndex: 1, createdAt: Date.now(), updatedAt: Date.now(), projectCount: 0 },
  ]

  window.ipcRenderer = {
    async invoke(channel: string) {
      if (channel === 'get-statuses') return fallbackStatuses
      if (channel === 'create-project') return crypto.randomUUID()
      if (channel === 'delete-status') return { ok: false, reason: '浏览器预览不可删除状态' }
      if (channel === 'select-image') return null
      return []
    },
    on() {},
    off() {},
    send() {},
  } as typeof window.ipcRenderer
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
