import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { Project } from '../types'
import { Check, ChevronDown, Search, Plus, Image, Sparkles, Folder, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { SafeImage } from '../components/SafeImage'
import { getStaggerStyle } from '../lib/motion'
import { formatDateTime, getProjectCover, getRecentCommit } from '../lib/projectView'
import { MOCK_MODE_LABEL, mockProjects, mockStatuses, mockTags } from '../lib/mockData'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'
import { InteractiveCard } from '../components/InteractiveCard'



function ProjectListSkeleton() {
  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      {/* 头部标题区 */}
      <div className="flex items-end justify-between gap-8">
        <div className="space-y-2 w-1/3">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-10 w-48 rounded-lg" />
          <Skeleton className="h-4 w-72 rounded mt-2" />
        </div>
        <Skeleton className="h-12 w-32 rounded-full" />
      </div>

      {/* 过滤器条 */}
      <div className="glass-panel rounded-[28px] p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 px-1">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-80 rounded-full" />
      </div>

      {/* 项目网格 */}
      <div className="grid grid-cols-3 gap-6 pb-10">
        {[1, 2, 3].map(i => (
          <div key={i} className="glass-panel rounded-[30px] overflow-hidden min-h-[360px] flex flex-col space-y-4">
            <Skeleton className="h-44 w-full rounded-none" />
            <div className="p-5 flex-1 flex flex-col space-y-4">
              <div className="flex justify-between items-center">
                <Skeleton className="h-7 w-32 rounded" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              
              <div className="mt-auto pt-5 border-t border-white/[0.06] space-y-3">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-4.5 w-full rounded" />
                <div className="flex justify-between items-center mt-3">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-12 rounded" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectList() {
  const { projects, statuses, tags, isLoaded, refresh } = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [newProjectPath, setNewProjectPath] = useState('')
  const [newProjectStatus, setNewProjectStatus] = useState('')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [isStatusPickerOpen, setIsStatusPickerOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoaded) {
      refresh()
    }
  }, [isLoaded, refresh])

  useEffect(() => {
    if (statuses.length > 0 && !newProjectStatus) {
      setNewProjectStatus(statuses[0].id)
    }
  }, [statuses, newProjectStatus])

  const isLoading = !isLoaded

  const isMockMode = !isLoading && projects.length === 0

  const filteredProjects = useMemo(() => {
    const displayProjects = isMockMode ? mockProjects : projects
    return displayProjects.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.path || '').toLowerCase().includes(searchQuery.toLowerCase())
      const matchTag = activeTag === null || p.tags?.some(t => t.id === activeTag)
      return matchSearch && matchTag
    })
  }, [projects, isMockMode, searchQuery, activeTag])

  const displayTags = isMockMode ? mockTags : tags
  const displayStatuses = statuses.length ? statuses : mockStatuses
  const selectedStatus = displayStatuses.find(status => status.id === newProjectStatus) || displayStatuses[0]

  if (isLoading) {
    return <ProjectListSkeleton />
  }

  const createProject = async () => {
    if (!newProjectName.trim()) return
    const id = await window.ipcRenderer.invoke('create-project', {
      name: newProjectName.trim(),
      description: newProjectDescription.trim(),
      path: newProjectPath.trim(),
      status: newProjectStatus || statuses[0]?.id,
      progress: 0,
    })
    await refresh()
    setNewProjectName('')
    setNewProjectDescription('')
    setNewProjectPath('')
    setIsComposerOpen(false)
    setIsStatusPickerOpen(false)
    navigate(`/project/${id}`)
  }

  const closeComposer = () => {
    setIsComposerOpen(false)
    setIsStatusPickerOpen(false)
    setNewProjectName('')
    setNewProjectDescription('')
    setNewProjectPath('')
  }

  return (
    <AnimatedPage tone="gallery" className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div className="stagger-item flex items-end justify-between gap-8" style={{ '--stagger': 0 } as CSSProperties}>
        <div>
          <p className="text-text-tertiary text-sm mb-2">Project Gallery</p>
          <div className="flex items-center gap-3">
            <h1 className="text-[34px] font-semibold tracking-normal">项目画廊</h1>
            {isMockMode && <span className="px-3 py-1 rounded-full bg-white/[0.08] border border-border-subtle text-xs text-text-secondary">{MOCK_MODE_LABEL}</span>}
          </div>
          <p className="text-text-secondary text-sm mt-2">用封面和最近提交扫一眼每个 vibecoding 项目的状态。</p>
        </div>
        <button
          onClick={() => setIsComposerOpen(true)}
          className={`h-12 px-5 rounded-full border text-sm font-semibold flex items-center gap-2 transition-all duration-[180ms] ${isComposerOpen ? 'bg-text-primary text-primary border-transparent' : 'bg-white/[0.08] border-border-primary text-text-primary hover:bg-white/[0.12]'}`}
        >
          <Plus size={16} />
          新建项目
        </button>
      </div>

      {isComposerOpen && (
        <section className="glass-panel ambient-panel composer-panel rounded-[30px] p-4 z-30">
          <div className="grid grid-cols-[minmax(220px,1.15fr)_minmax(180px,0.9fr)_170px_auto] gap-3 items-center">
            <div className="relative">
              <Sparkles size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-accent-blue" />
              <input
                autoFocus
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                className="motion-focus w-full h-12 bg-bg-tertiary border border-border-subtle rounded-full pl-11 pr-4 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-primary"
                placeholder="项目名称"
              />
            </div>
            <input
              value={newProjectDescription}
              onChange={e => setNewProjectDescription(e.target.value)}
              className="motion-focus h-12 bg-bg-tertiary border border-border-subtle rounded-full px-4 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-primary"
              placeholder="一句话介绍"
            />
            <div className="relative z-20">
              <button
                type="button"
                onClick={() => setIsStatusPickerOpen(prev => !prev)}
                className="status-picker-trigger h-12 w-full bg-bg-tertiary border border-border-subtle rounded-full px-4 text-sm text-text-primary outline-none flex items-center justify-between gap-3"
              >
                <span className="min-w-0 flex items-center gap-2">
                  {selectedStatus && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selectedStatus.color }} />}
                  <span className="truncate">{selectedStatus?.name || '选择状态'}</span>
                </span>
                <ChevronDown size={15} className={`text-text-tertiary transition-transform duration-[180ms] ${isStatusPickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {isStatusPickerOpen && (
                <div className="status-picker-menu">
                  {displayStatuses.map(status => {
                    const isSelected = status.id === selectedStatus?.id
                    return (
                      <button
                        type="button"
                        key={status.id}
                        onClick={() => {
                          setNewProjectStatus(status.id)
                          setIsStatusPickerOpen(false)
                        }}
                        className={`status-picker-option ${isSelected ? 'status-picker-option-active' : ''}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
                          <span className="truncate">{status.name}</span>
                        </span>
                        {isSelected && <Check size={14} className="flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={createProject}
                disabled={!newProjectName.trim()}
                className="motion-press h-12 px-5 rounded-full bg-text-primary text-primary text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-35"
              >
                <Plus size={15} /> 创建
              </button>
              <button
                onClick={closeComposer}
                className="composer-close-button h-12 w-12 rounded-full bg-bg-tertiary border border-border-subtle text-text-tertiary hover:text-text-primary grid place-items-center"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="mt-3 relative">
            <Folder size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              value={newProjectPath}
              onChange={e => setNewProjectPath(e.target.value)}
              className="motion-focus w-full h-11 bg-bg-secondary border border-border-subtle rounded-full pl-10 pr-4 text-xs text-text-secondary placeholder:text-text-tertiary outline-none focus:border-border-primary font-mono"
              placeholder="本地路径，可选，例如 C:\\Projects\\VibeTracker"
            />
          </div>
        </section>
      )}

      <div className="glass-panel motion-card stagger-item rounded-[28px] p-3 flex items-center justify-between gap-4" style={{ '--stagger': 1 } as CSSProperties}>
        <div className="flex items-center gap-2 overflow-x-auto px-1">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-4 py-2 rounded-full text-sm transition-all duration-[180ms] ${activeTag === null ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'}`}
          >
            全部项目
          </button>
          {displayTags.map(tag => (
            <button
              key={tag.id}
              onClick={() => setActiveTag(tag.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all duration-[180ms] ${activeTag === tag.id ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'}`}
            >
              <span className="w-2 h-2 rounded-full breathing-dot" style={{ backgroundColor: tag.color }} />
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

      <div key={activeTag ?? 'all'} className="gallery-grid grid grid-cols-3 gap-6 pb-10">
        {filteredProjects.map((project, index) => (
          <ProjectGalleryCard key={project.id} project={project} index={index} onOpen={() => navigate(`/project/${project.id}`)} />
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
    </AnimatedPage>
  )
}

function ProjectGalleryCard({ project, onOpen, index }: { project: Project; onOpen: () => void; index: number }) {
  const cover = getProjectCover(project)
  const recentCommit = getRecentCommit(project)

  return (
    <InteractiveCard
      onClick={onOpen}
      className="group text-left glass-panel ambient-panel motion-card gallery-card gallery-card-enter rounded-[30px] overflow-hidden min-h-[360px] flex flex-col cursor-pointer"
      style={getStaggerStyle(index + 2)}
    >
      {cover ? (
        <div className="h-44 overflow-hidden bg-bg-tertiary">
          <SafeImage src={cover} alt={`${project.name} 封面`} className="h-full w-full object-cover gallery-cover" />
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
          <p className="gallery-card-recent text-sm text-text-primary font-medium truncate">{recentCommit?.title || '还没有进展提交'}</p>
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
    </InteractiveCard>
  )
}
