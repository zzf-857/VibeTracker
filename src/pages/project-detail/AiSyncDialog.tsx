import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, GitCommit, History, Loader2, RefreshCcw, Sparkles, X } from 'lucide-react'
import type { AiGenerationResult, AiGenerationRunDetail, AiGenerationRunSummary, AiInputPreview, AiProjectSuggestionApplication, DevelopmentRecord, Project } from '../../types'
import { formatDateTime } from '../../lib/projectView'
import { useNotifications } from '../../lib/notifications'
import { useStore } from '../../lib/store'
import { AiRunHistoryPanel } from './AiRunHistoryPanel'

interface ProjectSuggestionDraft {
  name: string
  description: string
  phase: string
  tagNames: string[]
}

function rangeTimestamp(value: string, endOfDay = false) {
  if (!value) return undefined
  const timestamp = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function AiSyncDialog({ open, project, onClose, onChanged }: { open: boolean; project: Project; onClose: () => void; onChanged: () => Promise<void> }) {
  const [preview, setPreview] = useState<AiInputPreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<AiGenerationResult | null>(null)
  const [suggestion, setSuggestion] = useState<ProjectSuggestionDraft>({ name: '', description: '', phase: '', tagNames: [] })
  const [loading, setLoading] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [prepareAttempt, setPrepareAttempt] = useState(0)
  const [reviewedDraftIds, setReviewedDraftIds] = useState<string[]>([])
  const [runs, setRuns] = useState<AiGenerationRunSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [busyRunId, setBusyRunId] = useState('')
  const [openedRun, setOpenedRun] = useState<AiGenerationRunDetail | null>(null)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [authoredAfter, setAuthoredAfter] = useState<number | undefined>()
  const [authoredBefore, setAuthoredBefore] = useState<number | undefined>()
  const [previewLoadingMore, setPreviewLoadingMore] = useState(false)
  const [previewLoadError, setPreviewLoadError] = useState('')
  const [applyingSuggestion, setApplyingSuggestion] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const loadingRef = useRef(false)
  const generationRef = useRef(false)
  const previewLoadingMoreRef = useRef(false)
  const applyingSuggestionRef = useRef(false)
  const { notify } = useNotifications()
  const { refresh } = useStore()
  const selectedCommits = useMemo(() => preview?.commits.filter(commit => selected.includes(commit.sha)) || [], [preview, selected])
  const selectedFiles = useMemo(() => [...new Set(selectedCommits.flatMap(commit => commit.fileNames))].sort(), [selectedCommits])
  const selectedStats = useMemo(() => selectedCommits.reduce((sum, commit) => ({
    added: sum.added + commit.stats.added,
    deleted: sum.deleted + commit.stats.deleted,
    files: sum.files + commit.stats.files,
  }), { added: 0, deleted: 0, files: 0 }), [selectedCommits])
  const estimatedInputBytes = useMemo(() => new TextEncoder().encode(JSON.stringify({
    project: {
      name: project.name,
      description: project.description || '',
      phase: project.phase || '',
      milestone: project.milestone || '',
      nextStep: project.nextStep || '',
    },
    commits: selectedCommits,
    assetCandidates: preview?.assetCandidates || [],
  })).length, [preview?.assetCandidates, project, selectedCommits])

  const loadRuns = useCallback(async () => {
    setHistoryLoading(true)
    try {
      setRuns(await window.vibe.ai.listRuns(project.id))
    } catch (error) {
      notify({ tone: 'error', title: 'AI 运行历史加载失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setHistoryLoading(false)
    }
  }, [notify, project.id])

  const presentGeneration = useCallback((generated: AiGenerationResult, detail: AiGenerationRunDetail | null) => {
    setResult(generated)
    setOpenedRun(detail)
    setReviewedDraftIds(generated.drafts.filter(draft => draft.reviewStatus !== 'draft').map(draft => draft.id))
    setSuggestion({
      name: generated.payload.project.name,
      description: generated.payload.project.description,
      phase: generated.payload.project.phase,
      tagNames: generated.payload.project.tags,
    })
    if (detail) {
      const commits = detail.inputSnapshot.commits || []
      setPreview({
        commits,
        shas: detail.inputShas,
        files: [...new Set(commits.flatMap(commit => commit.fileNames))].sort(),
        assetCandidates: detail.inputSnapshot.assetCandidates || [],
        totalStats: commits.reduce((sum, commit) => ({
          added: sum.added + commit.stats.added,
          deleted: sum.deleted + commit.stats.deleted,
          files: sum.files + commit.stats.files,
        }), { added: 0, deleted: 0, files: 0 }),
        nextCursor: null,
        totalPending: commits.length,
        oldestAuthoredAt: commits.length ? Math.min(...commits.map(commit => commit.authoredAt)) : null,
        newestAuthoredAt: commits.length ? Math.max(...commits.map(commit => commit.authoredAt)) : null,
      })
      setSelected(detail.inputShas)
    }
    setHistoryOpen(false)
  }, [])

  const reopenRun = async (generationRunId: string) => {
    setBusyRunId(generationRunId)
    try {
      const detail = await window.vibe.ai.getRun(project.id, generationRunId)
      if (detail.status !== 'succeeded') throw new Error('只有已完成的 AI 运行可以重新打开')
      presentGeneration({
        payload: detail.output,
        metadata: {
          provider: detail.provider,
          model: detail.model,
          promptVersion: detail.promptVersion,
          inputHash: detail.inputHash,
        },
        draftIds: detail.drafts.map(draft => draft.id),
        generationRunId: detail.id,
        drafts: detail.drafts,
      }, detail)
    } catch (error) {
      notify({ tone: 'error', title: 'AI 运行重新打开失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyRunId('')
    }
  }

  const retryRun = async (generationRunId: string) => {
    if (generationRef.current) return
    generationRef.current = true
    setBusyRunId(generationRunId)
    setLoading(true)
    try {
      const generated = await window.vibe.ai.retryRun(project.id, generationRunId)
      const detail = await window.vibe.ai.getRun(project.id, generated.generationRunId)
      presentGeneration(generated, detail)
      await onChanged()
      await loadRuns()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notify(message.includes('操作已取消')
        ? { tone: 'info', title: 'AI 运行重试已取消' }
        : { tone: 'error', title: 'AI 运行重试失败', detail: message })
    } finally {
      generationRef.current = false
      setBusyRunId('')
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void loadRuns()
  }, [loadRuns, open])

  useEffect(() => {
    loadingRef.current = loading || applyingSuggestion
  }, [applyingSuggestion, loading])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setResult(null)
    setPreview(null)
    setSelected([])
    setPrepareError('')
    setPreviewLoadError('')
    setReviewedDraftIds([])
    setOpenedRun(null)
    void (async () => {
      try {
        await window.vibe.git.sync(project.id)
        const data = await window.vibe.ai.preview(project.id, { limit: 50, authoredAfter, authoredBefore })
        if (!cancelled) { setPreview(data); setSelected(data.shas) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!cancelled) setPrepareError(message)
        notify({ tone: 'error', title: '无法准备 AI 输入', detail: message })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authoredAfter, authoredBefore, open, prepareAttempt, project.id, notify])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) onClose()
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  const generate = async (regenerate = false) => {
    if (!selected.length || generationRef.current) return
    generationRef.current = true
    setLoading(true)
    try {
      const generated = await window.vibe.ai.generateDrafts(project.id, selected, regenerate && result ? { replaceDraftIds: result.draftIds } : undefined)
      const detail = await window.vibe.ai.getRun(project.id, generated.generationRunId)
      presentGeneration(generated, detail)
      await onChanged()
      await loadRuns()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notify(message.includes('操作已取消')
        ? { tone: 'info', title: 'AI 生成已取消' }
        : { tone: 'error', title: 'AI 生成失败', detail: message })
      await loadRuns()
    }
    finally {
      generationRef.current = false
      setLoading(false)
    }
  }
  const applySuggestion = async () => {
    const name = suggestion.name.trim()
    if (!name) {
      notify({ tone: 'error', title: '项目名称建议不能为空' })
      return
    }
    if (applyingSuggestionRef.current) return
    applyingSuggestionRef.current = true
    setApplyingSuggestion(true)
    try {
      const generationRunId = result?.generationRunId || openedRun?.id || ''
      await window.vibe.ai.applyProjectSuggestion(project.id, {
        generationRunId,
        name,
        description: suggestion.description,
        phase: suggestion.phase,
        tagNames: [...new Set(suggestion.tagNames.map(tagName => tagName.trim()).filter(Boolean))],
      })
      await refresh()
      await onChanged()
      try {
        const detail = await window.vibe.ai.getRun(project.id, generationRunId)
        setOpenedRun(detail)
        await loadRuns()
      } catch (error) {
        notify({ tone: 'info', title: '项目建议已应用', detail: `运行追溯刷新失败，可重新打开历史记录查看：${error instanceof Error ? error.message : String(error)}` })
        return
      }
      notify({ tone: 'success', title: '项目建议已应用' })
    } catch (error) {
      notify({ tone: 'error', title: '应用项目建议失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      applyingSuggestionRef.current = false
      setApplyingSuggestion(false)
    }
  }

  const applyRange = () => {
    const nextAfter = rangeTimestamp(rangeStart)
    const nextBefore = rangeTimestamp(rangeEnd, true)
    if (nextAfter !== undefined && nextBefore !== undefined && nextAfter > nextBefore) {
      notify({ tone: 'error', title: '提交日期范围无效', detail: '开始日期不能晚于结束日期。' })
      return
    }
    setAuthoredAfter(nextAfter)
    setAuthoredBefore(nextBefore)
    setPrepareAttempt(value => value + 1)
  }

  const clearRange = () => {
    setRangeStart('')
    setRangeEnd('')
    setAuthoredAfter(undefined)
    setAuthoredBefore(undefined)
    setPrepareAttempt(value => value + 1)
  }

  const loadMorePreview = async () => {
    if (!preview?.nextCursor || previewLoadingMoreRef.current) return
    previewLoadingMoreRef.current = true
    setPreviewLoadingMore(true)
    setPreviewLoadError('')
    try {
      const page = await window.vibe.ai.preview(project.id, {
        cursor: preview.nextCursor,
        limit: 50,
        authoredAfter,
        authoredBefore,
      })
      const commitsBySha = new Map(preview.commits.map(commit => [commit.sha, commit]))
      page.commits.forEach(commit => commitsBySha.set(commit.sha, commit))
      const commits = [...commitsBySha.values()].sort((a, b) => a.authoredAt - b.authoredAt || a.sha.localeCompare(b.sha))
      setPreview({
        ...page,
        commits,
        shas: commits.map(commit => commit.sha),
        assetCandidates: [...new Set([...preview.assetCandidates, ...page.assetCandidates])],
        files: [...new Set(commits.flatMap(commit => commit.fileNames))].sort(),
        totalStats: commits.reduce((sum, commit) => ({
          added: sum.added + commit.stats.added,
          deleted: sum.deleted + commit.stats.deleted,
          files: sum.files + commit.stats.files,
        }), { added: 0, deleted: 0, files: 0 }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPreviewLoadError(message)
      notify({ tone: 'error', title: '更多 AI 输入加载失败', detail: message })
    } finally {
      previewLoadingMoreRef.current = false
      setPreviewLoadingMore(false)
    }
  }

  return createPortal(<div className={`fixed inset-0 ${loading ? 'z-[115]' : 'z-[135]'} bg-black/70 p-4 grid place-items-center`}><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-sync-title" className="w-full max-w-5xl max-h-[92vh] overflow-x-hidden overflow-y-auto rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl outline-none"><header className="sticky top-0 z-10 min-h-16 px-5 py-3 flex items-center justify-between gap-4 border-b border-border-subtle bg-bg-secondary/95 backdrop-blur"><div className="min-w-0"><h2 id="ai-sync-title" className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-accent-blue" />AI 同步与审核</h2><p className="text-xs text-text-tertiary mt-1">先同步事实，再明确预览发送范围。完整源码与 diff 默认不会发送。</p></div><div className="flex flex-shrink-0 items-center gap-2"><button type="button" aria-pressed={historyOpen} disabled={applyingSuggestion} onClick={() => setHistoryOpen(value => !value)} className={`h-9 px-3 rounded-lg border text-xs flex items-center gap-1.5 disabled:opacity-40 ${historyOpen ? 'border-accent-blue/40 text-accent-blue bg-accent-blue/10' : 'border-border-subtle text-text-secondary'}`}><History size={13} />历史运行</button><button ref={closeButtonRef} aria-label="关闭 AI 同步" onClick={onClose} disabled={loading || applyingSuggestion} className="w-9 h-9 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><X size={17} /></button></div></header>
    <div className="p-5 space-y-4">{historyOpen ? <AiRunHistoryPanel runs={runs} loading={historyLoading} busyRunId={busyRunId} onReload={() => void loadRuns()} onOpen={runId => void reopenRun(runId)} onRetry={runId => void retryRun(runId)} /> : loading && !preview ? <div className="py-28 text-center"><Loader2 size={28} className="mx-auto animate-spin text-accent-blue" /><p className="text-sm text-text-secondary mt-3">正在扫描增量 Git 提交…</p></div> : prepareError ? <div className="py-20 text-center"><GitCommit size={28} className="mx-auto text-accent-red" /><p className="text-sm mt-3">Git 同步或输入准备失败。</p><p className="text-xs text-text-tertiary mt-2 max-w-xl mx-auto break-words">{prepareError}</p><p className="text-xs text-text-tertiary mt-2">为避免使用过期事实，本次不会继续生成。</p><button onClick={() => setPrepareAttempt(value => value + 1)} className="mt-5 h-9 px-4 rounded-lg border border-border-primary text-sm inline-flex items-center gap-2"><RefreshCcw size={13} />重新同步</button></div> : !preview?.commits.length ? <div className="py-24 text-center"><GitCommit size={28} className="mx-auto text-text-tertiary" /><p className="text-sm mt-3">当前范围没有尚未生成记录的 Git 提交。</p><p className="text-xs text-text-tertiary mt-1">Git 导入和手工记录仍可正常使用，无需配置 LLM。</p>{(authoredAfter !== undefined || authoredBefore !== undefined) && <button onClick={clearRange} className="mt-4 h-9 px-4 rounded-lg border border-border-subtle text-xs">清除日期范围</button>}</div> : !result ? <>
      <section className="rounded-xl border border-border-subtle bg-bg-primary/40 p-4 space-y-3"><div className="flex flex-wrap items-end gap-2"><label className="text-[11px] text-text-tertiary space-y-1">开始日期<input type="date" value={rangeStart} onChange={event => setRangeStart(event.target.value)} className="block h-8 px-2 rounded-lg bg-bg-secondary border border-border-subtle text-xs text-text-secondary" /></label><label className="text-[11px] text-text-tertiary space-y-1">结束日期<input type="date" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} className="block h-8 px-2 rounded-lg bg-bg-secondary border border-border-subtle text-xs text-text-secondary" /></label><button onClick={applyRange} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary">应用范围</button>{(authoredAfter !== undefined || authoredBefore !== undefined) && <button onClick={clearRange} className="h-8 px-3 rounded-lg text-xs text-text-tertiary">清除</button>}<span className="ml-auto text-[11px] text-text-tertiary">已加载 {preview.commits.length} / {preview.totalPending} 条待处理提交</span></div><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">将发送 {selected.length} 个提交</h3><p className="text-xs text-text-tertiary mt-1">文件名 {selectedFiles.length} 个 · 截图候选 {preview.assetCandidates.length} 个 · +{selectedStats.added}/-{selectedStats.deleted} · 约 {formatBytes(estimatedInputBytes)} · 不发送源码或 diff</p></div><div className="flex items-center gap-2"><button onClick={() => setSelected(preview.shas)} className="h-8 px-2.5 rounded-lg border border-border-subtle text-xs">全选已加载</button><button onClick={() => setSelected([])} className="h-8 px-2.5 rounded-lg border border-border-subtle text-xs">清空</button><button onClick={() => setFilesOpen(value => !value)} className="h-8 px-3 rounded-lg border border-border-subtle text-xs flex items-center gap-1"><ChevronDown size={13} className={filesOpen ? 'rotate-180' : ''} />输入详情</button></div></div>{selected.length > 200 && <p className="text-xs text-accent-red">单次最多生成 200 个提交，请减少选择或分批生成。</p>}{estimatedInputBytes > 1.75 * 1024 * 1024 && <p className="text-xs text-accent-orange">当前提交数据已接近 2 MB 请求上限；实际请求还包含项目规则和历史记录，建议缩小范围。</p>}{filesOpen && <div className="space-y-3 max-h-48 overflow-auto"><div><p className="text-[10px] text-text-tertiary mb-1.5">文件名</p><div className="flex flex-wrap gap-1.5">{selectedFiles.map(file => <code key={file} className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-text-tertiary">{file}</code>)}</div></div>{preview.assetCandidates.length > 0 && <div><p className="text-[10px] text-text-tertiary mb-1.5">真实截图候选</p><div className="flex flex-wrap gap-1.5">{preview.assetCandidates.map(asset => <code key={asset} className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-text-tertiary break-all">{asset}</code>)}</div></div>}</div>}</section>
      <div className="rounded-xl border border-border-subtle divide-y divide-border-subtle">{preview.commits.map(commit => { const checked = selected.includes(commit.sha); return <label key={commit.sha} className="p-3 flex items-start gap-3 hover:bg-bg-tertiary/30"><input type="checkbox" checked={checked} onChange={() => setSelected(current => checked ? current.filter(sha => sha !== commit.sha) : [...current, commit.sha])} className="mt-1" /><code className="text-xs text-accent-blue mt-0.5">{commit.sha.slice(0, 8)}</code><span className="min-w-0"><strong className="block text-sm truncate">{commit.subject}</strong><span className="block text-[11px] text-text-tertiary mt-1">{formatDateTime(commit.authoredAt)} · {commit.stats.files} 文件</span></span></label> })}</div>
      {previewLoadError && <p className="text-xs text-accent-red break-words">{previewLoadError}</p>}
      <div className="flex items-center justify-between gap-3">{preview.nextCursor ? <button onClick={() => void loadMorePreview()} disabled={previewLoadingMore} className="h-9 px-4 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-2 disabled:opacity-40">{previewLoadingMore && <Loader2 size={13} className="animate-spin" />}加载更多待处理提交</button> : <span className="text-[11px] text-text-tertiary">当前日期范围已全部加载</span>}<button autoFocus onClick={() => generate(false)} disabled={loading || !selected.length || selected.length > 200} className="h-10 px-5 rounded-lg bg-text-primary text-primary text-sm font-semibold flex items-center gap-2 disabled:opacity-40">{loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}生成待审核草稿</button></div>
    </> : <>{openedRun && <RunTracePanel run={openedRun} />}<ResultReview result={result} suggestion={suggestion} setSuggestion={setSuggestion} applying={applyingSuggestion} onApplySuggestion={applySuggestion} onChanged={onChanged} onReviewed={draftId => setReviewedDraftIds(current => [...new Set([...current, draftId])])} /></>}</div>
    {result && !historyOpen && <footer className="sticky bottom-0 px-5 py-4 border-t border-border-subtle bg-bg-secondary/95 flex justify-between gap-3"><div><button onClick={() => openedRun ? void retryRun(openedRun.id) : void generate(true)} disabled={loading || applyingSuggestion || reviewedDraftIds.length > 0} title={reviewedDraftIds.length ? '已有草稿完成审核，请关闭后从未处理提交重新生成' : undefined} className="h-9 px-3 rounded-lg border border-border-subtle text-xs flex items-center gap-2 disabled:opacity-40"><RefreshCcw size={13} />按原范围重新生成</button>{reviewedDraftIds.length > 0 && <p className="text-[10px] text-text-tertiary mt-1">已有草稿完成审核，当前批次不再整体替换。</p>}</div><button disabled={applyingSuggestion} onClick={onClose} className="h-9 px-4 rounded-lg bg-text-primary text-primary text-sm font-semibold disabled:opacity-40">完成审核</button></footer>}
  </section></div>, document.body)
}

function RunTracePanel({ run }: { run: AiGenerationRunDetail }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-primary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">生成追溯</h3>
          <p className="text-[11px] text-text-tertiary mt-1">Run {run.id.slice(0, 8)} · {run.provider} / {run.model} · {run.promptVersion}{run.rulesVersion > 0 ? ` · 规则 v${run.rulesVersion}` : ''}</p>
        </div>
        <span className="text-[11px] text-text-tertiary">{formatDateTime(run.createdAt)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">{run.inputShas.map(sha => <code key={sha} title={sha} className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-accent-blue">{sha.slice(0, 10)}</code>)}</div>
      <p className="text-[10px] text-text-tertiary mt-3 break-all">inputHash: {run.inputHash || '未生成'}</p>
      {run.projectSuggestionApplications.length > 0 && <SuggestionApplicationHistory applications={run.projectSuggestionApplications} />}
      <details className="mt-3 rounded-lg border border-border-subtle bg-bg-secondary/40 p-3">
        <summary className="cursor-pointer text-xs text-text-secondary">查看规则、设置与输入快照</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-5 text-text-tertiary">{JSON.stringify({
          rules: run.rulesSnapshot,
          settings: run.settingsSnapshot,
          project: run.inputSnapshot.project,
          assetCandidates: run.inputSnapshot.assetCandidates,
          commits: run.inputSnapshot.commits?.map(commit => ({ sha: commit.sha, subject: commit.subject, files: commit.fileNames, stats: commit.stats })),
        }, null, 2)}</pre>
      </details>
    </section>
  )
}

const suggestionApplicationFields = [
  { label: '项目名称', beforeKey: 'name', appliedKey: 'name' },
  { label: '项目简介', beforeKey: 'description', appliedKey: 'description' },
  { label: '当前阶段', beforeKey: 'phase', appliedKey: 'phase' },
  { label: '项目标签', beforeKey: 'tags', appliedKey: 'tagNames' },
] as const

function formatSuggestionSnapshotValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '未设置'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const items = value.map(item => {
      if (typeof item === 'string' || typeof item === 'number') return String(item)
      if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { name?: unknown }).name === 'string') {
        return String((item as { name: string }).name)
      }
      return ''
    }).filter(Boolean)
    return items.length ? items.join('、') : '未设置'
  }
  return '已记录结构化值'
}

function SuggestionApplicationHistory({ applications }: { applications: AiProjectSuggestionApplication[] }) {
  return (
    <details className="mt-3 rounded-lg border border-status-completed/25 bg-status-completed/[0.05] p-3">
      <summary className="cursor-pointer text-xs text-status-completed">
        项目资料建议已明确应用 {applications.length} 次 · 查看应用前后差异
      </summary>
      <div className="mt-3 space-y-3">
        {applications.map((application, index) => (
          <article key={application.id} className="rounded-lg border border-border-subtle bg-bg-primary/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs">第 {applications.length - index} 次应用</strong>
              <span className="text-[10px] text-text-tertiary">{formatDateTime(application.createdAt)} · {application.id.slice(0, 8)}</span>
            </div>
            <dl className="mt-3 grid gap-2">
              {suggestionApplicationFields.map(field => (
                <div key={field.label} className="grid min-[720px]:grid-cols-[84px_minmax(0,1fr)_18px_minmax(0,1fr)] gap-2 text-[11px] items-start">
                  <dt className="text-text-tertiary">{field.label}</dt>
                  <dd className="min-w-0 break-words text-text-secondary">{formatSuggestionSnapshotValue(application.before[field.beforeKey])}</dd>
                  <span aria-hidden="true" className="text-text-tertiary">→</span>
                  <dd className="min-w-0 break-words text-text-primary">{formatSuggestionSnapshotValue(application.applied[field.appliedKey])}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="本次应用关联的 Git SHA">
              {application.inputShas.map(sha => <code key={sha} title={sha} className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-accent-blue">{sha.slice(0, 10)}</code>)}
            </div>
          </article>
        ))}
      </div>
    </details>
  )
}

function ResultReview({ result, suggestion, setSuggestion, applying, onApplySuggestion, onChanged, onReviewed }: { result: AiGenerationResult; suggestion: ProjectSuggestionDraft; setSuggestion: React.Dispatch<React.SetStateAction<ProjectSuggestionDraft>>; applying: boolean; onApplySuggestion: () => Promise<void>; onChanged: () => Promise<void>; onReviewed: (draftId: string) => void }) {
  const toggleTag = (name: string) => setSuggestion(current => ({ ...current, tagNames: current.tagNames.includes(name) ? current.tagNames.filter(item => item !== name) : [...current.tagNames, name] }))
  return <><section aria-busy={applying} className="rounded-xl border border-border-subtle bg-bg-primary/40 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">项目资料建议</h3><p className="text-[11px] text-text-tertiary mt-1">置信度 {Math.round(result.payload.project.confidence * 100)}% · {result.metadata.provider} / {result.metadata.model}</p></div><button disabled={applying || !suggestion.name.trim()} onClick={onApplySuggestion} className="h-8 px-3 rounded-lg border border-border-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">{applying && <Loader2 size={12} className="animate-spin" />}{applying ? '应用中…' : '明确应用建议'}</button></div><div className="grid md:grid-cols-2 gap-2 mt-3"><label className="sr-only" htmlFor="ai-project-name-suggestion">项目名称建议</label><input id="ai-project-name-suggestion" disabled={applying} value={suggestion.name} onChange={event => setSuggestion(current => ({ ...current, name: event.target.value }))} className="h-9 px-3 rounded-lg bg-bg-secondary border border-border-subtle text-sm disabled:opacity-50" /><label className="sr-only" htmlFor="ai-project-phase-suggestion">项目阶段建议</label><input id="ai-project-phase-suggestion" disabled={applying} value={suggestion.phase} onChange={event => setSuggestion(current => ({ ...current, phase: event.target.value }))} className="h-9 px-3 rounded-lg bg-bg-secondary border border-border-subtle text-sm disabled:opacity-50" /><label className="sr-only" htmlFor="ai-project-description-suggestion">项目简介建议</label><textarea id="ai-project-description-suggestion" disabled={applying} value={suggestion.description} onChange={event => setSuggestion(current => ({ ...current, description: event.target.value }))} className="md:col-span-2 h-20 p-3 rounded-lg bg-bg-secondary border border-border-subtle text-sm resize-y disabled:opacity-50" /></div><p className="text-[11px] text-text-tertiary mt-2">阶段理由：{result.payload.project.phaseReason || '未提供'} · 证据：{result.payload.project.evidence.join('；') || '未提供'}</p><div className="flex flex-wrap gap-1 mt-2">{result.payload.project.tags.map(tag => { const selected = suggestion.tagNames.includes(tag); return <button type="button" disabled={applying} onClick={() => toggleTag(tag)} key={tag} className={`text-[10px] px-2 py-1 rounded border disabled:opacity-40 ${selected ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle bg-bg-secondary text-text-tertiary'}`}>{selected ? '将应用：' : '标签建议：'}{tag}</button> })}{result.payload.project.techStack.map(item => { const selected = suggestion.tagNames.includes(item); return <button type="button" disabled={applying} onClick={() => toggleTag(item)} key={item} className={`text-[10px] px-2 py-1 rounded border disabled:opacity-40 ${selected ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle bg-bg-secondary text-text-tertiary'}`}>{selected ? '将作为标签：' : '技术栈：'}{item}</button> })}</div>{result.payload.assetNotes.length > 0 && <div className="mt-3 space-y-1">{result.payload.assetNotes.map(note => <p key={`${note.path}:${note.note}`} className="text-[11px] text-text-tertiary break-all">截图候选：{note.path} — {note.note}</p>)}</div>}</section><div className="space-y-2">{result.drafts.map(draft => <DialogDraft key={draft.id} draft={draft} onChanged={onChanged} onReviewed={onReviewed} />)}</div></>
}

function DialogDraft({ draft, onChanged, onReviewed }: { draft: DevelopmentRecord; onChanged: () => Promise<void>; onReviewed: (draftId: string) => void }) {
  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description)
  const [done, setDone] = useState<'accepted' | 'rejected' | null>(draft.reviewStatus === 'accepted' || draft.reviewStatus === 'rejected' ? draft.reviewStatus : null)
  const [busy, setBusy] = useState(false)
  const reviewRef = useRef(false)
  const { notify } = useNotifications()
  const review = async (status: 'accepted' | 'rejected', ignoreGitShas = false) => {
    if (!title.trim()) return notify({ tone: 'error', title: '草稿标题不能为空' })
    if (done || reviewRef.current) return
    reviewRef.current = true
    setBusy(true)
    try {
      const reviewed = await window.vibe.records.review(draft.id, { status, title: title.trim(), description, ignoreGitShas })
      if (!reviewed) throw new Error('草稿不存在或已经完成审核')
      setDone(status)
      onReviewed(draft.id)
      await onChanged()
      notify({ tone: 'success', title: status === 'accepted' ? '草稿已接受' : ignoreGitShas ? '草稿已拒绝，关联提交已忽略' : '草稿已拒绝，可稍后重新生成' })
    } catch (error) {
      notify({ tone: 'error', title: '草稿审核失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      reviewRef.current = false
      setBusy(false)
    }
  }
  return <article className={`rounded-xl border p-4 ${done ? 'border-border-subtle opacity-60' : 'border-accent-blue/30 bg-accent-blue/[0.05]'}`}><div className="flex items-center justify-between"><span className="text-xs text-accent-blue">开发记录草稿</span><span className="text-[10px] text-text-tertiary">{draft.confidence === null || draft.confidence === undefined ? '' : `置信度 ${Math.round(draft.confidence * 100)}%`}</span>{done && <span className="text-xs text-status-completed flex items-center gap-1"><Check size={12} />{done === 'accepted' ? '已接受' : '已拒绝'}</span>}</div><input disabled={Boolean(done) || busy} value={title} onChange={event => setTitle(event.target.value)} className="w-full mt-2 h-9 px-2 rounded-lg bg-bg-primary border border-border-subtle text-sm" /><textarea disabled={Boolean(done) || busy} value={description} onChange={event => setDescription(event.target.value)} className="w-full mt-2 h-20 p-2 rounded-lg bg-bg-primary border border-border-subtle text-sm resize-y" />{draft.evidence && draft.evidence.length > 0 && <p className="text-[11px] text-text-tertiary mt-2">证据：{draft.evidence.join('；')}</p>}<div className="mt-3 flex items-center justify-between gap-3"><div className="flex flex-wrap gap-1">{draft.gitShas?.map(sha => <code title={sha} key={sha} className="text-[10px] px-2 py-1 rounded bg-bg-primary text-accent-blue">{sha.slice(0, 10)}</code>)}</div>{!done && <div className="flex flex-wrap justify-end gap-2"><button disabled={busy} onClick={() => void review('rejected', true)} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-tertiary disabled:opacity-40">拒绝并忽略提交</button><button disabled={busy} onClick={() => void review('rejected')} className="h-8 px-3 rounded-lg border border-border-subtle text-xs disabled:opacity-40">仅拒绝</button><button disabled={busy || !title.trim()} onClick={() => void review('accepted')} className="h-8 px-3 rounded-lg bg-text-primary text-primary text-xs font-semibold disabled:opacity-40">{busy ? '处理中' : '接受'}</button></div>}</div></article>
}
