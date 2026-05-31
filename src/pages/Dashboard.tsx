import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Clock3, FolderOpen, Plus, Sparkles } from 'lucide-react'
import { Project, ProjectCommit } from '../types'
import { useNavigate } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { SafeImage } from '../components/SafeImage'
import { formatDateKey, formatDateTime, getActivityLevel, getProjectCover, getRecentCommit, groupCommitsByDay } from '../lib/projectView'
import { MOCK_MODE_LABEL, mockCommits, mockProjects, mockStatuses } from '../lib/mockData'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'
import { InteractiveCard } from '../components/InteractiveCard'
import { useTooltip } from '../components/CustomTooltip'



function DashboardSkeleton() {
  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      {/* 头部标题区 */}
      <div className="flex items-end justify-between">
        <div className="space-y-2 w-1/3">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-10 w-48 rounded-lg" />
          <Skeleton className="h-4 w-72 rounded mt-2" />
        </div>
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>

      {/* 4个 StatCard */}
      <div className="grid grid-cols-4 gap-5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-panel rounded-[24px] p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="w-8 h-8 rounded-xl" />
            </div>
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>

      {/* 左右分栏 */}
      <div className="grid grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-[420px]">
        {/* 左栏最近活跃项目 */}
        <div className="glass-panel rounded-[30px] p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="space-y-2 w-1/4">
              <Skeleton className="h-5 w-32 rounded" />
              <Skeleton className="h-4.5 w-24 rounded" />
            </div>
            <Skeleton className="h-4 w-16 rounded" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-bg-secondary border border-border-subtle rounded-[24px] overflow-hidden h-[210px] space-y-4">
                <Skeleton className="h-24 w-full rounded-none" />
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-5 w-24 rounded" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右栏 */}
        <div className="space-y-6">
          {/* 近期提交流 */}
          <div className="glass-panel rounded-[30px] p-6 space-y-4">
            <Skeleton className="h-5 w-24 rounded" />
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="border-l border-white/[0.06] pl-4 space-y-2">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-3.5 w-32 rounded" />
                </div>
              ))}
            </div>
          </div>
          {/* 状态分布 */}
          <div className="glass-panel rounded-[30px] p-6 space-y-4">
            <Skeleton className="h-5 w-20 rounded" />
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-2.5 h-2.5 rounded-full" />
                    <Skeleton className="h-4 w-16 rounded" />
                  </div>
                  <Skeleton className="h-4 w-6 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { projects, statuses, isLoaded, refresh } = useStore()
  const [allCommits, setAllCommits] = useState<ProjectCommit[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoaded) {
      refresh()
    }
  }, [isLoaded, refresh])

  useEffect(() => {
    if (projects.length > 0) {
      Promise.all(projects.map((project: Project) => window.ipcRenderer.invoke('get-commits', project.id)))
        .then(commits => {
          setAllCommits(commits.flat())
        })
        .catch(err => {
          console.error('Failed to load commits for dashboard:', err)
        })
    }
  }, [projects])

  const isLoading = !isLoaded
  const isMockMode = !isLoading && projects.length === 0
  const displayProjects = isMockMode ? mockProjects : projects
  const displayStatuses = isMockMode ? mockStatuses : statuses
  const displayCommits = isMockMode ? mockCommits : allCommits

  const commits = useMemo(() => {
    return displayProjects
      .map(project => ({ project, commit: getRecentCommit(project) }))
      .filter(item => item.commit)
      .sort((a, b) => (b.commit?.createdAt || 0) - (a.commit?.createdAt || 0))
      .slice(0, 8) as { project: Project; commit: ProjectCommit }[]
  }, [displayProjects])

  const totalCommits = displayCommits.length || displayProjects.reduce((sum, project) => sum + (project.commitCount || 0), 0)
  const recentSevenDayCount = displayCommits.filter(commit => Date.now() - commit.createdAt <= 7 * 24 * 60 * 60 * 1000).length

  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <AnimatedPage tone="standard" className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div className="stagger-item flex items-end justify-between" style={{ '--stagger': 0 } as CSSProperties}>
        <div>
          <p className="text-text-tertiary text-sm mb-2">Vibe Progress Center</p>
          <div className="flex items-center gap-3">
            <h1 className="text-[36px] font-semibold tracking-normal">项目进展总览</h1>
            {isMockMode && <span className="px-3 py-1 rounded-full bg-white/[0.08] border border-border-subtle text-xs text-text-secondary">{MOCK_MODE_LABEL}</span>}
          </div>
          <p className="text-text-secondary text-sm mt-2">用最近提交和活跃度观察每个 vibecoding 项目的生长节奏。</p>
        </div>
        <button onClick={() => navigate('/projects')} className="bg-text-primary text-primary rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 transition-all duration-[180ms] hover:opacity-90">
          <Plus size={16} />
          创建或查看项目
        </button>
      </div>

      <div className="grid grid-cols-4 gap-5">
        <StatCard index={1} icon={<FolderOpen size={18} />} label="项目总数" value={displayProjects.length.toString()} />
        <StatCard index={2} icon={<Sparkles size={18} />} label="进展提交" value={totalCommits.toString()} />
        <StatCard index={3} icon={<Activity size={18} />} label="近 7 日提交" value={recentSevenDayCount.toString()} />
        <StatCard index={4} icon={<Clock3 size={18} />} label="自定义状态" value={displayStatuses.length.toString()} />
      </div>

      <div className="stagger-item grid grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-[420px]" style={{ '--stagger': 5 } as CSSProperties}>
        <section className="glass-panel ambient-panel rounded-[30px] p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">最近活跃项目</h2>
              <p className="text-text-tertiary text-sm mt-1">按最近更新时间排列</p>
            </div>
            <button onClick={() => navigate('/projects')} className="text-sm text-text-secondary hover:text-text-primary transition-colors">查看画廊</button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {displayProjects.slice(0, 6).map((project, idx) => (
              <InteractiveCard key={project.id} onClick={() => navigate(`/project/${project.id}`)} className="dashboard-project-card motion-card group stagger-item-fast text-left bg-bg-secondary border border-border-subtle rounded-[24px] overflow-hidden min-h-[210px] cursor-pointer" style={{ '--stagger': idx + 1 } as CSSProperties}>
                <div className="h-24 bg-bg-tertiary overflow-hidden">
                  {getProjectCover(project) ? (
                    <SafeImage src={getProjectCover(project)} alt={`${project.name} 封面`} className="w-full h-full object-cover gallery-cover" />
                  ) : (
                    <div className="h-full flex items-end p-4 text-text-tertiary text-sm">文字项目卡片</div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold truncate">{project.name}</h3>
                    {project.statusInfo && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] border border-border-subtle" style={{ color: project.statusInfo.color, backgroundColor: `${project.statusInfo.color}18` }}>{project.statusInfo.name}</span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-3 truncate">{getRecentCommit(project)?.title || project.description || '等待第一次提交'}</p>
                </div>
              </InteractiveCard>
            ))}
          </div>
          {displayProjects.length === 0 && (
            <EmptyState text="还没有项目。去项目画廊创建第一个 vibecoding 项目。" />
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel rounded-[30px] p-6 motion-card">
            <h2 className="text-lg font-semibold mb-4">近期提交流</h2>
            <div className="space-y-4">
              {commits.map(({ project, commit }, index) => (
                <button key={commit.id} onClick={() => navigate(`/project/${project.id}`)} className="recent-stream-item block w-full text-left border-l border-border-primary pl-4 transition-all duration-[180ms] hover:border-accent-blue hover:translate-x-0.5" style={{ '--stagger': index } as CSSProperties}>
                  <p className="font-medium text-sm truncate">{commit.title}</p>
                  <p className="text-xs text-text-tertiary mt-1 font-mono">{formatDateTime(commit.createdAt)} · {project.name}</p>
                </button>
              ))}
            </div>
            {commits.length === 0 && <EmptyState text="还没有提交。每次 vibecoding 后写一条进展即可。" compact />}
          </section>

          <section className="glass-panel rounded-[30px] p-6 motion-card">
            <h2 className="text-lg font-semibold mb-4">状态分布</h2>
            <div className="space-y-3">
              {displayStatuses.map(status => {
                const count = displayProjects.filter(project => project.status === status.id).length
                return (
                  <div key={status.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full breathing-dot" style={{ backgroundColor: status.color }} />
                      <span className="text-text-secondary">{status.name}</span>
                    </div>
                    <span className="font-mono text-text-primary">{count}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="glass-panel rounded-[30px] p-6 motion-card">
            <h2 className="text-lg font-semibold mb-4">整体活跃热力</h2>
            <MiniHeatmap commits={displayCommits} />
          </section>
        </aside>
      </div>
    </AnimatedPage>
  )
}

function CountUpValue({ value }: { value: string }) {
  const numeric = Number(value)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [display, setDisplay] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? (Number.isFinite(numeric) ? numeric : 0) : 0))
  const displayRef = useRef(display)
  const frameRef = useRef<number | null>(null)
  const hasAnimatedRef = useRef(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)

    setReducedMotion(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    if (!Number.isFinite(numeric)) return

    if (reducedMotion) {
      hasAnimatedRef.current = true
      displayRef.current = numeric
      setDisplay(numeric)
      return
    }

    const start = hasAnimatedRef.current ? displayRef.current : 0
    const delta = numeric - start
    if (delta === 0) return

    hasAnimatedRef.current = true

    const startedAt = Date.now()
    const duration = 420

    const frame = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextDisplay = Math.round(start + delta * eased)

      displayRef.current = nextDisplay
      setDisplay(nextDisplay)

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(frame)
      }
    }

    frameRef.current = window.requestAnimationFrame(frame)

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [numeric, reducedMotion])

  return <>{Number.isFinite(numeric) ? display : value}</>
}

function StatCard({ icon, label, value, index }: { icon: React.ReactNode; label: string; value: string; index: number }) {
  return (
    <div className="glass-panel motion-card stagger-item rounded-[26px] p-5" style={{ '--stagger': index } as CSSProperties}>
      <div className="flex items-center gap-2 text-text-secondary text-sm mb-4">
        {icon}
        {label}
      </div>
      <div className="text-[32px] font-semibold font-mono"><CountUpValue value={value} /></div>
    </div>
  )
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center text-center text-text-tertiary ${compact ? 'py-5 text-sm' : 'min-h-[220px]'}`}>
      {text}
    </div>
  )
}

function MiniHeatmap({ commits }: { commits: ProjectCommit[] }) {
  const counts = useMemo(() => groupCommitsByDay(commits), [commits])
  const { showTooltip, hideTooltip } = useTooltip()

  const days = useMemo(() => {
    return Array.from({ length: 56 }).map((_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (55 - index))
      const key = formatDateKey(date.getTime())
      const count = counts.get(key) || 0
      return { key, count, level: getActivityLevel(count) }
    })
  }, [counts])

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-text-tertiary">
        <span className="mb-2 opacity-60">📊 暂无活跃度数据</span>
        <span>添加您的第一次提交后，此处将点亮您的活跃热力图。</span>
      </div>
    )
  }

  return (
    <div className="grid gap-1.5 w-full items-start" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
      {days.map(day => {
        const className = ['bg-bg-tertiary', 'bg-status-level-1', 'bg-status-level-2', 'bg-status-level-3', 'bg-status-level-4'][day.level]
        return (
          <div
            key={day.key}
            onMouseMove={(e) => showTooltip(
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-[10px] text-text-tertiary">{day.key}</span>
                <span className="flex items-center gap-1.5 text-xs text-text-primary">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: day.level > 0 ? '#63D693' : '#707A8A' }} />
                  <strong>{day.count}</strong> 次进展提交
                </span>
              </div>,
              e
            )}
            onMouseLeave={hideTooltip}
            className={`w-full aspect-square h-auto rounded-[4px] transition-all duration-200 hover:scale-110 cursor-crosshair ${className}`}
          />
        )
      })}
    </div>
  )
}
