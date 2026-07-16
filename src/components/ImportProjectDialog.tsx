import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderOpen, GitBranch, GitCommit, Image, Loader2, Play, X } from 'lucide-react'
import type { ProjectInspection, ProjectStatus, Tag } from '../types'
import { SafeImage } from './SafeImage'
import { useNotifications } from '../lib/notifications'

export function ImportProjectDialog({
  open,
  statuses,
  tags,
  onClose,
  onImported,
}: {
  open: boolean
  statuses: ProjectStatus[]
  tags: Tag[]
  onClose: () => void
  onImported: (projectId: string) => void
}) {
  const [mode, setMode] = useState<'import' | 'empty'>('import')
  const [inspection, setInspection] = useState<ProjectInspection | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [coverImagePath, setCoverImagePath] = useState('')
  const [launchIndex, setLaunchIndex] = useState<number | null>(null)
  const [historyMode, setHistoryMode] = useState<'full' | 'recent'>('full')
  const [historyLimit, setHistoryLimit] = useState(500)
  const [busy, setBusy] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const { notify } = useNotifications()

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => previouslyFocused?.focus()
  }, [open])

  useEffect(() => {
    if (open) return
    setMode('import')
    setInspection(null)
    setName('')
    setDescription('')
    setTagIds([])
    setCoverImagePath('')
    setLaunchIndex(null)
    setHistoryMode('full')
    setHistoryLimit(500)
  }, [open])

  useEffect(() => {
    if (!open) return
    setStatus(current => current || statuses[0]?.id || '')
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, statuses, busy, onClose])

  if (!open) return null

  const chooseDirectory = async () => {
    setBusy(true)
    try {
      const result = await window.vibe.projects.chooseDirectory()
      if (!result) return
      setInspection(result)
      setName(result.projectName)
      setDescription(result.readmeSummary)
      setCoverImagePath(result.assetCandidates[0] || '')
      setLaunchIndex(result.launchCandidates.length ? 0 : null)
      setHistoryMode(result.isGitRepository && result.commitCount > 2_000 ? 'recent' : 'full')
      setHistoryLimit(500)
    } catch (error) {
      notify({ tone: 'error', title: '无法扫描该目录', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!name.trim() || (mode === 'import' && !inspection)) return
    setBusy(true)
    try {
      let projectId = ''
      let syncError = ''
      if (mode === 'import') {
        const result = await window.vibe.projects.import({
          selectedPath: inspection!.selectedPath,
          name: name.trim(),
          description: description.trim(),
          status,
          tagIds,
          coverImagePath,
          gitHistoryLimit: historyMode === 'recent' ? historyLimit : 0,
          launchCandidate: launchIndex === null ? undefined : inspection!.launchCandidates[launchIndex],
        })
        projectId = result.projectId
        syncError = result.syncError
      } else {
        projectId = await window.vibe.projects.createEmpty({ name: name.trim(), description: description.trim(), status, tagIds })
      }
      notify(syncError
        ? { tone: 'error', title: '项目已导入，但首次 Git 同步未完成', detail: `${syncError}。项目已保留，可在概览或首页重试同步。` }
        : { tone: 'success', title: mode === 'import' ? '本地项目已导入' : '空项目已创建' })
      onImported(projectId)
    } catch (error) {
      notify({ tone: 'error', title: mode === 'import' ? '导入失败' : '创建失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const changeMode = (nextMode: 'import' | 'empty') => {
    setMode(nextMode)
    if (nextMode === 'empty') {
      setInspection(null)
      setName('')
      setDescription('')
    }
  }

  const handleModeKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tablist = event.currentTarget
    const nextMode = event.key === 'Home' || event.key === 'ArrowLeft' ? 'import' : 'empty'
    changeMode(nextMode)
    window.requestAnimationFrame(() => {
      tablist.querySelector<HTMLButtonElement>(`[data-mode="${nextMode}"]`)?.focus()
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/65 p-5 grid place-items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="import-project-title" className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl">
        <header className="sticky top-0 z-10 h-16 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-secondary/95 backdrop-blur">
          <div>
            <h2 id="import-project-title" className="text-lg font-semibold">{mode === 'import' ? '导入本地项目' : '手动创建空项目'}</h2>
            <p className="text-xs text-text-tertiary mt-0.5">确认前不会写入项目，也不会执行仓库中的任何命令。</p>
          </div>
          <button ref={closeButton} aria-label="关闭导入向导" disabled={busy} onClick={onClose} className="w-9 h-9 rounded-lg grid place-items-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary focus-visible:ring-2 focus-visible:ring-accent-blue"><X size={18} /></button>
        </header>

        <div className="p-6 space-y-6">
          <div className="inline-flex p-1 rounded-xl bg-bg-primary border border-border-subtle" role="tablist" aria-label="创建方式" onKeyDown={handleModeKeys}>
            <button type="button" role="tab" data-mode="import" tabIndex={mode === 'import' ? 0 : -1} aria-selected={mode === 'import'} onClick={() => changeMode('import')} className={`h-9 px-4 rounded-lg text-sm ${mode === 'import' ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary'}`}>导入目录</button>
            <button type="button" role="tab" data-mode="empty" tabIndex={mode === 'empty' ? 0 : -1} aria-selected={mode === 'empty'} onClick={() => changeMode('empty')} className={`h-9 px-4 rounded-lg text-sm ${mode === 'empty' ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary'}`}>空项目</button>
          </div>

          {mode === 'import' && !inspection && (
            <button disabled={busy} onClick={chooseDirectory} className="w-full min-h-52 rounded-2xl border border-dashed border-border-primary bg-bg-primary/50 grid place-items-center text-center hover:border-accent-blue focus-visible:ring-2 focus-visible:ring-accent-blue">
              <span>
                {busy ? <Loader2 size={28} className="mx-auto animate-spin text-accent-blue" /> : <FolderOpen size={30} className="mx-auto text-accent-blue" />}
                <strong className="block mt-4">选择本地项目目录</strong>
                <span className="block text-sm text-text-tertiary mt-2">主进程将验证真实路径、Git 状态与重复导入</span>
              </span>
            </button>
          )}

          {(mode === 'empty' || inspection) && (
            <>
              {inspection && (
                <div className="rounded-xl border border-border-subtle bg-bg-primary/45 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <span className="flex items-center gap-2"><GitBranch size={15} className="text-text-tertiary" />{inspection.isGitRepository ? (inspection.detached ? 'DETACHED HEAD' : inspection.branch || '空仓库') : '非 Git 目录'}</span>
                    <span className="flex items-center gap-2"><GitCommit size={15} className="text-text-tertiary" />{inspection.commitCount} 个提交</span>
                    {inspection.headSha && <span className="font-mono text-xs text-text-tertiary">HEAD {inspection.headSha.slice(0, 10)}</span>}
                    {inspection.remoteUrl && <span className="font-mono text-xs text-text-tertiary truncate max-w-md">{inspection.remoteUrl}</span>}
                  </div>
                  <p className="text-xs font-mono text-text-tertiary break-all">{inspection.canonicalPath}</p>
                  {inspection.warnings.map(warning => <p key={warning} className="text-xs text-accent-orange">{warning}</p>)}
                  {inspection.recentCommits.length > 0 && (
                    <div className="pt-2 border-t border-border-subtle space-y-1">
                      {inspection.recentCommits.slice(0, 4).map(commit => (
                        <div key={commit.sha} className="flex items-center gap-3 text-xs"><code className="text-accent-blue">{commit.sha.slice(0, 7)}</code><span className="truncate text-text-secondary">{commit.subject}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <label className="space-y-2 text-sm">项目名称<input autoFocus={mode === 'empty'} value={name} onChange={event => setName(event.target.value)} className="w-full h-11 px-3 rounded-lg bg-bg-primary border border-border-subtle outline-none focus:border-accent-blue" /></label>
                <label className="space-y-2 text-sm">当前阶段<select value={status} onChange={event => setStatus(event.target.value)} className="w-full h-11 px-3 rounded-lg bg-bg-primary border border-border-subtle outline-none focus:border-accent-blue">{statuses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              </div>
              <label className="space-y-2 text-sm block">项目简介<textarea value={description} onChange={event => setDescription(event.target.value)} className="w-full min-h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle outline-none focus:border-accent-blue resize-y" placeholder="这个项目解决什么问题？" /></label>

              {inspection && inspection.techStack.length > 0 && <div><p className="text-sm mb-2">识别到的技术栈</p><div className="flex flex-wrap gap-2">{inspection.techStack.map(item => <span key={item} className="px-2.5 py-1 rounded-md bg-bg-tertiary text-xs text-text-secondary">{item}</span>)}</div></div>}

              {inspection?.isGitRepository && inspection.commitCount > 0 && (
                <fieldset className="space-y-2"><legend className="text-sm mb-2 flex items-center gap-2"><GitCommit size={15} />首次 Git 历史范围</legend>
                  <label className="flex gap-3 rounded-xl border border-border-subtle p-3 text-sm"><input type="radio" name="git-history-range" checked={historyMode === 'full'} onChange={() => setHistoryMode('full')} /><span><strong className="block">完整历史</strong><span className="block text-xs text-text-tertiary mt-1">导入全部 {inspection.commitCount} 个提交</span></span></label>
                  <label className="flex gap-3 rounded-xl border border-border-subtle p-3 text-sm"><input type="radio" name="git-history-range" checked={historyMode === 'recent'} onChange={() => setHistoryMode('recent')} /><span className="min-w-0 flex-1"><strong className="block">最近提交基线</strong><span className="block text-xs text-text-tertiary mt-1">首次只导入最近的提交；基线之后的新提交仍会持续增量同步</span>{historyMode === 'recent' && <select aria-label="Git 历史基线数量" value={historyLimit} onChange={event => setHistoryLimit(Number(event.target.value))} className="mt-2 h-8 rounded-lg bg-bg-primary border border-border-subtle px-2 text-xs"><option value={200}>最近 200 条</option><option value={500}>最近 500 条</option><option value={1000}>最近 1000 条</option><option value={2000}>最近 2000 条</option></select>}</span></label>
                  {inspection.commitCount > 2_000 && <p className="text-xs text-accent-orange">仓库历史较大，建议使用最近提交基线；需要时仍可选择完整历史。</p>}
                </fieldset>
              )}

              {tags.length > 0 && <div><p className="text-sm mb-2">标签</p><div className="flex flex-wrap gap-2">{tags.map(tag => { const selected = tagIds.includes(tag.id); return <button key={tag.id} onClick={() => setTagIds(ids => selected ? ids.filter(id => id !== tag.id) : [...ids, tag.id])} className={`h-8 px-3 rounded-lg border text-xs flex items-center gap-2 ${selected ? 'border-border-primary bg-bg-tertiary text-text-primary' : 'border-border-subtle text-text-tertiary'}`}>{selected && <Check size={12} />}<span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}</button> })}</div></div>}

              {inspection && inspection.assetCandidates.length > 0 && (
                <div><p className="text-sm mb-2 flex items-center gap-2"><Image size={15} />封面候选</p><div className="grid grid-cols-4 gap-2">{inspection.assetCandidates.slice(0, 8).map(imagePath => <button key={imagePath} aria-label="选择该图片为封面" onClick={() => setCoverImagePath(imagePath)} className={`aspect-video rounded-lg overflow-hidden border-2 ${coverImagePath === imagePath ? 'border-accent-blue' : 'border-transparent'}`}><SafeImage src={imagePath} alt="封面候选" thumbnailSize={480} className="w-full h-full object-cover" /></button>)}</div></div>
              )}

              {inspection && inspection.launchCandidates.length > 0 && (
                <fieldset className="space-y-2"><legend className="text-sm mb-2 flex items-center gap-2"><Play size={15} />启动方式候选（仅保存，不执行）</legend>
                  <label className="flex gap-3 rounded-xl border border-border-subtle p-3 text-sm"><input type="radio" checked={launchIndex === null} onChange={() => setLaunchIndex(null)} /><span>暂不配置</span></label>
                  {inspection.launchCandidates.map((candidate, index) => <label key={candidate.name} className="flex gap-3 rounded-xl border border-border-subtle p-3 text-sm"><input type="radio" checked={launchIndex === index} onChange={() => setLaunchIndex(index)} /><span className="min-w-0"><strong className="block">{candidate.name}</strong><code className="block text-xs text-text-tertiary mt-1 break-all">{candidate.executable} {candidate.args.join(' ')}</code><span className="block text-xs text-text-tertiary mt-1">{candidate.reason}</span></span></label>)}
                </fieldset>
              )}
            </>
          )}
        </div>

        <footer className="sticky bottom-0 px-6 py-4 border-t border-border-subtle bg-bg-secondary/95 backdrop-blur flex justify-between gap-3">
          {inspection && mode === 'import' ? <button onClick={chooseDirectory} disabled={busy} className="h-10 px-4 rounded-lg border border-border-subtle text-sm text-text-secondary">重新选择</button> : <span />}
          <div className="flex gap-2"><button onClick={onClose} disabled={busy} className="h-10 px-4 rounded-lg text-sm text-text-secondary hover:text-text-primary">取消</button><button onClick={submit} disabled={busy || !name.trim() || (mode === 'import' && !inspection)} className="h-10 px-5 rounded-lg bg-text-primary text-primary text-sm font-semibold disabled:opacity-40 flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}{mode === 'import' ? '确认导入' : '创建项目'}</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
