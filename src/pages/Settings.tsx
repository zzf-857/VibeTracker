import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, GripVertical, Palette, Plus, Save, Trash2, X } from 'lucide-react'
import { AnimatedPage } from '../components/AnimatedPage'
import { ProjectStatus } from '../types'
import { validateStatusName } from '../lib/statusValidation'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'


const COLORS = ['#74A9FF', '#63D693', '#F3BB6C', '#B8A6FF', '#A8B0BD', '#FF6B6B']

function SettingsSkeleton() {
  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8 animate-pulse">
      {/* 头部 */}
      <div>
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-9 w-32 rounded-lg mt-2" />
        <Skeleton className="h-4.5 w-64 rounded mt-2" />
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-6">
        {/* 左侧状态列表骨架 */}
        <div className="glass-panel rounded-[32px] p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <Skeleton className="h-6 w-24 rounded" />
              <Skeleton className="h-4 w-64 rounded" />
            </div>
            <Skeleton className="w-5 h-5 rounded-full" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-bg-secondary border border-border-subtle rounded-[24px] p-4 flex items-center gap-4">
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="w-3 h-3 rounded-full" />
                <Skeleton className="h-5 w-32 rounded flex-1" />
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="w-8 h-8 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        {/* 右侧创建状态骨架 */}
        <div className="glass-panel rounded-[32px] p-6 space-y-6">
          <Skeleton className="h-6 w-32 rounded" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-full rounded-2xl" />
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} className="w-6 h-6 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-10 w-full rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Settings() {
  const { statuses: storeStatuses, isLoaded, refresh } = useStore()
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [notice, setNotice] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [draggedStatusId, setDraggedStatusId] = useState<string | null>(null)
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const statusesRef = useRef<ProjectStatus[]>([])
  const dragStartOrderRef = useRef<ProjectStatus[]>([])

  useEffect(() => {
    if (isLoaded) {
      setStatuses(storeStatuses)
      setIsLoading(false)
    } else {
      refresh()
    }
  }, [isLoaded, storeStatuses, refresh])

  useEffect(() => {
    statusesRef.current = statuses
  }, [statuses])

  const createStatus = async () => {
    const validation = validateStatusName(newName, statuses)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    await window.ipcRenderer.invoke('create-status', { name: validation.value, color: newColor })
    setNewName('')
    setNotice('状态已创建')
    await refresh()
  }

  const updateStatus = async (id: string, data: Partial<ProjectStatus>) => {
    const validation = validateStatusName(data.name || '', statuses, id)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    await window.ipcRenderer.invoke('update-status', id, { ...data, name: validation.value })
    setNotice('状态已保存')
    await refresh()
  }

  const requestDeleteStatus = (status: ProjectStatus) => {
    if (statuses.length <= 1) {
      setNotice('至少需要保留一个状态')
      return
    }
    if ((status.projectCount || 0) > 0) {
      setNotice(`「${status.name}」仍有项目正在使用，先把这些项目切换到其他状态。`)
      return
    }
    setNotice('')
    setPendingDeleteId(status.id)
  }

  const deleteStatus = async (status: ProjectStatus) => {
    const result = await window.ipcRenderer.invoke('delete-status', status.id)
    if (!result.ok) {
      setNotice(result.reason || '无法删除状态')
      return
    }
    setPendingDeleteId(null)
    setNotice('状态已删除')
    await refresh()
  }

  const moveStatus = async (id: string, direction: -1 | 1) => {
    const index = statuses.findIndex(status => status.id === id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= statuses.length) return
    const next = [...statuses]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    await window.ipcRenderer.invoke('reorder-statuses', next.map(status => status.id))
    setNotice('状态顺序已更新')
    await refresh()
  }

  const previewDraggedStatus = (dragId: string, targetId: string) => {
    if (dragId === targetId) return
    setStatuses(prev => {
      const from = prev.findIndex(status => status.id === dragId)
      const to = prev.findIndex(status => status.id === targetId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const finishDragSort = async (dragId = draggedStatusId) => {
    if (!dragId) return
    const previous = dragStartOrderRef.current
    const next = statusesRef.current
    const previousIds = previous.map(status => status.id).join(',')
    const nextIds = next.map(status => status.id).join(',')

    setDraggedStatusId(null)
    setDragOverStatusId(null)

    if (!previous.length || previousIds === nextIds) return

    setIsSavingOrder(true)
    try {
      await window.ipcRenderer.invoke('reorder-statuses', next.map(status => status.id))
      setNotice('状态顺序已更新')
      await refresh()
    } catch {
      setStatuses(previous)
      setNotice('状态顺序保存失败，已恢复原顺序')
    } finally {
      setIsSavingOrder(false)
      dragStartOrderRef.current = []
    }
  }

  if (isLoading) {
    return <SettingsSkeleton />
  }

  return (
    <AnimatedPage tone="system" className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div className="stagger-item" style={{ '--stagger': 0 } as CSSProperties}>
        <p className="text-text-tertiary text-sm mb-2">Preferences</p>
        <h1 className="text-[34px] font-semibold tracking-normal">设置</h1>
        <p className="text-text-secondary text-sm mt-2">先把状态系统调顺，它会直接影响项目画廊和进展详情。</p>
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-6">
        <section className="glass-panel ambient-panel rounded-[32px] p-6 stagger-item" style={{ '--stagger': 1 } as CSSProperties}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">项目状态</h2>
              <p className="text-sm text-text-tertiary mt-1">状态名称、颜色和顺序会同步显示在项目卡片与详情页。</p>
            </div>
            <Palette size={20} className="text-text-tertiary" />
          </div>

          {notice && (
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-text-secondary">
              {notice}
            </div>
          )}

          <div className="space-y-3">
            {statuses.map((status, index) => (
              <div
                key={status.id}
                onDragOver={e => {
                  if (!draggedStatusId || draggedStatusId === status.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverStatusId(status.id)
                  previewDraggedStatus(draggedStatusId, status.id)
                }}
                onDrop={e => {
                  e.preventDefault()
                  finishDragSort()
                }}
                className={`status-row motion-card bg-bg-secondary border border-border-subtle rounded-[24px] p-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-4 items-center ${draggedStatusId === status.id ? 'status-row-dragging' : ''} ${dragOverStatusId === status.id ? 'status-row-drag-over' : ''}`}
              >
                <button
                  type="button"
                  draggable={!isSavingOrder}
                  title="拖动排序"
                  aria-label={`拖动排序 ${status.name}`}
                  onDragStart={e => {
                    if (isSavingOrder) return
                    dragStartOrderRef.current = statuses
                    setDraggedStatusId(status.id)
                    setPendingDeleteId(null)
                    setNotice('')
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', status.id)
                  }}
                  onDragEnd={() => finishDragSort(status.id)}
                  className="status-drag-handle motion-action h-9 w-8 rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/10 flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <GripVertical size={16} />
                </button>
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0 breathing-dot" style={{ backgroundColor: status.color }} />
                  <input
                    value={status.name}
                    onChange={e => {
                      setNotice('')
                      setPendingDeleteId(null)
                      setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, name: e.target.value } : item))
                    }}
                    className="motion-focus bg-transparent text-sm outline-none w-full min-w-0"
                  />
                  <span className="text-xs text-text-tertiary whitespace-nowrap">{status.projectCount || 0} 项目</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`选择状态色 ${color}`}
                      onClick={() => {
                        setNotice('')
                        setPendingDeleteId(null)
                        setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, color } : item))
                      }}
                      className={`motion-action h-7 w-7 rounded-full border transition ${status.color === color ? 'border-white/90 ring-2 ring-white/20' : 'border-white/10 hover:border-white/45'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <label className="motion-action relative h-7 w-7 rounded-full border border-white/10 bg-bg-tertiary cursor-pointer overflow-hidden hover:border-white/45" title="自定义颜色">
                    <input
                      type="color"
                      value={status.color}
                      onChange={e => setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, color: e.target.value } : item))}
                      className="motion-focus absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0"
                    />
                    <Palette size={13} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary" />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button type="button" title="上移" onClick={() => moveStatus(status.id, -1)} disabled={index === 0 || isSavingOrder} className="motion-action h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowUp size={15} /></button>
                  <button type="button" title="下移" onClick={() => moveStatus(status.id, 1)} disabled={index === statuses.length - 1 || isSavingOrder} className="motion-action h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowDown size={15} /></button>
                  <button type="button" title="保存" onClick={() => updateStatus(status.id, { name: status.name, color: status.color })} className="motion-action h-8 w-8 rounded-full text-text-tertiary hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><Save size={14} /></button>
                  <button type="button" title="删除" onClick={() => requestDeleteStatus(status)} className="motion-action h-8 w-8 rounded-full text-text-tertiary hover:bg-accent-red/10 hover:text-accent-red flex items-center justify-center"><Trash2 size={14} /></button>
                </div>
                {pendingDeleteId === status.id && (
                  <div className="col-span-4 rounded-2xl border border-accent-red/25 bg-accent-red/10 px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-text-secondary">确认删除「{status.name}」？这个操作不会影响其他状态。</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => deleteStatus(status)} className="motion-action h-8 px-3 rounded-full bg-accent-red text-white text-xs font-medium flex items-center gap-1.5"><Check size={13} /> 确认</button>
                      <button type="button" onClick={() => setPendingDeleteId(null)} className="motion-action h-8 px-3 rounded-full bg-white/10 text-text-secondary text-xs font-medium flex items-center gap-1.5"><X size={13} /> 取消</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel rounded-[32px] p-6 stagger-item" style={{ '--stagger': 2 } as CSSProperties}>
            <h2 className="text-lg font-semibold mb-4">新增状态</h2>
            <div className="space-y-3">
              <input value={newName} onChange={e => setNewName(e.target.value)} className="motion-focus w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" placeholder="状态名称" />
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(color => (
                  <button key={color} type="button" aria-label={`选择状态色 ${color}`} onClick={() => setNewColor(color)} className={`motion-action w-8 h-8 rounded-full border transition-transform ${newColor === color ? 'border-white scale-110' : 'border-white/10'}`} style={{ backgroundColor: color }} />
                ))}
                <label className="motion-action relative h-8 w-8 rounded-full border border-white/10 bg-bg-tertiary cursor-pointer overflow-hidden hover:border-white/45" title="自定义颜色">
                  <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="motion-focus absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
                  <Palette size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary" />
                </label>
              </div>
              <button onClick={createStatus} className="motion-action w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2">
                <Plus size={15} /> 创建状态
              </button>
            </div>
          </section>

          <section className="glass-panel rounded-[32px] p-6 border-accent-orange/30 stagger-item" style={{ '--stagger': 3 } as CSSProperties}>
            <div className="flex gap-3">
              <AlertTriangle size={18} className="text-accent-orange flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold mb-2">删除保护</h2>
                <p className="text-sm text-text-secondary leading-6">至少保留一个状态。正在被项目使用的状态不能直接删除，先把项目切换到其他状态。</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </AnimatedPage>
  )
}
