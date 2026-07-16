import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpDown, FolderGit2, GitBranch, Import, RefreshCcw, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { ImportProjectDialog } from '../components/ImportProjectDialog'
import { LaunchButton } from '../components/LaunchButton'
import { SafeImage } from '../components/SafeImage'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'
import { formatDateTime, getProjectCover, getRecentRecord } from '../lib/projectView'
import type { Project } from '../types'

export function ProjectList() {
  const { projects, statuses, tags, isLoaded, loadError, refresh } = useStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState<'activity' | 'name'>('activity')
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => { if (!isLoaded) void refresh() }, [isLoaded, refresh])

  const filtered = useMemo(() => projects
    .filter(project => {
      const query = search.trim().toLocaleLowerCase('zh-CN')
      const matchesSearch = !query || project.name.toLocaleLowerCase('zh-CN').includes(query) || (project.description || '').toLocaleLowerCase('zh-CN').includes(query)
      const matchesStatus = status === 'all' || project.status === status
      const matchesTag = tag === 'all' || project.tags?.some(item => item.id === tag)
      return matchesSearch && matchesStatus && matchesTag
    })
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.updatedAt - a.updatedAt), [projects, search, status, tag, sort])

  if (!isLoaded) return <ProjectListSkeleton />
  if (loadError && !projects.length) return <div className="min-h-full grid place-items-center p-8"><div className="max-w-md text-center"><AlertTriangle size={34} className="mx-auto text-accent-red" /><h1 className="text-xl font-semibold mt-4">项目加载失败</h1><p className="text-sm text-text-tertiary mt-2 break-words">{loadError}</p><button onClick={() => void refresh()} className="mt-5 h-10 px-4 rounded-lg border border-border-primary text-sm inline-flex items-center gap-2"><RefreshCcw size={14} />重试加载</button></div></div>

  return (
    <AnimatedPage tone="gallery" className="w-full min-h-full px-6 py-7 lg:px-8 xl:px-10">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold">项目</h1>
          <p className="text-sm text-text-secondary mt-2">导入本地仓库，持续同步真实开发活动。</p>
        </div>
        <button onClick={() => setImportOpen(true)} className="h-11 px-4 rounded-xl bg-text-primary text-primary text-sm font-semibold flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"><Import size={16} />导入本地项目</button>
      </header>

      <div className="mt-7 min-h-12 rounded-xl border border-border-subtle bg-bg-secondary/55 p-2 flex items-center gap-2 overflow-x-auto" aria-label="项目筛选与排序">
        <label className="relative min-w-[220px] flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <span className="sr-only">搜索项目</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或简介" className="w-full h-9 rounded-lg bg-bg-primary border border-border-subtle pl-9 pr-3 text-sm outline-none focus:border-accent-blue" />
        </label>
        <select aria-label="按状态筛选" value={status} onChange={event => setStatus(event.target.value)} className="h-9 rounded-lg bg-bg-primary border border-border-subtle px-3 text-sm outline-none focus:border-accent-blue"><option value="all">全部阶段</option>{statuses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="按标签筛选" value={tag} onChange={event => setTag(event.target.value)} className="h-9 rounded-lg bg-bg-primary border border-border-subtle px-3 text-sm outline-none focus:border-accent-blue"><option value="all">全部标签</option>{tags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button onClick={() => setSort(value => value === 'activity' ? 'name' : 'activity')} className="h-9 px-3 rounded-lg border border-border-subtle text-sm text-text-secondary flex items-center gap-2 whitespace-nowrap hover:text-text-primary"><ArrowUpDown size={14} />{sort === 'activity' ? '最近活跃' : '名称'}</button>
      </div>

      {filtered.length > 0 ? (
        <div className="mt-5 grid gap-4 pb-10" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map(project => <ProjectCard key={project.id} project={project} onOpen={() => navigate(`/project/${project.id}`)} onConfigureLaunch={() => navigate(`/project/${project.id}?tab=settings`)} />)}
        </div>
      ) : (
        <div className="min-h-[430px] grid place-items-center text-center">
          <div><FolderGit2 size={38} className="mx-auto text-text-tertiary" /><h2 className="mt-4 font-medium">{projects.length ? '没有匹配的项目' : '从一个本地项目开始'}</h2><p className="text-sm text-text-tertiary mt-2">{projects.length ? '调整搜索或筛选条件。' : '选择目录后先预览扫描结果，再确认导入。'}</p>{!projects.length && <button onClick={() => setImportOpen(true)} className="mt-5 h-10 px-4 rounded-lg border border-border-primary text-sm hover:bg-bg-tertiary">导入本地项目</button>}</div>
        </div>
      )}

      <ImportProjectDialog open={importOpen} statuses={statuses} tags={tags} onClose={() => setImportOpen(false)} onImported={async projectId => { setImportOpen(false); await refresh(); navigate(`/project/${projectId}`) }} />
    </AnimatedPage>
  )
}

function ProjectCard({ project, onOpen, onConfigureLaunch }: { project: Project; onOpen: () => void; onConfigureLaunch: () => void }) {
  const cover = getProjectCover(project)
  const recent = getRecentRecord(project)
  const git = project.gitSync
  const backfillProgress = git?.backfillTotal ? git.backfillProgress || 0 : null
  const gitLabel = backfillProgress !== null && git?.status !== 'synced'
    ? git?.status === 'failed'
      ? `同步失败 · 已保存 ${backfillProgress}%`
      : git?.backfillResumable
        ? `历史回填可继续 · ${backfillProgress}%`
        : `正在回填历史 · ${backfillProgress}%`
    : git?.status === 'synced'
      ? `${git.branch || 'Git'} · ${git.commitCount}`
      : git?.status === 'failed'
        ? '同步失败'
        : git?.status === 'unavailable'
          ? '未关联 Git'
          : '待同步'
  return (
    <article className="group rounded-2xl border border-border-subtle bg-bg-secondary/70 overflow-hidden hover:border-border-primary transition-colors">
      <button onClick={onOpen} aria-label={`打开项目 ${project.name}`} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue">
        <div className="h-36 bg-bg-tertiary overflow-hidden">
          {cover ? <SafeImage src={cover} alt={`${project.name} 封面`} thumbnailSize={640} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><span className="w-12 h-12 rounded-xl bg-bg-primary border border-border-subtle grid place-items-center text-lg font-semibold text-text-secondary">{project.name.slice(0, 1).toUpperCase()}</span></div>}
        </div>
        <div className="p-4 pb-0">
        <div className="flex items-start justify-between gap-3"><h2 className="font-semibold truncate">{project.name}</h2>{project.statusInfo && <span className="text-[11px] px-2 py-1 rounded-md flex-shrink-0" style={{ color: project.statusInfo.color, backgroundColor: `${project.statusInfo.color}16` }}>{project.statusInfo.name}</span>}</div>
        <div className="mt-4 min-h-10"><p className="text-[11px] text-text-tertiary mb-1">最近开发记录</p><p className="text-sm text-text-secondary line-clamp-1">{recent?.title || '还没有开发记录'}</p></div>
        </div>
      </button>
      <div className="mx-4 mt-4 pt-3 pb-4 border-t border-border-subtle flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[11px] flex items-center gap-1.5 ${git?.status === 'failed' ? 'text-accent-red' : git?.status === 'synced' ? 'text-status-completed' : 'text-text-tertiary'}`}><GitBranch size={12} />{gitLabel}</p>
            <div className="flex gap-1 mt-2">{project.tags?.slice(0, 2).map(item => <span key={item.id} className="text-[10px] px-2 py-0.5 rounded-md bg-bg-tertiary text-text-tertiary">{item.name}</span>)}{recent && <span className="text-[10px] text-text-tertiary self-center">{formatDateTime(recent.createdAt)}</span>}</div>
          </div>
          <LaunchButton compact capability={project.launchCapability} onConfigure={onConfigureLaunch} />
      </div>
    </article>
  )
}

function ProjectListSkeleton() {
  return <div className="p-8 space-y-7"><div className="flex justify-between"><div className="space-y-2"><Skeleton className="h-9 w-32 rounded-lg" /><Skeleton className="h-4 w-72 rounded" /></div><Skeleton className="h-11 w-40 rounded-xl" /></div><Skeleton className="h-12 w-full rounded-xl" /><div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>{[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-72 rounded-2xl" />)}</div></div>
}
