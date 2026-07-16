import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, FolderOpen, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LaunchButton } from '../components/LaunchButton'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'
import { useNotifications } from '../lib/notifications'
import type { Project } from '../types'
import { AiSyncDialog } from './project-detail/AiSyncDialog'
import { DevelopmentRecordsTab } from './project-detail/DevelopmentRecordsTab'
import { NotesTodosTab } from './project-detail/NotesTodosTab'
import { ProjectOverviewTab } from './project-detail/ProjectOverviewTab'
import { ProjectSettingsTab } from './project-detail/ProjectSettingsTab'

type TabId = 'overview' | 'records' | 'notes' | 'settings'

export function ProjectHubDetail() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { statuses, tags, refresh } = useStore()
  const { notify } = useNotifications()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiOpen, setAiOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadError, setLoadError] = useState('')
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  const deletingRef = useRef(false)
  const tab = (['overview', 'records', 'notes', 'settings'].includes(searchParams.get('tab') || '')
    ? searchParams.get('tab')
    : 'overview') as TabId

  const load = useCallback(async () => {
    if (!id) return
    setLoadError('')
    try {
      const data = await window.vibe.projects.get(id)
      setProject(data)
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      notify({ tone: 'error', title: '项目加载失败', detail: message })
    } finally {
      setLoading(false)
    }
  }, [id, refresh, notify])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!moreOpen) return
    const menu = moreMenuRef.current
    const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') || [])]
    const focusItem = (index: number) => {
      const candidates = items()
      if (!candidates.length) return
      candidates[(index + candidates.length) % candidates.length].focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const candidates = items()
      const currentIndex = candidates.findIndex(item => item === document.activeElement)
      if (event.key === 'Escape') {
        event.preventDefault()
        setMoreOpen(false)
        moreButtonRef.current?.focus()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusItem(currentIndex + 1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusItem(currentIndex - 1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusItem(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusItem(candidates.length - 1)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => focusItem(0))
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const changeTab = (next: TabId) => {
    setMoreOpen(false)
    setSearchParams(next === 'overview' ? {} : { tab: next })
  }
  const changed = async () => {
    setRefreshKey(value => value + 1)
    await load()
  }

  if (loading) return <DetailSkeleton />
  if (!project && loadError) {
    return (
      <div className="min-h-full grid place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">项目加载失败</h1>
          <p className="text-sm text-text-tertiary mt-2 break-words">{loadError}</p>
          <button onClick={() => { setLoading(true); void load() }} className="mt-5 h-10 px-4 rounded-lg border border-border-primary text-sm">重试加载</button>
        </div>
      </div>
    )
  }
  if (!project) return <div className="p-10 text-text-secondary">项目不存在或已被删除。</div>

  const deleteProject = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      const result = await window.vibe.projects.delete(project.id)
      await refresh()
      navigate('/projects')
      if (result.assetFailures.length) {
        notify({
          tone: 'error',
          title: '项目已删除，但部分托管资产待后台重试清理',
          detail: result.assetFailures.map(item => String((item as { path?: string }).path || '')).filter(Boolean).join('；'),
        })
      } else {
        notify({ tone: 'success', title: '项目已删除' })
      }
    } catch (error) {
      notify({ tone: 'error', title: '项目删除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const openProjectDirectory = async () => {
    setMoreOpen(false)
    try {
      const result = await window.vibe.projects.openDirectory(project.id)
      if (!result.ok) throw new Error(result.reason || '系统未能打开项目目录')
    } catch (error) {
      notify({ tone: 'error', title: '打开项目目录失败', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  const openRemoteRepository = async () => {
    setMoreOpen(false)
    try {
      await window.vibe.projects.openRemote(project.id)
    } catch (error) {
      notify({ tone: 'error', title: '打开远端仓库失败', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <AnimatedPage tone="detail" className="w-full min-h-full px-6 py-6 lg:px-8 xl:px-10">
      <button onClick={() => navigate('/projects')} className="h-9 px-2 -ml-2 rounded-lg text-sm text-text-tertiary hover:text-text-primary flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-accent-blue">
        <ArrowLeft size={15} />返回项目
      </button>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold truncate">{project.name}</h1>
            {project.statusInfo && <span className="text-xs px-2.5 py-1 rounded-md" style={{ color: project.statusInfo.color, backgroundColor: `${project.statusInfo.color}16` }}>{project.statusInfo.name}</span>}
          </div>
          <p className="text-sm text-text-secondary mt-2 line-clamp-2 max-w-3xl">{project.description || '还没有项目简介。'}</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => project.gitSync?.status === 'unavailable' ? changeTab('settings') : setAiOpen(true)} className="h-10 px-4 rounded-lg border border-accent-blue/35 bg-accent-blue/10 text-accent-blue text-sm font-medium flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-accent-blue">
            <Sparkles size={15} />{project.gitSync?.status === 'unavailable' ? '关联 Git 后使用 AI' : 'AI 同步'}
          </button>
          <LaunchButton capability={project.launchCapability} onConfigure={() => changeTab('settings')} />
          <div className="relative">
            <button
              ref={moreButtonRef}
              aria-label="更多项目操作"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-controls="project-more-menu"
              onClick={() => setMoreOpen(value => !value)}
              className="w-10 h-10 rounded-lg border border-border-subtle bg-bg-tertiary grid place-items-center text-text-secondary"
            >
              <MoreHorizontal size={17} />
            </button>
            {moreOpen && (
              <div id="project-more-menu" ref={moreMenuRef} role="menu" aria-label="更多项目操作" className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-border-subtle bg-bg-secondary p-1 shadow-xl">
                <button role="menuitem" disabled={!(project.canonicalPath || project.path)} onClick={() => void openProjectDirectory()} className="w-full h-9 px-3 rounded-lg text-sm text-left flex items-center gap-2 hover:bg-bg-tertiary disabled:opacity-40"><FolderOpen size={14} />打开项目目录</button>
                <button role="menuitem" disabled={!project.repoUrl} onClick={() => void openRemoteRepository()} className="w-full h-9 px-3 rounded-lg text-sm text-left flex items-center gap-2 hover:bg-bg-tertiary disabled:opacity-40"><ExternalLink size={14} />打开远端仓库</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); setDeleteOpen(true) }} className="w-full h-9 px-3 rounded-lg text-sm text-left flex items-center gap-2 text-accent-red hover:bg-accent-red/10"><Trash2 size={14} />删除项目</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="mt-7 border-b border-border-subtle flex items-center gap-1 overflow-x-auto" aria-label="项目详情分区">
        {([['overview', '概览'], ['records', `开发记录${project.draftCount ? ` · ${project.draftCount}` : ''}`], ['notes', '备注与待办'], ['settings', '项目设置']] as Array<[TabId, string]>).map(([key, label]) => (
          <button key={key} onClick={() => changeTab(key)} aria-current={tab === key ? 'page' : undefined} className={`h-11 px-4 border-b-2 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${tab === key ? 'border-text-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}>
            {label}
          </button>
        ))}
      </nav>

      <main className="mt-5 pb-10">
        {tab === 'overview'
          ? <ProjectOverviewTab project={project} onReload={changed} />
          : tab === 'records'
            ? <DevelopmentRecordsTab project={project} refreshKey={refreshKey} onChanged={changed} />
            : tab === 'notes'
              ? <NotesTodosTab project={project} onReload={changed} />
              : <ProjectSettingsTab project={project} statuses={statuses} tags={tags} onReload={changed} />}
      </main>

      <AiSyncDialog open={aiOpen} project={project} onClose={() => { setAiOpen(false); void changed() }} onChanged={changed} />
      <ConfirmDialog
        isOpen={deleteOpen}
        title="删除项目"
        message={`确认删除「${project.name}」？应用托管的截图会一并清理，本地项目目录和外部图片不会被删除。`}
        confirmText="删除项目"
        pending={deleting}
        onConfirm={() => void deleteProject()}
        onCancel={() => { if (!deleting) setDeleteOpen(false) }}
      />
    </AnimatedPage>
  )
}

function DetailSkeleton() {
  return (
    <div className="p-6 lg:p-8 space-y-5">
      <Skeleton className="h-9 w-24 rounded" />
      <div className="flex flex-wrap justify-between gap-4">
        <div className="space-y-2 min-w-0 flex-1">
          <Skeleton className="h-10 w-72 max-w-full rounded" />
          <Skeleton className="h-4 w-full max-w-[480px] rounded" />
        </div>
        <Skeleton className="h-10 w-72 max-w-full rounded" />
      </div>
      <Skeleton className="h-12 w-full rounded" />
      <div className="grid md:grid-cols-2 gap-4">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}
