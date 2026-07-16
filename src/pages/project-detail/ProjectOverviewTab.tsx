import { useEffect, useState } from 'react'
import { GitBranch, GitCommit, Loader2, RefreshCcw, Save } from 'lucide-react'
import type { Project } from '../../types'
import { formatDateTime } from '../../lib/projectView'
import { useNotifications } from '../../lib/notifications'

export function ProjectOverviewTab({ project, onReload }: { project: Project; onReload: () => Promise<void> }) {
  const [phase, setPhase] = useState(project.phase || project.statusInfo?.name || '')
  const [milestone, setMilestone] = useState(project.milestone || '')
  const [nextStep, setNextStep] = useState(project.nextStep || '')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const { notify } = useNotifications()
  useEffect(() => {
    setPhase(project.phase || project.statusInfo?.name || '')
    setMilestone(project.milestone || '')
    setNextStep(project.nextStep || '')
  }, [project.id, project.phase, project.milestone, project.nextStep, project.statusInfo?.name])
  const save = async () => {
    setSaving(true)
    try {
      await window.vibe.projects.update(project.id, { phase, milestone, nextStep })
      await onReload()
      notify({ tone: 'success', title: '项目推进信息已保存' })
    } catch (error) { notify({ tone: 'error', title: '保存失败', detail: error instanceof Error ? error.message : String(error) }) }
    finally { setSaving(false) }
  }
  const syncGit = async () => {
    setSyncing(true)
    try {
      const result = await window.vibe.git.sync(project.id)
      await onReload()
      notify({ tone: 'success', title: result.inserted ? `发现 ${result.inserted} 个新提交` : 'Git 已是最新状态' })
    } catch (error) {
      notify({ tone: 'error', title: 'Git 同步失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setSyncing(false)
    }
  }
  return (
    <div className="grid xl:grid-cols-[1.25fr_0.75fr] gap-4">
      <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
        <h2 className="font-semibold">项目概览</h2>
        <p className="text-sm text-text-secondary leading-7 mt-3 whitespace-pre-wrap">{project.description || '还没有项目简介。可在项目设置中补充。'}</p>
        <div className="grid md:grid-cols-3 gap-3 mt-6">
          <label className="text-xs text-text-secondary space-y-1.5">阶段<input value={phase} onChange={event => setPhase(event.target.value)} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" placeholder="例如：核心闭环" /></label>
          <label className="text-xs text-text-secondary space-y-1.5">当前里程碑<input value={milestone} onChange={event => setMilestone(event.target.value)} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" placeholder="正在完成什么" /></label>
          <label className="text-xs text-text-secondary space-y-1.5">下一步<input value={nextStep} onChange={event => setNextStep(event.target.value)} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" placeholder="下一项行动" /></label>
        </div>
        <div className="flex justify-end mt-3"><button onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-text-primary text-primary text-sm font-semibold flex items-center gap-2 disabled:opacity-50"><Save size={14} />{saving ? '保存中' : '保存'}</button></div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold flex items-center gap-2"><GitBranch size={16} />Git 状态</h2><button onClick={syncGit} disabled={syncing || !(project.canonicalPath || project.path) || project.gitSync?.status === 'unavailable'} title={project.gitSync?.status === 'unavailable' ? '请先在项目设置中关联 Git 仓库' : undefined} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent-blue">{syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}{project.gitSync?.status === 'failed' ? '重试同步' : '立即同步'}</button></div>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-text-tertiary">同步状态</dt><dd className={project.gitSync?.status === 'failed' ? 'text-accent-red' : 'text-text-primary'}>{project.gitSync?.status === 'synced' ? '已同步' : project.gitSync?.status === 'failed' ? '同步失败' : project.gitSync?.status === 'unavailable' ? '未关联 Git' : project.gitSync?.backfillResumable ? '历史回填可继续' : project.gitSync?.status === 'syncing' ? '正在同步' : '等待同步'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-tertiary">分支</dt><dd className="font-mono text-xs">{project.gitSync?.branch || '—'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-tertiary">HEAD</dt><dd className="font-mono text-xs">{project.gitSync?.headSha?.slice(0, 10) || '—'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-tertiary">提交总数</dt><dd className="flex items-center gap-1"><GitCommit size={13} />{project.gitSync?.commitCount || 0}</dd></div>
          {project.gitSync?.historyTruncated && <div className="flex justify-between gap-4"><dt className="text-text-tertiary">本地历史基线</dt><dd className="text-xs">最近 {project.gitSync.historyLimit || 0} 条；新提交持续同步</dd></div>}
          <div className="flex justify-between gap-4"><dt className="text-text-tertiary">上次扫描</dt><dd className="text-xs">{project.gitSync?.lastScannedAt ? formatDateTime(project.gitSync.lastScannedAt) : '从未'}</dd></div>
        </dl>
        {Boolean(project.gitSync?.backfillTotal) && project.gitSync?.status !== 'synced' && <div className="mt-4" aria-label={`Git 历史回填 ${project.gitSync?.backfillProgress || 0}%`}><div className="flex justify-between text-[11px] text-text-tertiary"><span>{project.gitSync?.backfillResumable ? '已保存断点' : '历史回填进度'}</span><span>{project.gitSync?.backfillProcessed || 0}/{project.gitSync?.backfillTotal || 0} · {project.gitSync?.backfillProgress || 0}%</span></div><div className="h-1.5 mt-2 rounded-full bg-bg-primary overflow-hidden"><div className="h-full bg-accent-blue transition-[width]" style={{ width: `${project.gitSync?.backfillProgress || 0}%` }} /></div></div>}
        {project.gitSync?.error && <p className="mt-4 rounded-lg bg-accent-red/10 px-3 py-2 text-xs text-accent-red break-words">{project.gitSync.error}</p>}
      </section>
    </div>
  )
}
