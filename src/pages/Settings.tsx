import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Palette, Plus, Save, Trash2, X } from 'lucide-react'
import { ProjectStatus } from '../types'
import { validateStatusName } from '../lib/statusValidation'

const COLORS = ['#74A9FF', '#63D693', '#F3BB6C', '#B8A6FF', '#A8B0BD', '#FF6B6B']

export function Settings() {
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [notice, setNotice] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    loadStatuses()
  }, [])

  const loadStatuses = async () => {
    setStatuses(await window.ipcRenderer.invoke('get-statuses'))
  }

  const createStatus = async () => {
    const validation = validateStatusName(newName, statuses)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    await window.ipcRenderer.invoke('create-status', { name: validation.value, color: newColor })
    setNewName('')
    setNotice('状态已创建')
    loadStatuses()
  }

  const updateStatus = async (id: string, data: Partial<ProjectStatus>) => {
    const validation = validateStatusName(data.name || '', statuses, id)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    await window.ipcRenderer.invoke('update-status', id, { ...data, name: validation.value })
    setNotice('状态已保存')
    loadStatuses()
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
    loadStatuses()
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
    loadStatuses()
  }

  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div>
        <p className="text-text-tertiary text-sm mb-2">Preferences</p>
        <h1 className="text-[34px] font-semibold tracking-normal">设置</h1>
        <p className="text-text-secondary text-sm mt-2">先把状态系统调顺，它会直接影响项目画廊和进展详情。</p>
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-6">
        <section className="glass-panel rounded-[32px] p-6">
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
              <div key={status.id} className="bg-bg-secondary border border-border-subtle rounded-[24px] p-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
                  <input
                    value={status.name}
                    onChange={e => {
                      setNotice('')
                      setPendingDeleteId(null)
                      setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, name: e.target.value } : item))
                    }}
                    className="bg-transparent text-sm outline-none w-full min-w-0"
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
                      className={`h-7 w-7 rounded-full border transition ${status.color === color ? 'border-white/90 ring-2 ring-white/20' : 'border-white/10 hover:border-white/45'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <label className="relative h-7 w-7 rounded-full border border-white/10 bg-bg-tertiary cursor-pointer overflow-hidden hover:border-white/45" title="自定义颜色">
                    <input
                      type="color"
                      value={status.color}
                      onChange={e => setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, color: e.target.value } : item))}
                      className="absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0"
                    />
                    <Palette size={13} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary" />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button type="button" title="上移" onClick={() => moveStatus(status.id, -1)} disabled={index === 0} className="h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowUp size={15} /></button>
                  <button type="button" title="下移" onClick={() => moveStatus(status.id, 1)} disabled={index === statuses.length - 1} className="h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowDown size={15} /></button>
                  <button type="button" title="保存" onClick={() => updateStatus(status.id, { name: status.name, color: status.color })} className="h-8 w-8 rounded-full text-text-tertiary hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><Save size={14} /></button>
                  <button type="button" title="删除" onClick={() => requestDeleteStatus(status)} className="h-8 w-8 rounded-full text-text-tertiary hover:bg-accent-red/10 hover:text-accent-red flex items-center justify-center"><Trash2 size={14} /></button>
                </div>
                {pendingDeleteId === status.id && (
                  <div className="col-span-3 rounded-2xl border border-accent-red/25 bg-accent-red/10 px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-text-secondary">确认删除「{status.name}」？这个操作不会影响其他状态。</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => deleteStatus(status)} className="h-8 px-3 rounded-full bg-accent-red text-white text-xs font-medium flex items-center gap-1.5"><Check size={13} /> 确认</button>
                      <button type="button" onClick={() => setPendingDeleteId(null)} className="h-8 px-3 rounded-full bg-white/10 text-text-secondary text-xs font-medium flex items-center gap-1.5"><X size={13} /> 取消</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel rounded-[32px] p-6">
            <h2 className="text-lg font-semibold mb-4">新增状态</h2>
            <div className="space-y-3">
              <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" placeholder="状态名称" />
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(color => (
                  <button key={color} type="button" aria-label={`选择状态色 ${color}`} onClick={() => setNewColor(color)} className={`w-8 h-8 rounded-full border transition-transform ${newColor === color ? 'border-white scale-110' : 'border-white/10'}`} style={{ backgroundColor: color }} />
                ))}
                <label className="relative h-8 w-8 rounded-full border border-white/10 bg-bg-tertiary cursor-pointer overflow-hidden hover:border-white/45" title="自定义颜色">
                  <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
                  <Palette size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary" />
                </label>
              </div>
              <button onClick={createStatus} className="w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2">
                <Plus size={15} /> 创建状态
              </button>
            </div>
          </section>

          <section className="glass-panel rounded-[32px] p-6 border-accent-orange/30">
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
    </div>
  )
}
