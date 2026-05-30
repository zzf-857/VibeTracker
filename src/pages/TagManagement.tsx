import { type CSSProperties, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tag, Project } from '../types'
import { Tags, FolderKanban, Plus, Trash2, Edit2, Check, X } from 'lucide-react'
import { AnimatedPage } from '../components/AnimatedPage'

// Define some standard colors for selection
const COLORS = [
  '#F85149', // red
  '#FF9429', // orange
  '#3FB950', // green
  '#58A6FF', // blue
  '#BC8CFF', // purple
  '#8B949E'  // gray
]

export function TagManagement() {
  const navigate = useNavigate()
  const [tags, setTags] = useState<Tag[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(COLORS[3])
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const t = await window.ipcRenderer.invoke('get-tags')
    const p = await window.ipcRenderer.invoke('get-projects')
    setTags(t)
    setProjects(p)
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    await window.ipcRenderer.invoke('create-tag', { name: newTagName.trim(), color: newTagColor })
    setNewTagName('')
    loadData()
  }

  const handleDeleteTag = async (id: string) => {
    if (confirm('确认删除该标签吗？')) {
      await window.ipcRenderer.invoke('delete-tag', id)
      loadData()
    }
  }

  const startEditing = (tag: Tag) => {
    setEditingTagId(tag.id)
    setEditTagName(tag.name)
    setEditTagColor(tag.color)
  }

  const cancelEditing = () => {
    setEditingTagId(null)
    setEditTagName('')
    setEditTagColor('')
  }

  const saveEditing = async () => {
    if (!editingTagId || !editTagName.trim()) return
    await window.ipcRenderer.invoke('update-tag', editingTagId, { name: editTagName.trim(), color: editTagColor })
    setEditingTagId(null)
    loadData()
  }

  return (
    <AnimatedPage tone="system" className="flex flex-col h-full w-full py-8 px-10 gap-8">
      {/* Header & Controls */}
      <div className="stagger-item flex flex-col gap-6" style={{ '--stagger': 0 } as CSSProperties}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">标签管理</h1>
          <p className="text-text-secondary text-sm">为您的项目分门别类，配置不同色彩的标识符。</p>
        </div>

        {/* New Tag Input Area */}
        <div className="glass-panel ambient-panel flex items-center gap-4 p-4 rounded-[28px]">
           <input 
              type="text" 
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
              className="motion-focus bg-bg-primary border border-border-subtle text-text-primary text-sm rounded-lg focus:ring-border-primary focus:border-border-primary outline-none block w-80 p-2.5 transition-all"
              placeholder="输入新标签名称..." 
            />
            
            <div className="flex items-center gap-2 px-3">
              {COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className={`motion-action w-6 h-6 rounded-full cursor-pointer transition-all ${newTagColor === c ? 'ring-2 ring-offset-2 ring-offset-bg-secondary ring-current' : 'opacity-70 hover:opacity-100'}`}
                  style={{ backgroundColor: c, color: c }}
                ></button>
              ))}
            </div>

            <button onClick={handleCreateTag} className="motion-action ml-auto bg-text-primary text-bg-primary hover:bg-gray-200 font-semibold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 transition-all">
              <Plus size={16} strokeWidth={2.5}/>
              创建标签
            </button>
        </div>
      </div>

      {/* Tags Grid */}
      <div className="flex-1 overflow-y-auto pr-2 pb-10">
        <div className="grid grid-cols-2 gap-6">
          {tags.map((tag, tagIndex) => {
            const linkedProjects = projects.filter(p => p.tags?.some(t => t.id === tag.id))
            const isEditing = editingTagId === tag.id
            return (
              <div key={tag.id} className="tag-card motion-card stagger-item bg-bg-secondary rounded-[24px] border border-border-primary p-6 flex flex-col gap-5 relative group overflow-hidden" style={{ '--stagger': tagIndex + 1 } as CSSProperties}>
                 {/* Top section */}
                 <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                       <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-bg-primary shadow-sm border border-border-subtle flex-shrink-0">
                          <Tags size={20} style={{ color: isEditing ? editTagColor : tag.color }} />
                       </div>
                       <div className="min-w-0 flex-1">
                         {isEditing ? (
                           <input
                             value={editTagName}
                             onChange={e => setEditTagName(e.target.value)}
                             onKeyDown={e => { if (e.key === 'Enter') saveEditing(); if (e.key === 'Escape') cancelEditing() }}
                             className="motion-focus w-full bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-1.5 text-lg font-bold outline-none focus:border-border-primary"
                             autoFocus
                           />
                         ) : (
                           <h3 className="text-lg font-bold text-text-primary leading-tight truncate">{tag.name}</h3>
                         )}
                         <span className="text-xs text-text-secondary">创建于 {new Date(tag.createdAt).toLocaleDateString()}</span>
                       </div>
                    </div>
                    <div className={`flex gap-2 ${isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex-shrink-0`}>
                      {isEditing ? (
                        <>
                          <button onClick={saveEditing} className="motion-action w-8 h-8 rounded-md flex items-center justify-center bg-status-completed/15 text-status-completed hover:bg-status-completed/25 transition-colors" title="保存">
                            <Check size={14} />
                          </button>
                          <button onClick={cancelEditing} className="motion-action w-8 h-8 rounded-md flex items-center justify-center bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-border-subtle transition-colors" title="取消">
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEditing(tag)} className="motion-action w-8 h-8 rounded-md flex items-center justify-center bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-border-subtle transition-colors">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDeleteTag(tag.id)} className="motion-action w-8 h-8 rounded-md flex items-center justify-center bg-bg-tertiary text-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                 </div>

                 {/* Color picker in edit mode */}
                 {isEditing && (
                   <div className="flex items-center gap-2 px-1">
                     <span className="text-xs text-text-tertiary mr-1">颜色</span>
                     {COLORS.map(c => (
                       <button
                         key={c}
                         onClick={() => setEditTagColor(c)}
                         className={`motion-action w-5 h-5 rounded-full cursor-pointer transition-all ${editTagColor === c ? 'ring-2 ring-offset-2 ring-offset-bg-secondary ring-current scale-110' : 'opacity-60 hover:opacity-100'}`}
                         style={{ backgroundColor: c, color: c }}
                       />
                     ))}
                   </div>
                 )}

                 {/* Information section */}
                 <div className="flex items-center gap-4 pt-1">
                    <div className="flex items-center gap-2 bg-bg-primary px-3 py-1.5 rounded-md border border-border-subtle">
                       <FolderKanban size={14} className="text-text-tertiary" />
                       <span className="text-sm font-medium">{linkedProjects.length} 个项目</span>
                    </div>
                 </div>

                 {/* Associated Projects Links */}
                 <div className="mt-2 text-sm text-text-tertiary flex flex-wrap gap-x-3 gap-y-1">
                    {linkedProjects.length > 0 ? (
                      linkedProjects.map(p => (
                        <span key={p.id} onClick={() => navigate(`/project/${p.id}`)} className="cursor-pointer hover:text-accent-blue transition-colors relative hover:underline decoration-1 underline-offset-4 decoration-border-primary">{p.name}</span>
                      ))
                    ) : (
                      <span className="italic opacity-70">无关联项目</span>
                    )}
                 </div>
              </div>
            )
          })}
        </div>
        
        {tags.length === 0 && (
          <div className="h-full min-h-[300px] flex flex-col items-center justify-center opacity-50">
            <Tags size={48} className="mb-4 text-text-tertiary" />
            <p className="text-base font-medium">还没有任何标签</p>
            <p className="text-sm text-text-tertiary mt-1">在上方创建一个新标签吧</p>
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}
