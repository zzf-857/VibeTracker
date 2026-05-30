import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CommitImage, Project, ProjectCommit, ProjectStatus, NoteBlock, Todo } from '../types'
import { ArrowLeft, Camera, Check, CheckSquare, ExternalLink, Folder, Github, ImagePlus, Pencil, Plus, RotateCcw, Save, Square, Star, StickyNote, Trash2, X } from 'lucide-react'
import { AnimatedPage } from '../components/AnimatedPage'
import { SafeImage } from '../components/SafeImage'
import { formatDateKey, formatDateTime, getActivityLevel, getProjectCover, groupCommitsByDay } from '../lib/projectView'
import { MOCK_MODE_LABEL, getMockProject, isMockProjectId, mockStatuses } from '../lib/mockData'
import { Skeleton } from '../components/Skeleton'
import { ConfirmDialog } from '../components/ConfirmDialog'

function ProjectDetailSkeleton() {
  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-7 animate-pulse">
      {/* 返回按钮 */}
      <Skeleton className="h-5 w-16 rounded" />
      
      {/* 头部项目面板 */}
      <div className="glass-panel rounded-[32px] p-8 flex gap-8">
        {/* 左侧封面骨架 */}
        <Skeleton className="w-[200px] h-[135px] rounded-[24px] flex-shrink-0" />
        {/* 右侧文本骨架 */}
        <div className="flex-1 flex flex-col justify-between py-1">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-8 w-48 rounded-lg" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-4.5 w-full rounded" />
            <Skeleton className="h-4.5 w-3/4 rounded" />
          </div>
          <div className="flex gap-4 mt-4">
            <Skeleton className="h-5 w-36 rounded" />
            <Skeleton className="h-5 w-36 rounded" />
          </div>
        </div>
      </div>

      {/* 进度/快捷提交区 */}
      <div className="grid grid-cols-[1.4fr_0.6fr] gap-6">
        <div className="glass-panel rounded-[32px] p-6 space-y-4">
          <Skeleton className="h-6 w-32 rounded" />
          <div className="flex items-center gap-6 h-28">
            <Skeleton className="w-24 h-24 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4.5 w-1/2 rounded" />
              <Skeleton className="h-3.5 w-1/3 rounded" />
            </div>
          </div>
        </div>
        <div className="glass-panel rounded-[32px] p-6 flex flex-col justify-between">
          <Skeleton className="h-6 w-24 rounded" />
          <Skeleton className="h-10 w-full rounded-full" />
        </div>
      </div>

      {/* NoteBlocks & Todos 区域 */}
      <div className="grid grid-cols-2 gap-6">
        <div className="glass-panel rounded-[32px] p-6 space-y-4 h-[300px]">
          <Skeleton className="h-6 w-24 rounded" />
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        </div>
        <div className="glass-panel rounded-[32px] p-6 space-y-4 h-[300px]">
          <Skeleton className="h-6 w-24 rounded" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-2xl" />
            <Skeleton className="h-10 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [progressDelta, setProgressDelta] = useState('')
  const [commitImagePath, setCommitImagePath] = useState('')
  const [ritualCommitId, setRitualCommitId] = useState<string | null>(null)
  const [ritualStartedAt, setRitualStartedAt] = useState<number>(0)
  const [coverRitualKey, setCoverRitualKey] = useState('')
  const [isCreatingCommit, setIsCreatingCommit] = useState(false)
  const [editingCommit, setEditingCommit] = useState<ProjectCommit | null>(null)
  const [isEditingProject, setIsEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ name: '', description: '', path: '', repoUrl: '' })
  const [pendingDeleteProject, setPendingDeleteProject] = useState(false)
  // NoteBlocks
  const [newNoteContent, setNewNoteContent] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  // Todos
  const [newTodoContent, setNewTodoContent] = useState('')
  const [pendingDeleteCommitId, setPendingDeleteCommitId] = useState<string | null>(null)

  const isMountedRef = useRef(true)
  const creatingCommitRef = useRef(false)
  const ritualTimeoutRef = useRef<number | null>(null)
  const coverRitualTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    setIsLoading(true)
    loadData()
  }, [id])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (ritualTimeoutRef.current !== null) window.clearTimeout(ritualTimeoutRef.current)
      if (coverRitualTimeoutRef.current !== null) window.clearTimeout(coverRitualTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!project) return
    setProjectDraft({
      name: project.name || '',
      description: project.description || '',
      path: project.path || '',
      repoUrl: project.repoUrl || '',
    })
  }, [project?.id])

  const loadData = async () => {
    if (!id) return
    try {
      const [p, s] = await Promise.all([
        window.ipcRenderer.invoke('get-project', id),
        window.ipcRenderer.invoke('get-statuses'),
      ])
      if (!isMountedRef.current) return
      const mockProject = (!p || Array.isArray(p)) && isMockProjectId(id) ? getMockProject(id) : null
      setProject(mockProject || p)
      setStatuses(mockProject ? mockStatuses : s)
    } catch (err) {
      console.error('Failed to load project:', err)
    } finally {
      if (isMountedRef.current) setIsLoading(false)
    }
  }

  const commits = project?.commits || []
  const noteblocks: NoteBlock[] = (project as any)?.noteblocks || []
  const todos: Todo[] = (project as any)?.todos || []
  const cover = project ? getProjectCover(project) : ''
  const isMock = isMockProjectId(project?.id)

  const clearRitualTimeout = () => {
    if (ritualTimeoutRef.current === null) return
    window.clearTimeout(ritualTimeoutRef.current)
    ritualTimeoutRef.current = null
  }

  const clearCoverRitualTimeout = () => {
    if (coverRitualTimeoutRef.current === null) return
    window.clearTimeout(coverRitualTimeoutRef.current)
    coverRitualTimeoutRef.current = null
  }

  const triggerCoverRitual = (keyBase: string, timestamp = Date.now()) => {
    if (!isMountedRef.current) return
    clearCoverRitualTimeout()
    setCoverRitualKey(`${keyBase}:${timestamp}`)
    coverRitualTimeoutRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) return
      setCoverRitualKey('')
      coverRitualTimeoutRef.current = null
    }, 1000)
  }

  const createCommit = async () => {
    if (!project || !commitTitle.trim() || creatingCommitRef.current) return
    if (isMock) return
    creatingCommitRef.current = true
    setIsCreatingCommit(true)
    try {
      const imagePath = commitImagePath.trim()
      const createdId = await window.ipcRenderer.invoke('create-commit', {
        projectId: project.id,
        title: commitTitle.trim(),
        description: commitDescription.trim(),
        progressDelta: Number(progressDelta) || 0,
        imagePath,
      })
      if (!isMountedRef.current) return
      const now = Date.now()
      clearRitualTimeout()
      setRitualCommitId(createdId)
      setRitualStartedAt(now)
      if (imagePath) triggerCoverRitual(createdId, now)
      setCommitTitle('')
      setCommitDescription('')
      setProgressDelta('')
      setCommitImagePath('')
      try {
        await loadData()
      } finally {
        if (!isMountedRef.current) return
        ritualTimeoutRef.current = window.setTimeout(() => {
          if (!isMountedRef.current) return
          setRitualCommitId(current => current === createdId ? null : current)
          ritualTimeoutRef.current = null
        }, 1200)
      }
    } finally {
      creatingCommitRef.current = false
      if (isMountedRef.current) setIsCreatingCommit(false)
    }
  }

  const selectCommitImage = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path && isMountedRef.current) setCommitImagePath(path)
  }

  const updateStatus = async (statusId: string) => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('update-project', project.id, { status: statusId })
    if (!isMountedRef.current) return
    loadData()
  }

  const saveProject = async () => {
    if (!project || !projectDraft.name.trim() || isMock) return
    await window.ipcRenderer.invoke('update-project', project.id, {
      name: projectDraft.name.trim(),
      description: projectDraft.description.trim(),
      path: projectDraft.path.trim(),
      repoUrl: projectDraft.repoUrl.trim(),
    })
    if (!isMountedRef.current) return
    setIsEditingProject(false)
    loadData()
  }

  const setCoverFromPath = async (imagePath: string) => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('update-project', project.id, { coverImagePath: imagePath })
    if (!isMountedRef.current) return
    if (imagePath) triggerCoverRitual(imagePath)
    await loadData()
  }

  const selectManualCover = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path && isMountedRef.current) setCoverFromPath(path)
  }

  const openLocalPath = async () => {
    if (!project?.path) return
    const result = await window.ipcRenderer.invoke('open-local-path', project.path)
    if (!result.ok) alert(result.reason || '无法打开本地路径')
  }

  const openRepoUrl = async () => {
    if (!project?.repoUrl) return
    const result = await window.ipcRenderer.invoke('open-external-url', project.repoUrl)
    if (!result.ok) alert(result.reason || '无法打开远端仓库')
  }

  const deleteProject = async () => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('delete-project', project.id)
    navigate('/projects')
  }

  const createNoteBlock = async () => {
    if (!project || !newNoteContent.trim() || isMock) return
    await window.ipcRenderer.invoke('create-noteblock', project.id, newNoteContent.trim())
    if (!isMountedRef.current) return
    setNewNoteContent('')
    loadData()
  }

  const updateNoteBlock = async (noteId: string) => {
    if (!editNoteContent.trim() || isMock) return
    await window.ipcRenderer.invoke('update-noteblock', noteId, editNoteContent.trim())
    if (!isMountedRef.current) return
    setEditingNoteId(null)
    setEditNoteContent('')
    loadData()
  }

  const deleteNoteBlock = async (noteId: string) => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('delete-noteblock', noteId)
    if (!isMountedRef.current) return
    loadData()
  }

  const createTodo = async () => {
    if (!project || !newTodoContent.trim() || isMock) return
    await window.ipcRenderer.invoke('create-todo', project.id, newTodoContent.trim())
    if (!isMountedRef.current) return
    setNewTodoContent('')
    loadData()
  }

  const toggleTodo = async (todo: Todo) => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('update-todo', todo.id, { completed: todo.completed === 1 ? 0 : 1 })
    if (!isMountedRef.current) return
    loadData()
  }

  const deleteTodo = async (todoId: string) => {
    if (!project || isMock) return
    await window.ipcRenderer.invoke('delete-todo', todoId)
    if (!isMountedRef.current) return
    loadData()
  }

  if (isLoading) return <ProjectDetailSkeleton />

  if (!project) return <div className="p-10 text-text-secondary">项目未找到或已被删除。</div>

  return (
    <AnimatedPage tone="detail" className="flex flex-col min-h-full w-full py-8 px-10 gap-7">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-text-tertiary hover:text-text-primary self-start transition-colors">
        <ArrowLeft size={16} /> 返回
      </button>

      <section className="stagger-item grid grid-cols-[1fr_360px] gap-6" style={{ '--stagger': 0 } as CSSProperties}>
        <div className="glass-panel ambient-panel motion-card rounded-[32px] p-7 min-h-[260px] flex flex-col justify-between relative">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-text-tertiary text-sm">Project Dossier</p>
                  {isMock && <span className="px-2.5 py-1 rounded-full bg-white/[0.08] border border-border-subtle text-[11px] text-text-secondary">{MOCK_MODE_LABEL}</span>}
                </div>
                {isEditingProject ? (
                  <input
                    value={projectDraft.name}
                    onChange={e => setProjectDraft(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-bg-tertiary border border-border-subtle rounded-[22px] px-4 py-3 text-[30px] font-semibold outline-none focus:border-border-primary"
                    placeholder="项目名称"
                  />
                ) : (
                  <h1 className="text-[38px] font-semibold tracking-normal truncate">{project.name}</h1>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 relative">
                <select
                  value={project.status}
                  onChange={e => updateStatus(e.target.value)}
                  disabled={isMock}
                  className="bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2 text-sm outline-none"
                  style={{ color: project.statusInfo?.color || undefined }}
                >
                  {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
                <button
                  onClick={() => setIsEditingProject(prev => !prev)}
                  disabled={isMock}
                  className="w-9 h-9 rounded-full bg-bg-tertiary border border-border-subtle text-text-secondary hover:text-text-primary grid place-items-center transition-colors"
                  title={isEditingProject ? '收起编辑' : '编辑项目'}
                >
                  {isEditingProject ? <X size={15} /> : <Pencil size={15} />}
                </button>
                {!isMock && (
                  <button
                    onClick={() => setPendingDeleteProject(true)}
                    className="w-9 h-9 rounded-full bg-bg-tertiary border border-border-subtle text-text-secondary hover:text-accent-red hover:bg-accent-red/10 grid place-items-center transition-colors"
                    title="删除项目"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {pendingDeleteProject && (
                <div className="absolute right-0 top-full mt-2 z-10 bg-bg-secondary border border-accent-red/30 rounded-2xl p-4 shadow-xl min-w-[260px]">
                  <p className="text-sm text-text-primary mb-3">确认删除项目 <strong>{project.name}</strong>？此操作不可撤销。</p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setPendingDeleteProject(false)} className="motion-action px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border-subtle text-sm text-text-secondary hover:text-text-primary transition-colors">取消</button>
                    <button onClick={deleteProject} className="motion-action px-3 py-1.5 rounded-lg bg-accent-red/15 border border-accent-red/30 text-sm text-accent-red hover:bg-accent-red/25 transition-colors">确认删除</button>
                  </div>
                </div>
              )}
            </div>
            {isEditingProject ? (
              <div className="mt-5 space-y-3">
                <textarea
                  value={projectDraft.description}
                  onChange={e => setProjectDraft(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded-[22px] px-4 py-3 text-sm leading-6 outline-none focus:border-border-primary resize-none h-28"
                  placeholder="这个项目想解决什么？当前做到哪里了？"
                />
                <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
                  <input
                    value={projectDraft.path}
                    onChange={e => setProjectDraft(prev => ({ ...prev, path: e.target.value }))}
                    className="min-w-0 bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono"
                    placeholder="本地项目路径，可选"
                  />
                  <input
                    value={projectDraft.repoUrl}
                    onChange={e => setProjectDraft(prev => ({ ...prev, repoUrl: e.target.value }))}
                    className="min-w-0 bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono"
                    placeholder="GitHub 仓库网址，可选"
                  />
                  <button
                    onClick={saveProject}
                    disabled={!projectDraft.name.trim()}
                    className="bg-text-primary text-primary rounded-full px-4 py-2.5 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Save size={15} /> 保存项目
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-text-secondary leading-7 mt-5 max-w-3xl">{project.description || '这个项目还没有简介。打开编辑后补上一段，让它更像一个可持续跟进的作品档案。'}</p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-6">
            <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary">{commits.length} 次提交</span>
            <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary font-mono">updated {formatDateTime(project.updatedAt)}</span>
            {project.path && (
              <button onClick={openLocalPath} className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-tertiary hover:text-text-primary font-mono truncate max-w-[420px] flex items-center gap-2 transition-colors" title="打开本地项目文件夹">
                <Folder size={13} /> {project.path}
              </button>
            )}
            {project.repoUrl && (
              <button onClick={openRepoUrl} className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-tertiary hover:text-text-primary font-mono truncate max-w-[360px] flex items-center gap-2 transition-colors" title="在浏览器打开远端仓库">
                <Github size={13} /> GitHub <ExternalLink size={12} />
              </button>
            )}
          </div>
          {pendingDeleteProject && (
            <div className="rounded-2xl border border-accent-red/25 bg-accent-red/10 px-4 py-3 mt-4 flex items-center justify-between gap-3">
              <span className="text-sm text-text-secondary">确认删除项目「{project.name}」？所有提交、备注和待办事项都会被永久移除。</span>
              <div className="flex items-center gap-2">
                <button onClick={deleteProject} className="motion-action h-8 px-3 rounded-full bg-accent-red text-white text-xs font-medium flex items-center gap-1.5"><Check size={13} /> 确认删除</button>
                <button onClick={() => setPendingDeleteProject(false)} className="motion-action h-8 px-3 rounded-full bg-white/10 text-text-secondary text-xs font-medium flex items-center gap-1.5"><X size={13} /> 取消</button>
              </div>
            </div>
          )}
        </div>

        <div className="glass-panel ambient-panel motion-card rounded-[32px] overflow-hidden min-h-[260px]">
          {cover ? (
            <div className="relative h-full min-h-[260px] group">
              <SafeImage src={cover} alt={`${project.name} 封面`} className="w-full h-full object-cover" />
              {coverRitualKey && <span key={coverRitualKey} className="cover-sheen-layer" aria-hidden="true" />}
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/65 to-transparent flex items-center gap-2">
                <button onClick={selectManualCover} className="px-3 py-1.5 rounded-full bg-white/12 border border-white/15 text-xs text-white/85 hover:text-white backdrop-blur-md flex items-center gap-1.5">
                  <ImagePlus size={13} /> 更换封面
                </button>
                {project.coverImagePath && (
                  <button onClick={() => setCoverFromPath('')} className="px-3 py-1.5 rounded-full bg-white/12 border border-white/15 text-xs text-white/85 hover:text-white backdrop-blur-md flex items-center gap-1.5">
                    <RotateCcw size={13} /> 使用自动封面
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[260px] p-6 flex flex-col justify-end text-text-tertiary bg-bg-tertiary/40">
              <Camera size={34} className="mb-4 opacity-70" />
              <p className="text-sm">添加带截图的 commit 后，这里会自动显示项目封面。</p>
              <button onClick={selectManualCover} className="mt-4 self-start px-4 py-2 rounded-full bg-bg-secondary border border-border-subtle text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors">
                <ImagePlus size={15} /> 手动选择封面
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="stagger-item grid grid-cols-[1.1fr_0.9fr] gap-6 min-h-[520px]" style={{ '--stagger': 1 } as CSSProperties}>
        <div className="glass-panel motion-card rounded-[32px] p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-semibold">进展时间线</h2>
              <p className="text-sm text-text-tertiary mt-1">每次 vibecoding 后写一条 commit。</p>
            </div>
          </div>

          <div className={`bg-bg-secondary border border-border-subtle rounded-[26px] p-4 mb-6 commit-composer ${ritualCommitId ? 'ritual-confirm' : ''}`}>
            <div className="grid grid-cols-[1fr_120px] gap-3 mb-3">
              <input value={commitTitle} onChange={e => setCommitTitle(e.target.value)} className="motion-focus bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary" placeholder="提交标题，例如：完成项目详情页定调" />
              <input value={progressDelta} onChange={e => setProgressDelta(e.target.value)} className="motion-focus bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono" placeholder="+0" />
            </div>
            <textarea value={commitDescription} onChange={e => setCommitDescription(e.target.value)} className="motion-focus w-full bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none focus:border-border-primary resize-none h-20" placeholder="描述这次推进了什么、为什么重要..." />
            <div className="flex items-center gap-2 mt-3">
              <button onClick={selectCommitImage} className="motion-press commit-composer-button px-4 py-2 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors">
                <ImagePlus size={15} /> 选择截图
              </button>
              {commitImagePath && <span className="text-xs text-text-tertiary truncate flex-1 font-mono">{commitImagePath}</span>}
              <button onClick={createCommit} disabled={isMockProjectId(project.id) || isCreatingCommit || !commitTitle.trim()} className="motion-press ml-auto bg-text-primary text-primary rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40">
                <Plus size={15} /> {isMockProjectId(project.id) ? '展示中' : isCreatingCommit ? '提交中' : '提交'}
              </button>
            </div>
          </div>

          <div className="relative pl-7 space-y-5 overflow-y-auto max-h-[540px] pr-2 custom-scrollbar before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border-primary">
            {commits.map((commit) => (
              <CommitCard
                key={commit.id}
                commit={commit}
                onEdit={() => setEditingCommit(commit)}
                onDelete={() => setPendingDeleteCommitId(commit.id)}
                onSetCover={(imagePath) => setCoverFromPath(imagePath)}
                isNew={commit.id === ritualCommitId}
              />
            ))}
            {commits.length === 0 && (
              <div className="min-h-[220px] flex items-center justify-center text-text-tertiary text-sm">还没有提交，先写下第一条进展。</div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel motion-card rounded-[32px] p-6">
            <h2 className="text-xl font-semibold mb-5">提交热力图</h2>
            <CommitHeatmap commits={commits} pulseTimestamp={ritualStartedAt} />
          </section>
          <section className="glass-panel motion-card rounded-[32px] p-6">
            <h2 className="text-xl font-semibold mb-4">最近截图</h2>
            <div className="grid grid-cols-2 gap-3">
              {commits.flatMap(c => c.images || []).slice(0, 4).map(image => (
                <button key={image.id} onClick={() => setCoverFromPath(image.imagePath)} className="aspect-video rounded-2xl overflow-hidden bg-bg-tertiary border border-border-subtle">
                  <SafeImage src={image.imagePath} alt={image.caption || '提交截图'} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            {commits.flatMap(c => c.images || []).length === 0 && <p className="text-sm text-text-tertiary">还没有提交截图。</p>}
          </section>
        </aside>
      </section>

      {/* Section 3: NoteBlocks & Todos */}
      <section className="stagger-item grid grid-cols-2 gap-6" style={{ '--stagger': 2 } as CSSProperties}>
        {/* NoteBlocks */}
        <div className="glass-panel motion-card rounded-[32px] p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-5">
            <StickyNote size={18} className="text-accent-purple" />
            <h2 className="text-xl font-semibold">备注</h2>
            <span className="text-xs text-text-tertiary ml-auto">{noteblocks.length} 条</span>
          </div>
          {!isMock && (
            <div className="flex gap-2 mb-4">
              <textarea
                value={newNoteContent}
                onChange={e => setNewNoteContent(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createNoteBlock() } }}
                className="motion-focus flex-1 bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary resize-none h-[68px]"
                placeholder="记录一些想法、待查的问题、灵感..."
              />
              <button
                onClick={createNoteBlock}
                disabled={!newNoteContent.trim()}
                className="motion-press self-end bg-text-primary text-primary rounded-full w-9 h-9 grid place-items-center transition-opacity hover:opacity-90 disabled:opacity-30 flex-shrink-0"
              >
                <Plus size={16} />
              </button>
            </div>
          )}
          <div className="space-y-3 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar flex-1">
            {noteblocks.map(note => (
              <div key={note.id} className="bg-bg-secondary border border-border-subtle rounded-2xl p-4 group">
                {editingNoteId === note.id ? (
                  <div>
                    <textarea
                      value={editNoteContent}
                      onChange={e => setEditNoteContent(e.target.value)}
                      className="motion-focus w-full bg-bg-tertiary border border-border-subtle rounded-xl px-3 py-2 text-sm outline-none focus:border-border-primary resize-none h-[80px]"
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2 justify-end">
                      <button onClick={() => setEditingNoteId(null)} className="motion-action text-xs text-text-tertiary hover:text-text-primary px-2 py-1">取消</button>
                      <button onClick={() => updateNoteBlock(note.id)} className="motion-action text-xs text-accent-blue hover:text-accent-blue/80 px-2 py-1">保存</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p
                      onClick={() => { if (!isMock) { setEditingNoteId(note.id); setEditNoteContent(note.content) } }}
                      className={`text-sm text-text-secondary leading-6 whitespace-pre-wrap ${!isMock ? 'cursor-pointer hover:text-text-primary' : ''}`}
                    >
                      {note.content}
                    </p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[11px] text-text-tertiary font-mono">{formatDateTime(note.updatedAt)}</span>
                      {!isMock && (
                        <button onClick={() => deleteNoteBlock(note.id)} className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-accent-red transition-all p-1">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {noteblocks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-text-tertiary">
                <StickyNote size={28} className="mb-2 opacity-50" />
                <p className="text-sm">还没有备注</p>
              </div>
            )}
          </div>
        </div>

        {/* Todos */}
        <div className="glass-panel motion-card rounded-[32px] p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-5">
            <CheckSquare size={18} className="text-status-completed" />
            <h2 className="text-xl font-semibold">待办事项</h2>
            <span className="text-xs text-text-tertiary ml-auto">
              {todos.filter(t => t.completed).length}/{todos.length}
            </span>
          </div>
          {!isMock && (
            <div className="flex gap-2 mb-4">
              <input
                value={newTodoContent}
                onChange={e => setNewTodoContent(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createTodo() }}
                className="motion-focus flex-1 bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary"
                placeholder="添加一个待办..."
              />
              <button
                onClick={createTodo}
                disabled={!newTodoContent.trim()}
                className="motion-press bg-text-primary text-primary rounded-full w-9 h-9 grid place-items-center transition-opacity hover:opacity-90 disabled:opacity-30 flex-shrink-0"
              >
                <Plus size={16} />
              </button>
            </div>
          )}
          <div className="space-y-2 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar flex-1">
            {todos.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 group transition-colors hover:bg-bg-tertiary">
                <button
                  onClick={() => toggleTodo(todo)}
                  disabled={isMock}
                  className={`flex-shrink-0 transition-colors ${todo.completed ? 'text-status-completed' : 'text-text-tertiary hover:text-text-secondary'}`}
                >
                  {todo.completed ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
                <span className={`text-sm flex-1 ${todo.completed ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>
                  {todo.content}
                </span>
                {!isMock && (
                  <button onClick={() => deleteTodo(todo.id)} className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-accent-red transition-all p-1 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {todos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-text-tertiary">
                <CheckSquare size={28} className="mb-2 opacity-50" />
                <p className="text-sm">还没有待办事项</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {editingCommit && (
        <CommitEditor
          commit={editingCommit}
          onSetCover={(imagePath) => setCoverFromPath(imagePath)}
          onClose={() => setEditingCommit(null)}
          onSaved={() => {
            setEditingCommit(null)
            loadData()
          }}
          onChanged={loadData}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDeleteCommitId !== null}
        title="删除提交"
        message="确定要删除这条提交吗？此操作无法撤销。"
        onConfirm={async () => {
          if (pendingDeleteCommitId) {
            await window.ipcRenderer.invoke('delete-commit', pendingDeleteCommitId)
            setPendingDeleteCommitId(null)
            loadData()
          }
        }}
        onCancel={() => setPendingDeleteCommitId(null)}
      />
    </AnimatedPage>
  )
}

function CommitCard({ commit, onEdit, onDelete, onSetCover, isNew }: { commit: ProjectCommit; onEdit: () => void; onDelete: () => void; onSetCover: (path: string) => void; isNew?: boolean }) {
  return (
    <article className={`motion-card commit-card relative bg-bg-secondary border border-border-subtle rounded-[24px] p-5 transition-all duration-[220ms] hover:bg-bg-tertiary before:absolute before:-left-[31px] before:top-6 before:w-4 before:h-4 before:rounded-full before:bg-status-completed before:border-[4px] before:border-[#111318] ${isNew ? 'commit-card-new ritual-timeline' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-lg">{commit.title}</h3>
          <p className="text-sm text-text-secondary mt-2 leading-6 whitespace-pre-wrap">{commit.description || '没有补充描述。'}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-text-tertiary hover:text-text-primary p-2 transition-colors"><Save size={15} /></button>
          <button onClick={onDelete} className="text-text-tertiary hover:text-accent-red p-2 transition-colors"><Trash2 size={15} /></button>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4 text-xs text-text-tertiary font-mono">
        <span>{formatDateTime(commit.createdAt)}</span>
        {commit.progressDelta !== 0 && <span>{commit.progressDelta > 0 ? '+' : ''}{commit.progressDelta}%</span>}
      </div>
      {(commit.images || []).length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          {commit.images?.map(image => (
            <button key={image.id} onClick={() => onSetCover(image.imagePath)} className="aspect-video rounded-2xl overflow-hidden bg-bg-tertiary border border-border-subtle group">
              <SafeImage src={image.imagePath} alt={image.caption || commit.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

function CommitEditor({
  commit,
  onClose,
  onSaved,
  onChanged,
  onSetCover,
}: {
  commit: ProjectCommit
  onClose: () => void
  onSaved: () => void
  onChanged: () => void
  onSetCover: (imagePath: string) => void
}) {
  const [title, setTitle] = useState(commit.title)
  const [description, setDescription] = useState(commit.description)
  const [progressDelta, setProgressDelta] = useState(String(commit.progressDelta || ''))
  const [images, setImages] = useState<CommitImage[]>(commit.images || [])
  const [caption, setCaption] = useState('')
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState<string | null>(null)

  const save = async () => {
    if (!title.trim()) return
    await window.ipcRenderer.invoke('update-commit', commit.id, {
      title: title.trim(),
      description: description.trim(),
      progressDelta: Number(progressDelta) || 0,
    })
    onSaved()
  }

  const addImage = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path) {
      const id = await window.ipcRenderer.invoke('add-commit-image', commit.id, path, caption.trim())
      setImages(prev => [...prev, { id, commitId: commit.id, imagePath: path, caption: caption.trim(), sortIndex: prev.length, createdAt: Date.now() }])
      setCaption('')
      onChanged()
    }
  }

  const deleteImage = (imageId: string) => {
    setPendingDeleteImageId(imageId)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end editor-backdrop">
      <aside className="editor-panel w-[500px] h-full bg-[#111318] border-l border-border-primary p-6 shadow-2xl overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">编辑提交</h2>
          <button onClick={onClose} className="motion-action text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} className="motion-focus w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="motion-focus w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none h-40 resize-none" />
          <input value={progressDelta} onChange={e => setProgressDelta(e.target.value)} className="motion-focus w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none font-mono" placeholder="进度变化" />
          <div className="bg-bg-secondary border border-border-subtle rounded-[24px] p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold">提交截图</h3>
                <p className="text-xs text-text-tertiary mt-1">图片只保存本地路径，点击星标可设为项目封面。</p>
              </div>
              <span className="text-xs text-text-tertiary font-mono">{images.length}</span>
            </div>
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              className="motion-focus w-full bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-xs outline-none mb-3"
              placeholder="新截图说明，可选"
            />
            <button onClick={addImage} className="motion-action w-full bg-bg-tertiary border border-border-subtle rounded-full px-4 py-3 text-sm text-text-secondary hover:text-text-primary flex items-center justify-center gap-2">
              <ImagePlus size={15} /> 添加截图路径
            </button>
            <div className="space-y-3 mt-4">
              {images.map(image => (
                <div key={image.id} className="grid grid-cols-[112px_1fr_auto] gap-3 items-center">
                  <div className="aspect-video rounded-2xl overflow-hidden bg-bg-tertiary border border-border-subtle">
                    <SafeImage src={image.imagePath} alt={image.caption || title} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-text-secondary truncate">{image.caption || '未命名截图'}</p>
                    <p className="text-[11px] text-text-tertiary font-mono truncate mt-1">{image.imagePath}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => onSetCover(image.imagePath)} className="motion-action p-2 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary" title="设为封面">
                      <Star size={14} />
                    </button>
                    <button onClick={() => deleteImage(image.id)} className="motion-action p-2 rounded-full text-text-tertiary hover:text-accent-red hover:bg-bg-tertiary" title="删除截图">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {images.length === 0 && <p className="py-5 text-center text-sm text-text-tertiary">这条提交还没有截图。</p>}
            </div>
          </div>
          <button onClick={save} disabled={!title.trim()} className="motion-action w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold disabled:opacity-40">保存修改</button>
        </div>
      </aside>

      <ConfirmDialog
        isOpen={pendingDeleteImageId !== null}
        title="移除截图"
        message="确定要从这条提交中移除这张截图吗？"
        onConfirm={async () => {
          if (pendingDeleteImageId) {
            await window.ipcRenderer.invoke('delete-commit-image', pendingDeleteImageId)
            setImages(prev => prev.filter(image => image.id !== pendingDeleteImageId))
            setPendingDeleteImageId(null)
            onChanged()
          }
        }}
        onCancel={() => setPendingDeleteImageId(null)}
      />
    </div>
  )
}

function CommitHeatmap({ commits, pulseTimestamp }: { commits: ProjectCommit[]; pulseTimestamp?: number }) {
  const counts = useMemo(() => groupCommitsByDay(commits), [commits])
  const pulseKey = pulseTimestamp ? formatDateKey(pulseTimestamp) : ''
  const days = useMemo(() => {
    return Array.from({ length: 70 }).map((_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (69 - index))
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const count = counts.get(key) || 0
      return { key, count, level: getActivityLevel(count) }
    })
  }, [counts])

  return (
    <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1">
      {days.map(day => {
        const className = ['bg-bg-tertiary', 'bg-status-completed/25', 'bg-status-completed/45', 'bg-status-completed/70', 'bg-status-completed'][day.level]
        return <span key={`${day.key}:${day.key === pulseKey ? pulseTimestamp : 'stable'}`} title={`${day.key}: ${day.count} 次提交`} className={`aspect-square rounded-[5px] ${className} ${day.key === pulseKey ? 'heatmap-pulse' : ''}`} />
      })}
    </div>
  )
}
