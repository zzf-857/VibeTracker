import { useEffect, useState, useMemo } from 'react'
import { Project, Tag } from '../types'
import { Search, Plus, FolderKanban, MoreVertical, Filter } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const p = await window.ipcRenderer.invoke('get-projects')
    const t = await window.ipcRenderer.invoke('get-tags')
    setProjects(p)
    setTags(t)
  }

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (p.path || '').toLowerCase().includes(searchQuery.toLowerCase())
      const matchTag = activeTag === null || p.tags?.some(t => t.id === activeTag)
      return matchSearch && matchTag
    })
  }, [projects, searchQuery, activeTag])

  const createDummyProject = async () => {
    const id = await window.ipcRenderer.invoke('create-project', {
      name: '新项目 ' + Math.floor(Math.random() * 1000),
      description: '',
      path: 'C:\\Projects\\NewProject',
      status: 'developing',
      progress: 0
    })
    navigate(`/project/${id}`)
  }

  return (
    <div className="flex flex-col h-full w-full py-8 px-10 gap-8">
      {/* Header & Controls */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">所有项目</h1>
            <p className="text-text-secondary text-sm">共 {projects.length} 个项目参与追踪</p>
          </div>
          
          <button onClick={createDummyProject} className="bg-text-primary text-bg-primary hover:bg-gray-200 font-semibold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 transition-all">
            <Plus size={16} strokeWidth={2.5}/>
            新建项目
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between bg-bg-secondary border border-border-primary p-2 rounded-xl">
          <div className="flex items-center gap-2 px-2 overflow-x-auto custom-scrollbar">
            <button 
              onClick={() => setActiveTag(null)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTag === null ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              全部项目
            </button>
            <div className="w-[1px] h-4 bg-border-primary mx-1"></div>
            {tags.map(tag => (
              <button 
                key={tag.id}
                onClick={() => setActiveTag(tag.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeTag === tag.id ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              >
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }}></div>
                {tag.name}
              </button>
            ))}
          </div>
          
          <div className="relative group w-72 flex-shrink-0 mr-1">
             <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search size={16} className="text-text-tertiary group-focus-within:text-text-primary transition-colors" />
            </div>
            <input 
              type="text" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-bg-primary border border-border-subtle text-text-primary text-sm rounded-lg focus:ring-border-primary focus:border-border-primary outline-none block w-full pl-9 p-2 transition-all" 
              placeholder="搜索项目名称或路径..." 
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto pr-2 pb-10">
        <div className="grid grid-cols-3 gap-6">
          {filteredProjects.map(project => (
            <div 
              key={project.id} 
              onClick={() => navigate(`/project/${project.id}`)}
              className="group bg-bg-secondary rounded-xl border border-border-primary p-5 flex flex-col gap-4 hover:border-border-subtle hover:bg-bg-tertiary cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border-subtle flex items-center justify-center text-text-secondary group-hover:text-accent-blue transition-colors">
                    <FolderKanban size={20} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-text-primary truncate max-w-[150px]">{project.name}</h3>
                    <p className="text-xs text-text-tertiary truncate max-w-[150px] mt-0.5">{project.path || '无路径'}</p>
                  </div>
                </div>
                <button className="text-text-tertiary hover:text-text-primary p-1" onClick={(e) => { e.stopPropagation(); /* menu */ }}>
                  <MoreVertical size={16} />
                </button>
              </div>
              
              <div className="flex items-center gap-2 mt-2">
                {project.tags?.map(t => (
                  <span key={t.id} className="text-[11px] px-2 py-0.5 rounded-[4px] font-medium border border-border-primary bg-bg-primary/50 flex items-center gap-1.5 object-contain">
                     <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }}></span>
                     {t.name}
                  </span>
                ))}
                {(!project.tags || project.tags.length === 0) && (
                  <span className="text-[11px] text-text-tertiary italic">无标签</span>
                )}
              </div>

              <div className="mt-auto pt-4 border-t border-border-primary/50 flex flex-col gap-2">
                 <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">
                      {project.status === 'developing' ? '开发中' : project.status === 'completed' ? '已完成' : '已暂停'}
                    </span>
                    <span className="text-xs font-mono font-medium text-text-primary">{Math.round(project.progress || 0)}%</span>
                 </div>
                 <div className="h-1.5 w-full bg-bg-primary rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${project.status === 'completed' ? 'bg-status-completed' : project.status === 'paused' ? 'bg-status-paused' : 'bg-accent-blue'}`} 
                      style={{ width: `${Math.max(project.progress || 0, 2)}%` }}
                    ></div>
                 </div>
              </div>
            </div>
          ))}
        </div>
        
        {filteredProjects.length === 0 && (
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center opacity-50">
            <Filter size={48} className="mb-4 text-text-tertiary" />
            <p className="text-base font-medium">没找到匹配的项目</p>
            <p className="text-sm text-text-tertiary mt-1">尝试更换搜索词或标签过滤</p>
          </div>
        )}
      </div>
    </div>
  )
}
