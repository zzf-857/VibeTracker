import { useEffect, useState } from 'react'
import { AlertTriangle, FolderSearch, Image, Loader2, Play, Save } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { LaunchCandidate, Project, ProjectInspection, ProjectStatus, Tag } from '../../types'
import { useNotifications } from '../../lib/notifications'
import { AiRulesPanel } from './AiRulesPanel'
import { LaunchProfilesPanel } from './LaunchProfilesPanel'

function projectDraft(project: Project) {
  return {
    name: project.name,
    description: project.description || '',
    repoUrl: project.repoUrl || '',
    status: project.status,
    tagIds: project.tags?.map(tag => tag.id) || [],
    coverImagePath: project.coverImagePath || '',
  }
}

export function ProjectSettingsTab({
  project,
  statuses,
  tags,
  onReload,
}: {
  project: Project
  statuses: ProjectStatus[]
  tags: Tag[]
  onReload: () => Promise<void>
}) {
  const [draft, setDraft] = useState(() => projectDraft(project))
  const [saving, setSaving] = useState(false)
  const [relinking, setRelinking] = useState(false)
  const [pendingRepository, setPendingRepository] = useState<ProjectInspection | null>(null)
  const [relinkCandidates, setRelinkCandidates] = useState<LaunchCandidate[]>([])
  const [adoptingCandidate, setAdoptingCandidate] = useState('')
  const [launchRefreshKey, setLaunchRefreshKey] = useState(0)
  const { notify } = useNotifications()
  const navigate = useNavigate()

  useEffect(() => setDraft(projectDraft(project)), [project])

  const save = async () => {
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      await window.vibe.projects.update(project.id, { ...draft, name: draft.name.trim() })
      await onReload()
      notify({ tone: 'success', title: '项目设置已保存' })
    } catch (error) {
      notify({ tone: 'error', title: '项目设置保存失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const chooseCover = async () => {
    const selected = await window.vibe.assets.chooseImages()
    if (typeof selected === 'string') setDraft(current => ({ ...current, coverImagePath: selected }))
  }

  const chooseRepository = async () => {
    setRelinking(true)
    try {
      const inspection = await window.vibe.projects.chooseDirectory()
      if (!inspection) return
      if (!inspection.isGitRepository) {
        notify({ tone: 'error', title: '请选择 Git 仓库', detail: inspection.warnings.join('；') })
        return
      }
      setPendingRepository(inspection)
      setRelinkCandidates([])
    } catch (error) {
      notify({ tone: 'error', title: '仓库扫描失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setRelinking(false)
    }
  }

  const confirmRepository = async () => {
    if (!pendingRepository) return
    setRelinking(true)
    try {
      const result = await window.vibe.projects.relink(project.id, pendingRepository.selectedPath)
      setPendingRepository(null)
      setRelinkCandidates(result.inspection.launchCandidates)
      setLaunchRefreshKey(value => value + 1)
      await onReload()
      const details = [
        result.syncError
          ? `仓库已关联，但 Git 同步未完成：${result.syncError}`
          : result.syncResult?.inserted
            ? `同步了 ${result.syncResult.inserted} 个新提交`
            : result.syncResult
              ? 'Git 已是最新状态'
              : '仓库已关联，尚未执行 Git 同步',
        result.invalidatedLaunchProfiles
          ? `${result.invalidatedLaunchProfiles} 个旧启动配置已失效，需要重新确认`
          : '',
        result.assetWarnings.length
          ? `${result.assetWarnings.length} 个图片引用仍指向旧仓库，请检查并替换`
          : '',
      ].filter(Boolean)
      notify({
        tone: result.syncError ? 'error' : 'success',
        title: result.syncError ? '仓库已关联，但同步未完成' : '本地仓库已关联',
        detail: details.join('；'),
      })
    } catch (error) {
      notify({ tone: 'error', title: '重新关联失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setRelinking(false)
    }
  }

  const adoptLaunchCandidate = async (candidate: LaunchCandidate) => {
    setAdoptingCandidate(candidate.name)
    try {
      await window.vibe.launch.save({
        projectId: project.id,
        name: candidate.name,
        executable: candidate.executable,
        args: candidate.args,
        cwd: candidate.cwd,
        env: candidate.env,
        readyUrl: candidate.readyUrl,
        readyPort: candidate.readyPort,
        enabled: true,
      })
      setRelinkCandidates(current => current.filter(item => item !== candidate))
      setLaunchRefreshKey(value => value + 1)
      await onReload()
      notify({ tone: 'success', title: '启动候选已保存', detail: '仅保存了配置；首次启动仍会展示实际命令并要求确认。' })
    } catch (error) {
      notify({ tone: 'error', title: '启动候选保存失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setAdoptingCandidate('')
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">项目资料</h2>
            <p className="text-xs text-text-tertiary mt-1">本地仓库路径通过目录选择器验证，不能直接输入未校验路径。</p>
          </div>
          <button onClick={save} disabled={saving} className="h-9 px-3 rounded-lg bg-text-primary text-primary text-xs font-semibold flex items-center gap-2">
            <Save size={13} />保存
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <label className="text-xs text-text-secondary space-y-1.5">
            名称
            <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className="w-full h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm" />
          </label>
          <label className="text-xs text-text-secondary space-y-1.5">
            状态
            <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })} className="w-full h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm">
              {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-text-secondary space-y-1.5 md:col-span-2">
            简介
            <textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-sm resize-y" />
          </label>
          <div className="md:col-span-2">
            <span className="text-xs text-text-secondary">本地仓库</span>
            <div className="mt-1.5 flex gap-2">
              <div className="min-w-0 flex-1 h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-xs font-mono flex items-center truncate" title={project.canonicalPath || project.path || ''}>
                {project.canonicalPath || project.path || '尚未关联本地仓库'}
              </div>
              <button onClick={chooseRepository} disabled={relinking} className="h-9 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5 disabled:opacity-50">
                {relinking ? <Loader2 size={13} className="animate-spin" /> : <FolderSearch size={13} />}
                {project.canonicalPath || project.path ? '重新关联' : '关联仓库'}
              </button>
            </div>
          </div>
          <label className="text-xs text-text-secondary space-y-1.5 md:col-span-2">
            Remote URL
            <input value={draft.repoUrl} onChange={event => setDraft({ ...draft, repoUrl: event.target.value })} className="w-full h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-xs font-mono" />
          </label>
        </div>

        {pendingRepository && (
          <div className="mt-4 rounded-xl border border-accent-blue/30 bg-accent-blue/[0.06] p-4">
            <p className="text-sm font-medium">确认关联这个仓库？</p>
            <p className="text-xs font-mono text-text-secondary mt-2 break-all">{pendingRepository.canonicalPath}</p>
            <p className="text-xs text-text-tertiary mt-2">
              {pendingRepository.branch || (pendingRepository.emptyRepository ? '空仓库' : 'DETACHED')} · HEAD {pendingRepository.headSha ? pendingRepository.headSha.slice(0, 10) : '—'} · {pendingRepository.commitCount} 个提交
            </p>
            <p className="text-xs text-accent-orange mt-2">仓库发生变化后，旧启动配置会失效，必须重新核对并确认。</p>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setPendingRepository(null)} disabled={relinking} className="h-8 px-3 rounded-lg text-xs text-text-secondary">取消</button>
              <button onClick={confirmRepository} disabled={relinking} className="h-8 px-3 rounded-lg bg-text-primary text-primary text-xs font-semibold">确认并同步</button>
            </div>
          </div>
        )}

        {relinkCandidates.length > 0 && (
          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary/45 p-4">
            <h3 className="text-sm font-medium flex items-center gap-2"><Play size={14} />新仓库启动候选</h3>
            <p className="text-xs text-text-tertiary mt-1">扫描器只推荐。采用候选只会保存配置，不会执行任何命令。</p>
            <div className="mt-3 space-y-2">
              {relinkCandidates.map(candidate => (
                <article key={`${candidate.name}:${candidate.executable}:${candidate.args.join('\u0000')}`} className="rounded-lg border border-border-subtle bg-bg-secondary/60 p-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="text-sm">{candidate.name}</strong>
                    <code className="block text-[11px] text-text-tertiary mt-1 break-all">{candidate.executable} {candidate.args.join(' ')}</code>
                    <p className="text-[11px] text-text-tertiary mt-1">{candidate.reason}</p>
                  </div>
                  <button onClick={() => void adoptLaunchCandidate(candidate)} disabled={Boolean(adoptingCandidate)} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary disabled:opacity-50">
                    {adoptingCandidate === candidate.name ? '保存中…' : '采用候选'}
                  </button>
                </article>
              ))}
            </div>
          </div>
        )}

        {Boolean(project.assetWarnings?.length) && (
          <section role="status" className="mt-4 rounded-xl border border-accent-orange/30 bg-accent-orange/[0.06] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={17} className="mt-0.5 flex-shrink-0 text-accent-orange" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-accent-orange">图片仍引用重新关联前的仓库</h3>
                <p className="mt-1 text-xs leading-5 text-text-tertiary">当前文件仍存在时可以继续查看；旧目录移动或删除后会失效。VibeTracker 不会自动复制、删除或替换这些外部图片。</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {project.assetWarnings?.slice(0, 6).map(warning => (
                <div key={`${warning.kind}:${warning.recordId || ''}:${warning.path}`} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-primary/45 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-secondary">{warning.kind === 'cover' ? '项目封面' : `开发记录：${warning.recordTitle || '未命名记录'}`}</p>
                    <code className="mt-1 block truncate text-[10px] text-text-tertiary" title={warning.path}>{warning.path}</code>
                  </div>
                  {warning.kind === 'cover' ? (
                    <div className="flex flex-shrink-0 gap-2">
                      <button type="button" onClick={() => void chooseCover()} className="h-8 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary">选择新封面</button>
                      <button type="button" onClick={() => setDraft(current => ({ ...current, coverImagePath: '' }))} className="h-8 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-tertiary">移除引用</button>
                    </div>
                  ) : warning.recordId ? (
                    <button type="button" onClick={() => navigate(`/project/${project.id}?tab=records&record=${encodeURIComponent(warning.recordId!)}`)} className="h-8 flex-shrink-0 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary">查看记录</button>
                  ) : null}
                </div>
              ))}
              {(project.assetWarnings?.length || 0) > 6 && <p className="text-[11px] text-text-tertiary">另有 {(project.assetWarnings?.length || 0) - 6} 个旧仓库图片引用。</p>}
            </div>
          </section>
        )}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-tertiary">标签</span>
          {tags.map(tag => {
            const selected = draft.tagIds.includes(tag.id)
            return (
              <button key={tag.id} onClick={() => setDraft(current => ({ ...current, tagIds: selected ? current.tagIds.filter(id => id !== tag.id) : [...current.tagIds, tag.id] }))} className={`h-7 px-2.5 rounded-md border text-xs ${selected ? 'border-border-primary bg-bg-tertiary text-text-primary' : 'border-border-subtle text-text-tertiary'}`}>
                {tag.name}
              </button>
            )
          })}
          <button onClick={chooseCover} className="h-7 px-2.5 rounded-md border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5"><Image size={12} />选择封面</button>
        </div>
      </section>

      <LaunchProfilesPanel project={project} onChanged={onReload} refreshKey={launchRefreshKey} />
      <AiRulesPanel projectId={project.id} />
    </div>
  )
}
