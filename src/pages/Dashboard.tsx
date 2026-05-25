import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, FolderOpen, Plus, Sparkles } from 'lucide-react'
import { Project, ProjectCommit, ProjectStatus } from '../types'
import { useNavigate } from 'react-router-dom'
import { SafeImage } from '../components/SafeImage'
import { formatDateKey, formatDateTime, getActivityLevel, getProjectCover, getRecentCommit, groupCommitsByDay } from '../lib/projectView'
import { MOCK_MODE_LABEL, mockCommits, mockProjects, mockStatuses } from '../lib/mockData'

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [allCommits, setAllCommits] = useState<ProjectCommit[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      window.ipcRenderer.invoke('get-projects'),
      window.ipcRenderer.invoke('get-statuses'),
    ]).then(async ([p, s]) => {
      setProjects(p)
      setStatuses(s)
      const commits = await Promise.all(p.map((project: Project) => window.ipcRenderer.invoke('get-commits', project.id)))
      setAllCommits(commits.flat())
    })
  }, [])

  const isMockMode = projects.length === 0
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

  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8">
      <div className="flex items-end justify-between">
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
        <StatCard icon={<FolderOpen size={18} />} label="项目总数" value={displayProjects.length.toString()} />
        <StatCard icon={<Sparkles size={18} />} label="进展提交" value={totalCommits.toString()} />
        <StatCard icon={<Activity size={18} />} label="近 7 日提交" value={recentSevenDayCount.toString()} />
        <StatCard icon={<Clock3 size={18} />} label="自定义状态" value={displayStatuses.length.toString()} />
      </div>

      <div className="grid grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-[420px]">
        <section className="glass-panel rounded-[30px] p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">最近活跃项目</h2>
              <p className="text-text-tertiary text-sm mt-1">按最近更新时间排列</p>
            </div>
            <button onClick={() => navigate('/projects')} className="text-sm text-text-secondary hover:text-text-primary transition-colors">查看画廊</button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {displayProjects.slice(0, 6).map(project => (
              <button key={project.id} onClick={() => navigate(`/project/${project.id}`)} className="group text-left bg-bg-secondary border border-border-subtle rounded-[24px] overflow-hidden min-h-[210px] transition-all duration-[220ms] hover:bg-bg-tertiary hover:-translate-y-0.5">
                <div className="h-24 bg-bg-tertiary overflow-hidden">
                  {getProjectCover(project) ? (
                    <SafeImage src={getProjectCover(project)} alt={`${project.name} 封面`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
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
              </button>
            ))}
          </div>
          {displayProjects.length === 0 && (
            <EmptyState text="还没有项目。去项目画廊创建第一个 vibecoding 项目。" />
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section className="glass-panel rounded-[30px] p-6">
            <h2 className="text-lg font-semibold mb-4">近期提交流</h2>
            <div className="space-y-4">
              {commits.map(({ project, commit }) => (
                <button key={commit.id} onClick={() => navigate(`/project/${project.id}`)} className="block w-full text-left border-l border-border-primary pl-4 transition-colors hover:border-accent-blue">
                  <p className="font-medium text-sm truncate">{commit.title}</p>
                  <p className="text-xs text-text-tertiary mt-1 font-mono">{formatDateTime(commit.createdAt)} · {project.name}</p>
                </button>
              ))}
            </div>
            {commits.length === 0 && <EmptyState text="还没有提交。每次 vibecoding 后写一条进展即可。" compact />}
          </section>

          <section className="glass-panel rounded-[30px] p-6">
            <h2 className="text-lg font-semibold mb-4">状态分布</h2>
            <div className="space-y-3">
              {displayStatuses.map(status => {
                const count = displayProjects.filter(project => project.status === status.id).length
                return (
                  <div key={status.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                      <span className="text-text-secondary">{status.name}</span>
                    </div>
                    <span className="font-mono text-text-primary">{count}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="glass-panel rounded-[30px] p-6">
            <h2 className="text-lg font-semibold mb-4">整体活跃热力</h2>
            <MiniHeatmap commits={displayCommits} />
          </section>
        </aside>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass-panel rounded-[26px] p-5">
      <div className="flex items-center gap-2 text-text-secondary text-sm mb-4">
        {icon}
        {label}
      </div>
      <div className="text-[32px] font-semibold font-mono">{value}</div>
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
  const days = useMemo(() => {
    return Array.from({ length: 56 }).map((_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (55 - index))
      const key = formatDateKey(date.getTime())
      const count = counts.get(key) || 0
      return { key, count, level: getActivityLevel(count) }
    })
  }, [counts])

  return (
    <div className="grid grid-cols-14 gap-1">
      {days.map(day => {
        const className = ['bg-bg-tertiary', 'bg-status-completed/25', 'bg-status-completed/45', 'bg-status-completed/70', 'bg-status-completed'][day.level]
        return <span key={day.key} title={`${day.key}: ${day.count} 次提交`} className={`aspect-square rounded-[4px] ${className}`} />
      })}
    </div>
  )
}
