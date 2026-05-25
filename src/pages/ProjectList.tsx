import { useEffect, useMemo, useState } from 'react'
import { Project, ProjectStatus, Tag } from '../types'
import { Search, Plus, Image, Sparkles, Folder } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SafeImage } from '../components/SafeImage'
import { formatDateTime, getProjectCover, getRecentCommit } from '../lib/projectView'

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [newProjectPath, setNewProjectPath] = useState('')
  const [newProjectStatus, setNewProjectStatus] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [p, t, s] = await Promise.all([
      window.ipcRenderer.invoke('get-projects'),
      window.ipcRenderer.invoke('get-tags'),
      window.ipcRenderer.invoke('get-statuses'),
    ])
    setProjects(p)
    setTags(t)
    setStatuses(s)
    if (!newProjectStatus && s[0]) setNewProjectStatus(s[0].id)
  }

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.path || '').toLowerCase().includes(searchQuery.toLowerCase())
      const matchTag = activeTag === null || p.tags?.some(t => t.id === activeTag)
      return matchSearch && matchTag
    })
  }, [projects, searchQuery, activeTag])

  const createProject = async () => {
    if (!newProjectName.trim()) return
    const id = await window.ipcRenderer.invoke('create-project', {
      name: newProjectName.trim(),
      description: newProjectDescription.trim(),
      path: newProjectPath.trim(),
      status: newProjectStatus || statuses[0]?.id,
      progress: 0,
    })
    setNewProjectName('')
    setNewProjectDescription('')
    setNewProjectPath('')
    navigate(`/project/${id}`)
  }

  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div className="flex items-end justify-between gap-8">
        <div>
          <p className="text-text-tertiary text-sm mb-2">Project Gallery</p>
          <h1 className="text-[34px] font-semibold tracking-normal">项目画廊</h1>
          <p className="text-text-secondary text-sm mt-2">用封面和最近提交扫一眼每个 vibecoding 项目的状态。</p>
        </div>
        <div className="glass-panel rounded-[28px] p-4 w-[520px]">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
            <Sparkles size={16} className="text-accent-blue" />
            新建项目
          </div>
          <div className="flex flex-col gap-2">
            <input
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              className="bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary"
              placeholder="项目名称"
            />
            <div className="grid grid-cols-[1fr_150px] gap-2">
              <input
                value={newProjectDescription}
                onChange={e => setNewProjectDescription(e.target.value)}
                className="bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary"
                placeholder="一句话介绍这个项目"
              />
              <select
                value={newProjectStatus}
                onChange={e => setNewProjectStatus(e.target.value)}
                className="bg-bg-tertiary border border-border-subtle rounded-2xl px-3 py-2.5 text-sm outline-none focus:border-border-primary"
              >
                {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={newProjectPath}
                onChange={e => setNewProjectPath(e.target.value)}
                className="bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono"
                placeholder="本地路径，可选"
              />
              <button onClick={createProject} disabled={!newProjectName.trim()} className="bg-text-primary text-primary rounded-full px-4 text-sm font-semibold flex items-center gap-2 transition-all duration-[180ms] hover:opacity-90 disabled:opacity-40">
                <Plus size={15} /> 创建
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-[28px] p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto px-1">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-4 py-2 rounded-full text-sm transition-all duration-[180ms] ${activeTag === null ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'}`}
          >
            全部项目
          </button>
          {tags.map(tag => (
            <button
              key={tag.id}
              onClick={() => setActiveTag(tag.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all duration-[180ms] ${activeTag === tag.id ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'}`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </button>
          ))}
        </div>
        <div className="relative w-80 flex-shrink-0">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-bg-tertiary border border-border-subtle rounded-full pl-10 pr-4 py-2.5 text-sm outline-none focus:border-border-primary"
            placeholder="搜索项目、描述或路径"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 pb-10">
        {filteredProjects.map(project => (
          <ProjectGalleryCard key={project.id} project={project} onOpen={() => navigate(`/project/${project.id}`)} />
        ))}
      </div>

      {filteredProjects.length === 0 && (
        <div className="flex-1 min-h-[360px] flex items-center justify-center">
          <div className="text-center text-text-tertiary">
            <Image size={44} className="mx-auto mb-4 opacity-60" />
            <p className="text-text-secondary font-medium">还没有匹配的项目</p>
            <p className="text-sm mt-1">创建第一个项目后，这里会变成你的进展画廊。</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectGalleryCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const cover = getProjectCover(project)
  const recentCommit = getRecentCommit(project)

  return (
    <button
      onClick={onOpen}
      className="group text-left glass-panel rounded-[30px] overflow-hidden min-h-[360px] flex flex-col transition-all duration-[220ms] hover:-translate-y-1 hover:bg-bg-tertiary"
    >
      {cover ? (
        <div className="h-44 overflow-hidden bg-bg-tertiary">
          <SafeImage src={cover} alt={`${project.name} 封面`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
      ) : (
        <div className="h-44 p-5 flex flex-col justify-end bg-bg-tertiary/60">
          <div className="w-11 h-11 rounded-2xl bg-text-primary text-primary grid place-items-center font-semibold mb-4">
            {project.name.slice(0, 1).toUpperCase()}
          </div>
          <p className="text-sm text-text-tertiary">暂无封面截图</p>
        </div>
      )}
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold truncate">{project.name}</h3>
          {project.statusInfo && (
            <span className="px-3 py-1 rounded-full text-xs border border-border-subtle flex-shrink-0" style={{ color: project.statusInfo.color, backgroundColor: `${project.statusInfo.color}18` }}>
              {project.statusInfo.name}
            </span>
          )}
        </div>
        <p className="text-sm text-text-secondary mt-3 line-clamp-2 min-h-[42px]">{project.description || '这个项目还没有简介。'}</p>
        <div className="mt-auto pt-5 border-t border-border-subtle">
        <p className="text-xs text-text-tertiary mb-2 font-mono">{recentCommit ? formatDateTime(recentCommit.createdAt) : 'NO COMMIT YET'}</p>
          <p className="text-sm text-text-primary font-medium truncate">{recentCommit?.title || '还没有进展提交'}</p>
          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="flex items-center gap-1.5 min-w-0">
              {(project.tags || []).slice(0, 3).map(tag => (
                <span key={tag.id} className="px-2 py-1 rounded-full bg-white/[0.06] text-[11px] text-text-secondary flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
              ))}
              {project.path && (project.tags || []).length === 0 && (
                <span className="text-[11px] text-text-tertiary font-mono truncate flex items-center gap-1.5">
                  <Folder size={12} /> {project.path}
                </span>
              )}
            </div>
            <p className="text-xs text-text-tertiary flex-shrink-0">{project.commitCount || 0} 次提交</p>
          </div>
        </div>
      </div>
    </button>
  )
}
