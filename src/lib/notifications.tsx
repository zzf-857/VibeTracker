import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, X } from 'lucide-react'
import type { TaskProgress } from '../types'

interface ToastItem {
  id: string
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

interface NotificationsContextValue {
  notify: (toast: Omit<ToastItem, 'id'>) => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function mergeTaskHistory(current: TaskProgress[], incoming: TaskProgress[], limit = 50) {
  const byId = new Map(current.map(task => [task.id, task]))
  for (const task of incoming) {
    const existing = byId.get(task.id)
    if (!existing || task.updatedAt >= existing.updatedAt) byId.set(task.id, task)
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
    .slice(0, limit)
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [tasks, setTasks] = useState<TaskProgress[]>([])
  const [tasksOpen, setTasksOpen] = useState(false)

  const notify = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts(current => [...current.slice(-3), { ...toast, id }])
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), toast.tone === 'error' ? 8_000 : 4_000)
  }, [])

  useEffect(() => {
    let disposed = false
    const unsubscribe = window.vibe.tasks.onProgress(task => {
      setTasks(current => mergeTaskHistory(current, [task]))
      if (task.status === 'failed' || task.status === 'interrupted') {
        setTasksOpen(true)
        notify({ tone: 'error', title: task.status === 'interrupted' ? '后台任务已中断' : '后台任务失败', detail: task.detail })
      }
    })
    void window.vibe.tasks.list().then(history => {
      if (disposed) return
      setTasks(current => mergeTaskHistory(current, history))
      if (history.some(task => task.status === 'failed' || task.status === 'interrupted')) setTasksOpen(true)
    }).catch(error => {
      if (!disposed) notify({ tone: 'error', title: '后台任务历史加载失败', detail: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [notify])

  const value = useMemo(() => ({ notify }), [notify])
  const running = tasks.filter(task => task.status === 'running').length
  const retryTask = async (task: TaskProgress) => {
    try {
      if (task.kind === 'assets-migrate') {
        const retried = await window.vibe.tasks.retry(task.id)
        if (!retried) throw new Error('该迁移任务已失效，请在设置中重新选择截图目录')
      } else if (task.kind.startsWith('git')) await window.vibe.git.sync(task.projectId)
      else {
        if (task.generationRunId) await window.vibe.ai.retryRun(task.projectId, task.generationRunId)
        else {
          const preview = await window.vibe.ai.preview(task.projectId)
          if (!preview.shas.length) throw new Error('没有可重试的 Git 提交范围')
          await window.vibe.ai.generateDrafts(task.projectId, preview.shas)
        }
      }
    } catch (error) {
      notify({ tone: 'error', title: '重试失败', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div className="fixed right-6 top-6 z-[120] w-[min(380px,calc(100vw-48px))] space-y-2" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className="rounded-xl border border-border-subtle bg-bg-secondary/95 px-4 py-3 shadow-xl backdrop-blur-lg flex gap-3">
            {toast.tone === 'success' ? <CheckCircle2 size={18} className="text-status-completed mt-0.5" /> : toast.tone === 'error' ? <AlertCircle size={18} className="text-accent-red mt-0.5" /> : <Loader2 size={18} className="text-accent-blue mt-0.5" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{toast.title}</p>
              {toast.detail && <p className="text-xs text-text-secondary mt-1 break-words">{toast.detail}</p>}
            </div>
            <button aria-label="关闭通知" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))} className="text-text-tertiary hover:text-text-primary self-start"><X size={15} /></button>
          </div>
        ))}
      </div>
      {tasks.length > 0 && (
        <aside className="fixed bottom-5 right-5 z-40 w-[min(390px,calc(100vw-40px))] rounded-2xl border border-border-subtle bg-bg-secondary/95 shadow-2xl backdrop-blur-xl overflow-hidden">
          <button onClick={() => setTasksOpen(value => !value)} aria-expanded={tasksOpen} className="w-full h-12 px-4 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 size={15} className={running ? 'animate-spin text-accent-blue' : 'text-text-tertiary'} />后台任务 {running ? `· ${running} 进行中` : ''}</span>
            <ChevronDown size={15} className={tasksOpen ? 'rotate-180' : ''} />
          </button>
          {tasksOpen && (
            <div className="max-h-72 overflow-auto border-t border-border-subtle p-2 space-y-1">
              {tasks.map(task => (
                <div key={task.id} className="rounded-xl px-3 py-2 bg-bg-tertiary/60">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text-primary">{task.kind === 'assets-migrate' ? '截图目录迁移' : task.kind === 'git-sync-scheduled' ? '自动 Git 同步' : task.kind.startsWith('git') ? 'Git 同步' : 'AI 生成'}</span>
                    <span className={task.status === 'failed' || task.status === 'interrupted' ? 'text-accent-red' : task.status === 'completed' ? 'text-status-completed' : task.status === 'cancelled' ? 'text-text-tertiary' : 'text-accent-blue'}>{task.status === 'running' ? '进行中' : task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'interrupted' ? '已中断' : '已取消'}</span>
                  </div>
                  {task.detail && <p className="text-[11px] text-text-tertiary mt-1 break-words">{task.detail}</p>}
                  {task.progress !== undefined && <div className="h-1 mt-2 rounded-full bg-bg-primary overflow-hidden"><div className="h-full bg-accent-blue" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} /></div>}
                  {(task.status === 'running' || ((task.status === 'failed' || task.status === 'interrupted') && task.canRetry)) && <div className="flex justify-end mt-2">{task.status === 'running' ? <button onClick={() => void window.vibe.tasks.cancel(task.id)} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary">取消</button> : <button onClick={() => void retryTask(task)} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary">重试</button>}</div>}
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (!context) throw new Error('useNotifications must be used within NotificationsProvider')
  return context
}
