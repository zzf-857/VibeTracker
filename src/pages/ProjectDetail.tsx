import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Project, ProjectCommit, ProjectStatus } from '../types'
import { ArrowLeft, Camera, ImagePlus, Plus, Save, Trash2, X } from 'lucide-react'
import { formatDateTime, getActivityLevel, getProjectCover, groupCommitsByDay, toImageSrc } from '../lib/projectView'

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

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    if (!id) return
    const [p, s] = await Promise.all([
      window.ipcRenderer.invoke('get-project', id),
      window.ipcRenderer.invoke('get-statuses'),
    ])
    setProject(p)
    setStatuses(s)
  }

  const commits = project?.commits || []
  const cover = project ? getProjectCover(project) : ''

  const createCommit = async () => {
    if (!project || !commitTitle.trim()) return
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
    await window.ipcRenderer.invoke('update-project', project.id, { status: statusId })
    loadData()
  }

  const setCoverFromPath = async (imagePath: string) => {
    if (!project) return
    await window.ipcRenderer.invoke('update-project', project.id, { coverImagePath: imagePath })
    loadData()
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
              <div>
                <p className="text-text-tertiary text-sm mb-2">Project Dossier</p>
                <h1 className="text-[38px] font-semibold tracking-normal">{project.name}</h1>
              </div>
              <select
                value={project.status}
                onChange={e => updateStatus(e.target.value)}
                className="bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2 text-sm outline-none"
                style={{ color: project.statusInfo?.color || undefined }}
              >
                {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
              </select>
            </div>
            <p className="text-text-secondary leading-7 mt-5 max-w-3xl">{project.description || '这个项目还没有简介。可以在之后的编辑面板里补充它的故事。'}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-6">
            <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary">{commits.length} 次提交</span>
            <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-secondary font-mono">updated {formatDateTime(project.updatedAt)}</span>
            {project.path && <span className="px-3 py-1.5 rounded-full bg-bg-tertiary border border-border-subtle text-sm text-text-tertiary font-mono truncate max-w-[420px]">{project.path}</span>}
          </div>
        </div>

        <div className="glass-panel rounded-[32px] overflow-hidden min-h-[260px]">
          {cover ? (
            <div className="relative h-full min-h-[260px] group">
              <img src={toImageSrc(cover)} className="w-full h-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                <button onClick={() => setCoverFromPath('')} className="text-xs text-white/80 hover:text-white">清除手动封面</button>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[260px] p-6 flex flex-col justify-end text-text-tertiary bg-bg-tertiary/40">
              <Camera size={34} className="mb-4 opacity-70" />
              <p className="text-sm">添加带截图的 commit 后，这里会自动显示项目封面。</p>
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
              <button onClick={createCommit} className="ml-auto bg-text-primary text-primary rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-opacity hover:opacity-90">
                <Plus size={15} /> 提交
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
                  <img src={toImageSrc(image.imagePath)} className="w-full h-full object-cover" />
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
          onClose={() => setEditingCommit(null)}
          onSaved={() => {
            setEditingCommit(null)
            loadData()
          }}
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
              <img src={toImageSrc(image.imagePath)} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

function CommitEditor({ commit, onClose, onSaved }: { commit: ProjectCommit; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(commit.title)
  const [description, setDescription] = useState(commit.description)
  const [progressDelta, setProgressDelta] = useState(String(commit.progressDelta || ''))

  const save = async () => {
    await window.ipcRenderer.invoke('update-commit', commit.id, {
      title,
      description,
      progressDelta: Number(progressDelta) || 0,
    })
    onSaved()
  }

  const addImage = async () => {
    const path = await window.ipcRenderer.invoke('select-image')
    if (path) {
      await window.ipcRenderer.invoke('add-commit-image', commit.id, path)
      onSaved()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
      <aside className="w-[460px] h-full bg-[#111318] border-l border-border-primary p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">编辑提交</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none h-40 resize-none" />
          <input value={progressDelta} onChange={e => setProgressDelta(e.target.value)} className="w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none font-mono" placeholder="进度变化" />
          <button onClick={addImage} className="w-full bg-bg-secondary border border-border-subtle rounded-full px-4 py-3 text-sm text-text-secondary hover:text-text-primary flex items-center justify-center gap-2">
            <ImagePlus size={15} /> 添加截图路径
          </button>
          <button onClick={save} className="w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold">保存修改</button>
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
      const key = date.toISOString().slice(0, 10)
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
