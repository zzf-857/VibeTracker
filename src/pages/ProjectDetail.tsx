import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Project, Todo } from '../types'
import { ArrowLeft, Clock, Plus, Square, CheckSquare, Trash2, Save, Play, CheckCircle2, PauseCircle } from 'lucide-react'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  
  // Input states
  const [newNoteContent, setNewNoteContent] = useState('')
  const [newTodoContent, setNewTodoContent] = useState('')

  useEffect(() => {
    if (id) loadData()
  }, [id])

  const loadData = async () => {
    if (!id) return
    const p = await window.ipcRenderer.invoke('get-project', id)
    setProject(p)
  }

  // Updates
  const updateStatus = async (status: 'developing' | 'completed' | 'paused') => {
    if (!project) return
    await window.ipcRenderer.invoke('update-project', project.id, { status })
    loadData()
  }

  const updateProgress = async (val: number) => {
    if (!project) return
    await window.ipcRenderer.invoke('update-project', project.id, { progress: Math.max(0, Math.min(100, val)) })
    loadData()
  }

  // Noteblocks
  const handleAddNote = async () => {
    if (!project || !newNoteContent.trim()) return
    await window.ipcRenderer.invoke('create-noteblock', project.id, newNoteContent)
    setNewNoteContent('')
    loadData()
  }

  const handleDeleteNote = async (nid: string) => {
    if (!confirm('删除此备注？')) return
    await window.ipcRenderer.invoke('delete-noteblock', nid)
    loadData()
  }

  // Todos
  const handleAddTodo = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && project && newTodoContent.trim()) {
      await window.ipcRenderer.invoke('create-todo', project.id, newTodoContent)
      setNewTodoContent('')
      loadData()
    }
  }

  const handleToggleTodo = async (todo: Todo) => {
    await window.ipcRenderer.invoke('update-todo', todo.id, { completed: todo.completed ? 0 : 1 })
    loadData()
  }

  const handleDeleteTodo = async (tid: string) => {
    await window.ipcRenderer.invoke('delete-todo', tid)
    loadData()
  }

  if (!project) return <div className="p-10 text-text-secondary">检索项目信息中...</div>

  return (
    <div className="flex flex-col h-full w-full py-8 px-10 gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-text-tertiary hover:text-text-primary self-start transition-colors">
          <ArrowLeft size={16} /> 返回列表
        </button>

        <div className="flex items-start justify-between">
           <div>
              <div className="flex items-center gap-3 mb-2">
                 <h1 className="text-3xl font-bold tracking-tight text-text-primary">{project.name}</h1>
                 <span className={`text-xs px-2.5 py-1 rounded-[4px] font-medium border flex items-center gap-1.5
                    ${project.status === 'developing' ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20' : ''}
                    ${project.status === 'completed' ? 'bg-status-completed/10 text-status-completed border-status-completed/20' : ''}
                    ${project.status === 'paused' ? 'bg-status-paused/10 text-status-paused border-status-paused/20' : ''}
                 `}>
                    {project.status === 'developing' && <Play size={12}/>}
                    {project.status === 'completed' && <CheckCircle2 size={12}/>}
                    {project.status === 'paused' && <PauseCircle size={12}/>}
                    {project.status === 'developing' ? '开发中' : project.status === 'completed' ? '已完成' : '已暂停'}
                 </span>
              </div>
              <p className="text-text-secondary text-sm font-mono bg-bg-secondary inline-block px-2 py-1 rounded-md border border-border-primary">
                 {project.path || '未配置本地路径'}
              </p>
           </div>

           <div className="flex gap-2">
              <button onClick={() => updateStatus('developing')} className="bg-bg-secondary hover:bg-bg-tertiary border border-border-primary text-text-secondary hover:text-accent-blue px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                 <Play size={14}/> 设为开发中
              </button>
              <button onClick={() => updateStatus('completed')} className="bg-bg-secondary hover:bg-bg-tertiary border border-border-primary text-text-secondary hover:text-status-completed px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                 <CheckCircle2 size={14}/> 设为已完成
              </button>
              <button onClick={() => updateStatus('paused')} className="bg-bg-secondary hover:bg-bg-tertiary border border-border-primary text-text-secondary hover:text-status-paused px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                 <PauseCircle size={14}/> 设为已暂停
              </button>
           </div>
        </div>

        {/* Progress Control */}
        <div className="bg-bg-secondary p-4 rounded-xl border border-border-primary flex items-center gap-4 mt-2">
           <span className="text-sm font-medium text-text-secondary w-20">整体进度</span>
           <input 
              type="range" 
              min="0" max="100" 
              value={project.progress || 0} 
              onChange={e => updateProgress(Number(e.target.value))}
              className="flex-1 h-2 bg-bg-primary rounded-lg appearance-none cursor-pointer accent-accent-blue"
           />
           <span className="text-sm font-mono font-bold text-text-primary w-12 text-right">{Math.round(project.progress || 0)}%</span>
        </div>
      </div>

      {/* Dual Column Content */}
      <div className="flex-1 grid grid-cols-[1fr_350px] gap-8 overflow-hidden">
         {/* Left: Notes Blocks */}
         <div className="flex flex-col gap-4 overflow-hidden h-full">
            <div className="flex items-center justify-between">
               <h2 className="text-lg font-bold">项目备注 (Notes)</h2>
            </div>
            
            {/* New Note Input Area */}
            <div className="bg-bg-secondary border border-border-primary rounded-xl p-4 flex flex-col gap-3">
               <textarea 
                  value={newNoteContent}
                  onChange={e => setNewNoteContent(e.target.value)}
                  placeholder="在此写入新的备注内容或突发灵感..."
                  className="w-full bg-transparent resize-none outline-none text-text-primary text-sm h-20 placeholder-text-tertiary custom-scrollbar"
               ></textarea>
               <div className="flex justify-end">
                  <button onClick={handleAddNote} className="bg-bg-tertiary hover:bg-border-subtle hover:text-white border border-border-primary text-text-secondary px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5">
                     <Save size={14} /> 保存新的 Block
                  </button>
               </div>
            </div>

            {/* Note Blocks List */}
            <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4 pb-10 custom-scrollbar">
               {project.noteblocks?.map(note => (
                 <div key={note.id} className="bg-bg-secondary border border-border-primary rounded-xl p-5 flex flex-col gap-4 group hover:border-border-subtle transition-colors">
                    <p className="text-text-primary text-sm whitespace-pre-wrap leading-relaxed">
                       {note.content}
                    </p>
                    <div className="flex items-center justify-between pt-3 border-t border-border-primary/50">
                       <div className="flex items-center gap-1.5 text-xs text-text-tertiary font-mono">
                          <Clock size={12} />
                          最后修改: {new Date(note.updatedAt).toLocaleString()}
                       </div>
                       <button onClick={() => handleDeleteNote(note.id)} className="text-text-tertiary hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity p-1">
                          <Trash2 size={14} />
                       </button>
                    </div>
                 </div>
               ))}
               {(!project.noteblocks || project.noteblocks.length === 0) && (
                 <div className="text-center text-sm text-text-tertiary mt-10">暂无项目备注</div>
               )}
            </div>
         </div>

         {/* Right: Todos */}
         <div className="flex flex-col gap-4 bg-sidebar border border-border-primary rounded-xl p-6 overflow-hidden h-full">
            <h2 className="text-lg font-bold mb-2">代办清单 (To-do)</h2>
            
            <div className="relative group">
              <Plus size={16} className="absolute left-3 top-2.5 text-text-tertiary" />
              <input 
                 type="text" 
                 value={newTodoContent}
                 onChange={e => setNewTodoContent(e.target.value)}
                 onKeyDown={handleAddTodo}
                 placeholder="输入待办事项，按回车添加..."
                 className="w-full bg-bg-primary border border-border-subtle rounded-lg pl-9 p-2 text-sm text-text-primary outline-none focus:border-border-primary transition-colors"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar mt-2 flex flex-col gap-2">
               {project.todos?.map(todo => (
                 <div key={todo.id} className="flex items-start gap-3 group p-2 rounded-lg hover:bg-bg-tertiary transition-colors">
                    <button onClick={() => handleToggleTodo(todo)} className="mt-0.5 text-text-tertiary hover:text-accent-blue transition-colors flex-shrink-0">
                       {todo.completed ? <CheckSquare size={16} className="text-status-completed" /> : <Square size={16} />}
                    </button>
                    <span className={`text-sm flex-1 break-words ${todo.completed ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>
                       {todo.content}
                    </span>
                    <button onClick={() => handleDeleteTodo(todo.id)} className="text-text-tertiary hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity p-1 flex-shrink-0">
                       <Trash2 size={14}/>
                    </button>
                 </div>
               ))}
               {(!project.todos || project.todos.length === 0) && (
                 <div className="text-center text-sm text-text-tertiary mt-10">没遗留任务，尽情放松吧</div>
               )}
            </div>
         </div>
      </div>
    </div>
  )
}
