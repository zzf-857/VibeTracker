import { useEffect, useState } from 'react'
import { AlertTriangle, Palette, Plus, Save, Trash2 } from 'lucide-react'
import { ProjectStatus } from '../types'

const COLORS = ['#74A9FF', '#63D693', '#F3BB6C', '#B8A6FF', '#A8B0BD', '#FF6B6B']

export function Settings() {
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])

  useEffect(() => {
    loadStatuses()
  }, [])

  const loadStatuses = async () => {
    setStatuses(await window.ipcRenderer.invoke('get-statuses'))
  }

  const createStatus = async () => {
    if (!newName.trim()) return
    await window.ipcRenderer.invoke('create-status', { name: newName.trim(), color: newColor })
    setNewName('')
    loadStatuses()
  }

  const updateStatus = async (id: string, data: Partial<ProjectStatus>) => {
    await window.ipcRenderer.invoke('update-status', id, data)
    loadStatuses()
  }

  const deleteStatus = async (status: ProjectStatus) => {
    const result = await window.ipcRenderer.invoke('delete-status', status.id)
    if (!result.ok) {
      alert(result.reason || '无法删除状态')
      return
    }
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

          <div className="space-y-3">
            {statuses.map((status, index) => (
              <div key={status.id} className="bg-bg-secondary border border-border-subtle rounded-[24px] p-4 grid grid-cols-[1fr_130px_120px] gap-3 items-center">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
                  <input
                    value={status.name}
                    onChange={e => setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, name: e.target.value } : item))}
                    className="bg-transparent text-sm outline-none w-full"
                  />
                  <span className="text-xs text-text-tertiary whitespace-nowrap">{status.projectCount || 0} 项目</span>
                </div>
                <select
                  value={status.color}
                  onChange={e => setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, color: e.target.value } : item))}
                  className="bg-bg-tertiary border border-border-subtle rounded-full px-3 py-2 text-xs outline-none"
                >
                  {COLORS.map(color => <option key={color} value={color}>{color}</option>)}
                </select>
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => moveStatus(status.id, -1)} disabled={index === 0} className="px-2 py-1 text-xs text-text-tertiary disabled:opacity-30 hover:text-text-primary">上移</button>
                  <button onClick={() => moveStatus(status.id, 1)} disabled={index === statuses.length - 1} className="px-2 py-1 text-xs text-text-tertiary disabled:opacity-30 hover:text-text-primary">下移</button>
                  <button onClick={() => updateStatus(status.id, { name: status.name, color: status.color })} className="p-2 text-text-tertiary hover:text-text-primary"><Save size={14} /></button>
                  <button onClick={() => deleteStatus(status)} className="p-2 text-text-tertiary hover:text-accent-red"><Trash2 size={14} /></button>
                </div>
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
                  <button key={color} onClick={() => setNewColor(color)} className={`w-8 h-8 rounded-full border transition-transform ${newColor === color ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: color }} />
                ))}
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
