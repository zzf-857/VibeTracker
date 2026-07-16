import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckSquare, Clock3, GitCommit, Loader2, PlayCircle, RefreshCcw, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { LaunchButton } from '../components/LaunchButton'
import { Skeleton } from '../components/Skeleton'
import type { DashboardSummary, Project } from '../types'
import { formatDateTime } from '../lib/projectView'
import { useNotifications } from '../lib/notifications'
import { useStore } from '../lib/store'

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState('')
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null)
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const { projects, refresh } = useStore()

  const load = useCallback(() => {
    setLoadError('')
    return window.vibe.dashboard.get().then(setSummary).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      notify({ tone: 'error', title: '首页加载失败', detail: message })
    })
  }, [notify])
  useEffect(() => { void load() }, [load, projects])
  useEffect(() => {
    const states = new Map<string, string>()
    return window.vibe.launch.onState(state => {
      if (states.get(state.profileId) === state.state) return
      states.set(state.profileId, state.state)
      void load()
    })
  }, [load])

  const retrySync = async (projectId: string) => {
    setSyncingProjectId(projectId)
    try {
      const result = await window.vibe.git.sync(projectId)
      await refresh()
      await load()
      notify({ tone: 'success', title: result.inserted ? `发现 ${result.inserted} 个新提交` : 'Git 已是最新状态' })
    } catch (error) {
      notify({ tone: 'error', title: 'Git 同步失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setSyncingProjectId(null)
    }
  }

  if (!summary && loadError) return <div className="min-h-full grid place-items-center p-8"><div className="max-w-md text-center"><AlertTriangle size={34} className="mx-auto text-accent-red" /><h1 className="text-xl font-semibold mt-4">首页加载失败</h1><p className="text-sm text-text-tertiary mt-2 break-words">{loadError}</p><button onClick={() => void load()} className="mt-5 h-10 px-4 rounded-lg border border-border-primary text-sm inline-flex items-center gap-2"><RefreshCcw size={14} />重试加载</button></div></div>
  if (!summary) return <DashboardSkeleton />

  const actions = [
    { label: '待处理 Git', value: summary.counts.pendingGit, icon: GitCommit, tone: 'text-accent-blue' },
    { label: '待审核草稿', value: summary.counts.pendingDrafts, icon: Sparkles, tone: 'text-accent-blue' },
    { label: '未完成待办', value: summary.counts.openTodos, icon: CheckSquare, tone: 'text-accent-orange' },
    { label: '可启动项目', value: summary.counts.launchable, icon: PlayCircle, tone: 'text-status-completed' },
    { label: '同步/启动异常', value: summary.failures.length + summary.launchFailures.length, icon: AlertTriangle, tone: summary.failures.length + summary.launchFailures.length ? 'text-accent-red' : 'text-text-tertiary' },
  ]

  return (
    <AnimatedPage tone="standard" className="w-full min-h-full px-6 py-7 lg:px-8 xl:px-10">
      <header><h1 className="text-3xl font-semibold">今天从哪里继续？</h1><p className="text-sm text-text-secondary mt-2">聚焦需要处理的同步、草稿、启动与待办。</p></header>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mt-7">
        {actions.map(item => <div key={item.label} className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-4"><item.icon size={17} className={item.tone} /><p className="text-2xl font-semibold mt-4">{item.value}</p><p className="text-xs text-text-tertiary mt-1">{item.label}</p></div>)}
      </div>

      <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-4 mt-5">
        <Section title="待处理 Git 提交" icon={<GitCommit size={16} />} empty="当前没有需要归档或忽略的 Git 提交。">
          {summary.recentGit.map(commit => <button key={`${commit.projectId}:${commit.sha}`} onClick={() => navigate(`/project/${commit.projectId}?tab=records&view=git&sha=${commit.sha}`)} className="w-full py-3 flex items-center gap-3 text-left border-b border-border-subtle last:border-0 hover:bg-bg-tertiary/40 px-2 rounded-lg">{!commit.seenAt && <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0" aria-label="未读" />}<code className="text-xs text-accent-blue">{commit.sha.slice(0, 7)}</code><span className="min-w-0 flex-1"><strong className="block text-sm font-medium truncate">{commit.subject}</strong><span className="block text-[11px] text-text-tertiary mt-1">{commit.projectName} · {formatDateTime(commit.authoredAt)}</span></span><ArrowRight size={14} className="text-text-tertiary" /></button>)}
        </Section>

        <Section title="待审核 AI 草稿" icon={<Sparkles size={16} />} empty="当前没有待审核草稿。">
          {summary.pendingReview.map(project => <ProjectAction key={project.id} project={project} detail={`${project.draftCount} 条草稿等待审核`} onClick={() => navigate(`/project/${project.id}?tab=records`)} />)}
        </Section>

        <Section title="最近活跃" icon={<Clock3 size={16} />} empty="导入项目后，这里会显示最近活动。">
          {summary.recentProjects.map(project => <ProjectAction key={project.id} project={project} detail={project.recentRecord?.title || '尚无开发记录'} onClick={() => navigate(`/project/${project.id}`)} />)}
        </Section>

        <Section title="未完成待办" icon={<CheckSquare size={16} />} empty="当前没有未完成待办。">
          {summary.openTodos.map(todo => <button key={todo.id} onClick={() => navigate(`/project/${todo.projectId}?tab=notes`)} className="w-full py-3 px-2 flex items-center gap-3 text-left border-b border-border-subtle last:border-0 hover:bg-bg-tertiary/40 rounded-lg"><span className="w-4 h-4 rounded border border-border-primary" /><span className="min-w-0 flex-1"><strong className="block text-sm font-medium truncate">{todo.content}</strong><span className="block text-[11px] text-text-tertiary mt-1">{todo.projectName}</span></span><ArrowRight size={14} className="text-text-tertiary" /></button>)}
        </Section>

        <Section title="可启动项目" icon={<PlayCircle size={16} />} empty="在项目设置中确认启动配置后，可从这里直接启动。">
          {summary.launchableProjects.map(project => <div key={project.id} className="py-2.5 px-2 flex items-center justify-between gap-3 border-b border-border-subtle last:border-0"><button onClick={() => navigate(`/project/${project.id}`)} className="min-w-0 text-left"><strong className="text-sm font-medium truncate block">{project.name}</strong><span className="text-[11px] text-text-tertiary">独立于项目阶段，可随时启动</span></button><LaunchButton compact capability={project.launchCapability} onConfigure={() => navigate(`/project/${project.id}?tab=settings`)} /></div>)}
        </Section>
      </div>

      {(summary.failures.length > 0 || summary.launchFailures.length > 0) && <section className="mt-4 rounded-xl border border-accent-red/25 bg-accent-red/[0.06] p-4"><h2 className="text-sm font-semibold text-accent-red flex items-center gap-2"><AlertTriangle size={16} />需要处理</h2><div className="mt-2 grid md:grid-cols-2 gap-2">{summary.failures.map(project => <div key={project.id} className="rounded-lg bg-bg-primary/50 px-3 py-2 flex items-center gap-3"><button onClick={() => navigate(`/project/${project.id}`)} className="min-w-0 flex-1 text-left"><strong className="text-sm">{project.name}</strong><span className="block text-xs text-text-tertiary mt-1 truncate">{project.gitSync?.error || '同步失败'}</span></button><button onClick={() => void retrySync(project.id)} disabled={syncingProjectId === project.id} aria-label={`重试同步 ${project.name}`} className="h-8 px-2.5 rounded-lg border border-accent-red/25 text-xs text-accent-red flex items-center gap-1.5 disabled:opacity-50">{syncingProjectId === project.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}重试</button></div>)}{summary.launchFailures.map(failure => <button key={failure.profileId} onClick={() => navigate(`/project/${failure.projectId}?tab=settings&profile=${failure.profileId}`)} className="text-left rounded-lg bg-bg-primary/50 px-3 py-2"><strong className="text-sm">启动失败</strong><span className="block text-xs text-text-tertiary mt-1 truncate">{failure.error}</span></button>)}</div></section>}
    </AnimatedPage>
  )
}

function Section({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-4 min-h-64"><h2 className="text-sm font-semibold flex items-center gap-2">{icon}{title}</h2><div className="mt-3">{hasChildren ? children : <p className="text-sm text-text-tertiary py-12 text-center">{empty}</p>}</div></section>
}

function ProjectAction({ project, detail, onClick }: { project: Project; detail: string; onClick: () => void }) {
  return <button onClick={onClick} className="w-full py-3 px-2 flex items-center justify-between gap-3 text-left border-b border-border-subtle last:border-0 hover:bg-bg-tertiary/40 rounded-lg"><span className="min-w-0"><strong className="block text-sm font-medium truncate">{project.name}</strong><span className="block text-[11px] text-text-tertiary mt-1 truncate">{detail}</span></span><ArrowRight size={14} className="text-text-tertiary" /></button>
}

function DashboardSkeleton() {
  return <div className="p-6 lg:p-8 space-y-5"><div className="space-y-2"><Skeleton className="h-9 w-72 max-w-full rounded" /><Skeleton className="h-4 w-96 max-w-full rounded" /></div><div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">{[1, 2, 3, 4, 5].map(item => <Skeleton key={item} className="h-32 rounded-xl" />)}</div><div className="grid lg:grid-cols-2 gap-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-64 rounded-xl" />)}</div></div>
}
