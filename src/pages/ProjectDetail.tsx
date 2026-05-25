import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CommitImage, Project, ProjectCommit, ProjectStatus } from '../types'
import { ArrowLeft, Camera, Folder, ImagePlus, Pencil, Plus, RotateCcw, Save, Star, Trash2, X } from 'lucide-react'
import { SafeImage } from '../components/SafeImage'
import { formatDateTime, getActivityLevel, getProjectCover, groupCommitsByDay } from '../lib/projectView'
import { MOCK_MODE_LABEL, getMockProject, isMockProjectId, mockStatuses } from '../lib/mockData'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [progressDelta, setProgressDelta] = useState('')
  const [commitImagePath, setCommitImagePath] = useState('')
  const [editingCommit, setEditingCommit] = useState<ProjectCommit | null>(null)
  const [isEditingProject, setIsEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ name: '', description: '', path: '' })

  useEffect(() => {
    loadData()
  }, [id])

  useEffect(() => {
    if (!project) return
    setProjectDraft({
      name: project.name || '',
      description: project.description || '',
      path: project.path || '',
    })
  }, [project?.id])

  const loadData = async () => {
    if (!id) return
    const [p, s] = await Promise.all([
      window.ipcRenderer.invoke('get-project', id),
      window.ipcRenderer.invoke('get-statuses'),
    ])
    const mockProject = !p && isMockProjectId(id) ? getMockProject(id) : null
    setProject(mockProject || p)
    setStatuses(mockProject ? mockStatuses : s)
  }

  const commits = project?.commits || []
  const cover = project ? getProjectCover(project) : ''

  const createCommit = async () => {
    if (!project || !commitTitle.trim()) return
    if (isMockProjectId(project.id)) return
    await window.ipcRenderer.invoke('create-commit', {
      projectId: project.id,
      title: commitTitle.trim(),
      description: commitDescription.trim(),
      progressDelta: Number(progressDelta) || 0,
      imagePath: commitImagePath.trim(),
    })
    setCommitTitle('')
    setCommitDescription('')
    setProgressDelta('')
    setCommitImagePath('')
    loadData()
  }

  const selectCommitImage = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path) setCommitImagePath(path)
  }

  const updateStatus = async (statusId: string) => {
    if (!project) return
    if (isMockProjectId(project.id)) return
    await window.ipcRenderer.invoke('update-project', project.id, { status: statusId })
    loadData()
  }

  const saveProject = async () => {
    if (!project || !projectDraft.name.trim()) return
    if (isMockProjectId(project.id)) return
    await window.ipcRenderer.invoke('update-project', project.id, {
      name: projectDraft.name.trim(),
      description: projectDraft.description.trim(),
      path: projectDraft.path.trim(),
    })
    setIsEditingProject(false)
    loadData()
  }

  const setCoverFromPath = async (imagePath: string) => {
    if (!project) return
    if (isMockProjectId(project.id)) return
    await window.ipcRenderer.invoke('update-project', project.id, { coverImagePath: imagePath })
    loadData()
  }

  const selectManualCover = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path) setCoverFromPath(path)
  }

  if (!project) return <div className="p-10 text-text-secondary">正在读取项目...</div>

  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-7">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-text-tertiary hover:text-text-primary self-start transition-colors">
        <ArrowLeft size={16} /> 返回
      </button>

      <section className="grid grid-cols-[1fr_360px] gap-6">
        <div className="glass-panel rounded-[32px] p-7 min-h-[260px] flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-text-tertiary text-sm">Project Dossier</p>
                  {isMockProjectId(project.id) && <span className="px-2.5 py-1 rounded-full bg-white/[0.08] border border-border-subtle text-[11px] text-text-secondary">{MOCK_MODE_LABEL}</span>}
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
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={project.status}
                  onChange={e => updateStatus(e.target.value)}
                  disabled={isMockProjectId(project.id)}
                  className="bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2 text-sm outline-none"
                  style={{ color: project.statusInfo?.color || undefined }}
                >
                  {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
                <button
                  onClick={() => setIsEditingProject(prev => !prev)}
                  disabled={isMockProjectId(project.id)}
                  className="w-9 h-9 rounded-full bg-bg-tertiary border border-border-subtle text-text-secondary hover:text-text-primary grid place-items-center transition-colors"
                  title={isEditingProject ? '收起编辑' : '编辑项目'}
                >
                  {isEditingProject ? <X size={15} /> : <Pencil size={15} />}
                </button>
              </div>
            </div>
            {isEditingProject ? (
              <div className="mt-5 space-y-3">
                <textarea
                  value={projectDraft.description}
                  onChange={e => setProjectDraft(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded-[22px] px-4 py-3 text-sm leading-6 outline-none focus:border-border-primary resize-none h-28"
                  placeholder="这个项目想解决什么？当前做到哪里了？"
                />
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <input
                    value={projectDraft.path}
                    onChange={e => setProjectDraft(prev => ({ ...prev, path: e.target.value }))}
                    className="bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono"
                    placeholder="本地项目路径，可选"
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
            {project.path && <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-tertiary font-mono truncate max-w-[420px] flex items-center gap-2"><Folder size={13} /> {project.path}</span>}
          </div>
        </div>

        <div className="glass-panel rounded-[32px] overflow-hidden min-h-[260px]">
          {cover ? (
            <div className="relative h-full min-h-[260px] group">
              <SafeImage src={cover} alt={`${project.name} 封面`} className="w-full h-full object-cover" />
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

      <section className="grid grid-cols-[1.1fr_0.9fr] gap-6 min-h-[520px]">
        <div className="glass-panel rounded-[32px] p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-semibold">进展时间线</h2>
              <p className="text-sm text-text-tertiary mt-1">每次 vibecoding 后写一条 commit。</p>
            </div>
          </div>

          <div className="bg-bg-secondary border border-border-subtle rounded-[26px] p-4 mb-6">
            <div className="grid grid-cols-[1fr_120px] gap-3 mb-3">
              <input value={commitTitle} onChange={e => setCommitTitle(e.target.value)} className="bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary" placeholder="提交标题，例如：完成项目详情页定调" />
              <input value={progressDelta} onChange={e => setProgressDelta(e.target.value)} className="bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-primary font-mono" placeholder="+0" />
            </div>
            <textarea value={commitDescription} onChange={e => setCommitDescription(e.target.value)} className="w-full bg-bg-tertiary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none focus:border-border-primary resize-none h-20" placeholder="描述这次推进了什么、为什么重要..." />
            <div className="flex items-center gap-2 mt-3">
              <button onClick={selectCommitImage} className="px-4 py-2 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors">
                <ImagePlus size={15} /> 选择截图
              </button>
              {commitImagePath && <span className="text-xs text-text-tertiary truncate flex-1 font-mono">{commitImagePath}</span>}
              <button onClick={createCommit} disabled={isMockProjectId(project.id)} className="ml-auto bg-text-primary text-primary rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40">
                <Plus size={15} /> {isMockProjectId(project.id) ? '展示中' : '提交'}
              </button>
            </div>
          </div>

          <div className="relative pl-7 space-y-5 overflow-y-auto max-h-[540px] pr-2 custom-scrollbar before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border-primary">
            {commits.map(commit => (
              <CommitCard
                key={commit.id}
                commit={commit}
                onEdit={() => setEditingCommit(commit)}
                onDelete={async () => {
                  if (!confirm('删除这条提交？')) return
                  await window.ipcRenderer.invoke('delete-commit', commit.id)
                  loadData()
                }}
                onSetCover={(imagePath) => setCoverFromPath(imagePath)}
              />
            ))}
            {commits.length === 0 && (
              <div className="min-h-[220px] flex items-center justify-center text-text-tertiary text-sm">还没有提交，先写下第一条进展。</div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel rounded-[32px] p-6">
            <h2 className="text-xl font-semibold mb-5">提交热力图</h2>
            <CommitHeatmap commits={commits} />
          </section>
          <section className="glass-panel rounded-[32px] p-6">
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
    </div>
  )
}

function CommitCard({ commit, onEdit, onDelete, onSetCover }: { commit: ProjectCommit; onEdit: () => void; onDelete: () => void; onSetCover: (path: string) => void }) {
  return (
    <article className="relative bg-bg-secondary border border-border-subtle rounded-[24px] p-5 transition-all duration-[220ms] hover:bg-bg-tertiary before:absolute before:-left-[31px] before:top-6 before:w-4 before:h-4 before:rounded-full before:bg-status-completed before:border-[4px] before:border-[#111318]">
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

  const deleteImage = async (imageId: string) => {
    if (!confirm('从这条提交中移除这张截图？')) return
    await window.ipcRenderer.invoke('delete-commit-image', imageId)
    setImages(prev => prev.filter(image => image.id !== imageId))
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
      <aside className="w-[500px] h-full bg-[#111318] border-l border-border-primary p-6 shadow-2xl overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">编辑提交</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none h-40 resize-none" />
          <input value={progressDelta} onChange={e => setProgressDelta(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none font-mono" placeholder="进度变化" />
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
              className="w-full bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-xs outline-none mb-3"
              placeholder="新截图说明，可选"
            />
            <button onClick={addImage} className="w-full bg-bg-tertiary border border-border-subtle rounded-full px-4 py-3 text-sm text-text-secondary hover:text-text-primary flex items-center justify-center gap-2">
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
                    <button onClick={() => onSetCover(image.imagePath)} className="p-2 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary" title="设为封面">
                      <Star size={14} />
                    </button>
                    <button onClick={() => deleteImage(image.id)} className="p-2 rounded-full text-text-tertiary hover:text-accent-red hover:bg-bg-tertiary" title="删除截图">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {images.length === 0 && <p className="py-5 text-center text-sm text-text-tertiary">这条提交还没有截图。</p>}
            </div>
          </div>
          <button onClick={save} disabled={!title.trim()} className="w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold disabled:opacity-40">保存修改</button>
        </div>
      </aside>
    </div>
  )
}

function CommitHeatmap({ commits }: { commits: ProjectCommit[] }) {
  const counts = useMemo(() => groupCommitsByDay(commits), [commits])
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
        return <span key={day.key} title={`${day.key}: ${day.count} 次提交`} className={`aspect-square rounded-[5px] ${className}`} />
      })}
    </div>
  )
}
