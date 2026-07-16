import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, EyeOff, GitCommit, ImagePlus, Link2, Loader2, Pencil, Plus, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { DevelopmentRecord, GitCommitFact, Project } from '../../types'
import { formatDateTime } from '../../lib/projectView'
import { SafeImage } from '../../components/SafeImage'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useNotifications } from '../../lib/notifications'

function toLocalDateTime(timestamp = Date.now()) {
  const date = new Date(timestamp - new Date().getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function appendUnique<T>(current: T[], incoming: T[], keyOf: (item: T) => string) {
  const known = new Set(current.map(keyOf))
  return [...current, ...incoming.filter(item => {
    const key = keyOf(item)
    if (known.has(key)) return false
    known.add(key)
    return true
  })]
}

export function DevelopmentRecordsTab({ project, refreshKey = 0, onChanged }: { project: Project; refreshKey?: number; onChanged: () => Promise<void> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSha = searchParams.get('sha') || ''
  const requestedRecordId = searchParams.get('record') || ''
  const [view, setView] = useState<'records' | 'git'>(searchParams.get('view') === 'git' ? 'git' : 'records')
  const [records, setRecords] = useState<DevelopmentRecord[]>([])
  const [drafts, setDrafts] = useState<DevelopmentRecord[]>([])
  const [recordCursor, setRecordCursor] = useState<string | null>(null)
  const [gitCommits, setGitCommits] = useState<GitCommitFact[]>([])
  const [gitCursor, setGitCursor] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [createdAt, setCreatedAt] = useState(toLocalDateTime())
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [selectedGitShas, setSelectedGitShas] = useState<string[]>([])
  const [gitPickerOpen, setGitPickerOpen] = useState(false)
  const [trackingBusySha, setTrackingBusySha] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [recordPageLoading, setRecordPageLoading] = useState(false)
  const [gitPageLoading, setGitPageLoading] = useState(false)
  const [recordPageError, setRecordPageError] = useState('')
  const [gitPageError, setGitPageError] = useState('')
  const [locateError, setLocateError] = useState('')
  const [pendingDeleteRecordId, setPendingDeleteRecordId] = useState('')
  const [deletingRecord, setDeletingRecord] = useState(false)
  const recordPageRequestRef = useRef<Promise<boolean> | null>(null)
  const gitPageRequestRef = useRef<Promise<boolean> | null>(null)
  const loadEpochRef = useRef(0)
  const createRecordRef = useRef(false)
  const deleteRecordRef = useRef(false)
  const { notify } = useNotifications()

  const load = useCallback(async () => {
    const epoch = loadEpochRef.current + 1
    loadEpochRef.current = epoch
    setInitialLoading(true)
    setRecordPageLoading(false)
    setGitPageLoading(false)
    setLoadError('')
    setRecordPageError('')
    setGitPageError('')
    try {
      const [recordPage, draftItems, gitPage] = await Promise.all([
        window.vibe.records.list(project.id, { limit: 20 }),
        window.vibe.records.drafts(project.id),
        window.vibe.git.list(project.id, { limit: 30 }),
      ])
      if (loadEpochRef.current !== epoch) return
      setRecords(recordPage.items)
      setRecordCursor(recordPage.nextCursor)
      setDrafts(draftItems)
      setGitCommits(gitPage.items)
      setGitCursor(gitPage.nextCursor)
    } catch (error) {
      if (loadEpochRef.current !== epoch) return
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      notify({ tone: 'error', title: '开发记录加载失败', detail: message })
    } finally {
      if (loadEpochRef.current === epoch) setInitialLoading(false)
    }
  }, [project.id, notify])
  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    if (requestedRecordId) setView('records')
    else if (searchParams.get('view') === 'git' || requestedSha) setView('git')
  }, [requestedRecordId, requestedSha, searchParams])
  useEffect(() => setLocateError(''), [project.id, requestedRecordId, requestedSha])
  useEffect(() => {
    if (view !== 'git') return
    const unseen = gitCommits.filter(commit => !commit.seenAt).map(commit => commit.sha)
    if (!unseen.length) return
    const seenAt = Date.now()
    setGitCommits(current => current.map(commit => unseen.includes(commit.sha) ? { ...commit, seenAt } : commit))
    void window.vibe.git.markSeen(project.id, unseen).catch(error => {
      notify({ tone: 'error', title: 'Git 已读状态保存失败', detail: error instanceof Error ? error.message : String(error) })
    })
  }, [gitCommits, notify, project.id, view])

  const createRecord = async () => {
    if (!title.trim() || createRecordRef.current) return
    createRecordRef.current = true
    setBusy(true)
    try {
      await window.vibe.records.create({ projectId: project.id, title: title.trim(), description: description.trim(), imagePaths, gitShas: selectedGitShas, createdAt: advanced ? new Date(createdAt).getTime() : undefined })
      setTitle(''); setDescription(''); setImagePaths([]); setSelectedGitShas([]); setGitPickerOpen(false); setAdvanced(false); setCreatedAt(toLocalDateTime())
      await load(); await onChanged()
      notify({ tone: 'success', title: '开发记录已保存' })
    } catch (error) { notify({ tone: 'error', title: '记录保存失败', detail: error instanceof Error ? error.message : String(error) }) }
    finally { createRecordRef.current = false; setBusy(false) }
  }
  const selectImages = async () => {
    try {
      const selected = await window.vibe.assets.chooseImages(true)
      if (Array.isArray(selected)) setImagePaths(paths => [...new Set([...paths, ...selected])])
    } catch (error) {
      notify({ tone: 'error', title: '选择截图失败', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  const loadMoreRecords = useCallback(() => {
    if (recordPageRequestRef.current) return recordPageRequestRef.current
    if (!recordCursor) return Promise.resolve(false)
    const cursor = recordCursor
    const epoch = loadEpochRef.current
    setRecordPageLoading(true)
    setRecordPageError('')
    const request = (async () => {
      try {
        const page = await window.vibe.records.list(project.id, { limit: 20, cursor })
        if (loadEpochRef.current !== epoch) return false
        setRecords(current => appendUnique(current, page.items, item => item.id))
        setRecordCursor(page.nextCursor)
        return true
      } catch (error) {
        if (loadEpochRef.current !== epoch) return false
        const message = error instanceof Error ? error.message : String(error)
        setRecordPageError(message)
        notify({ tone: 'error', title: '加载更早开发记录失败', detail: message })
        return false
      } finally {
        if (loadEpochRef.current === epoch) setRecordPageLoading(false)
        recordPageRequestRef.current = null
      }
    })()
    recordPageRequestRef.current = request
    return request
  }, [notify, project.id, recordCursor])
  const loadMoreGit = useCallback(() => {
    if (gitPageRequestRef.current) return gitPageRequestRef.current
    if (!gitCursor) return Promise.resolve(false)
    const cursor = gitCursor
    const epoch = loadEpochRef.current
    setGitPageLoading(true)
    setGitPageError('')
    const request = (async () => {
      try {
        const page = await window.vibe.git.list(project.id, { limit: 30, cursor })
        if (loadEpochRef.current !== epoch) return false
        setGitCommits(current => appendUnique(current, page.items, item => item.sha))
        setGitCursor(page.nextCursor)
        return true
      } catch (error) {
        if (loadEpochRef.current !== epoch) return false
        const message = error instanceof Error ? error.message : String(error)
        setGitPageError(message)
        notify({ tone: 'error', title: '加载更早 Git 提交失败', detail: message })
        return false
      } finally {
        if (loadEpochRef.current === epoch) setGitPageLoading(false)
        gitPageRequestRef.current = null
      }
    })()
    gitPageRequestRef.current = request
    return request
  }, [gitCursor, notify, project.id])
  useEffect(() => {
    if (view !== 'git' || !requestedSha || initialLoading) return
    const target = gitCommits.find(commit => commit.sha === requestedSha)
    if (target) {
      const frame = window.requestAnimationFrame(() => document.getElementById(`git-${requestedSha}`)?.scrollIntoView({ block: 'center' }))
      return () => window.cancelAnimationFrame(frame)
    }
    if (gitPageError || gitPageLoading) return
    if (gitCursor) {
      void loadMoreGit()
      return
    }
    setLocateError(`没有找到 Git 提交 ${requestedSha.slice(0, 12)}。它可能不属于当前仓库或已不可达。`)
  }, [gitCommits, gitCursor, gitPageError, gitPageLoading, initialLoading, loadMoreGit, requestedSha, view])
  useEffect(() => {
    if (view !== 'records' || !requestedRecordId || initialLoading) return
    const targetExists = drafts.some(draft => draft.id === requestedRecordId) || records.some(record => record.id === requestedRecordId)
    if (targetExists) {
      const frame = window.requestAnimationFrame(() => document.getElementById(`record-${requestedRecordId}`)?.scrollIntoView({ block: 'center' }))
      return () => window.cancelAnimationFrame(frame)
    }
    if (recordPageError || recordPageLoading) return
    if (recordCursor) {
      void loadMoreRecords()
      return
    }
    setLocateError('没有找到关联开发记录；记录可能已经删除或不属于当前项目。')
  }, [drafts, initialLoading, loadMoreRecords, recordCursor, recordPageError, recordPageLoading, records, requestedRecordId, view])
  const setDisposition = async (sha: string, disposition: 'pending' | 'handled' | 'ignored') => {
    setTrackingBusySha(sha)
    try {
      await window.vibe.git.setDisposition(project.id, sha, disposition)
      setSelectedGitShas(current => disposition === 'pending' ? current : current.filter(item => item !== sha))
      await load()
      await onChanged()
      notify({
        tone: 'success',
        title: disposition === 'pending' ? '提交已恢复为待处理' : disposition === 'handled' ? '提交已标记为处理完成' : '提交已忽略',
      })
    } catch (error) {
      notify({ tone: 'error', title: 'Git 提交状态更新失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setTrackingBusySha('')
    }
  }
  const startManualRecordFromCommit = (commit: GitCommitFact) => {
    setSelectedGitShas(current => [...new Set([...current, commit.sha])])
    if (!title.trim()) setTitle(commit.subject)
    setGitPickerOpen(true)
    setView('records')
  }
  const openLinkedRecord = (commit: GitCommitFact) => {
    if (!commit.activeRecord) return
    const next = new URLSearchParams(searchParams)
    next.set('view', 'records')
    next.set('record', commit.activeRecord.recordId)
    next.delete('sha')
    setSearchParams(next, { replace: true })
    setView('records')
  }

  const changeView = (nextView: 'records' | 'git') => {
    const next = new URLSearchParams(searchParams)
    next.set('view', nextView)
    if (nextView === 'records') next.delete('sha')
    else next.delete('record')
    setLocateError('')
    setView(nextView)
    setSearchParams(next, { replace: true })
  }

  const confirmDeleteRecord = async () => {
    if (!pendingDeleteRecordId || deleteRecordRef.current) return
    deleteRecordRef.current = true
    setDeletingRecord(true)
    try {
      const result = await window.vibe.records.delete(pendingDeleteRecordId)
      if (!result.deleted) throw new Error('开发记录不存在或已经删除')
      setPendingDeleteRecordId('')
      await load()
      await onChanged()
      if (result.assetFailures.length) {
        notify({
          tone: 'error',
          title: '记录已删除，但部分托管图片待后台重试清理',
          detail: result.assetFailures.map(item => String((item as { path?: string }).path || '')).filter(Boolean).join('；'),
        })
      } else {
        notify({ tone: 'success', title: '开发记录已删除' })
      }
    } catch (error) {
      notify({ tone: 'error', title: '开发记录删除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      deleteRecordRef.current = false
      setDeletingRecord(false)
    }
  }

  const locatingTarget = !locateError && !initialLoading && (
    (view === 'git' && Boolean(requestedSha) && !gitCommits.some(commit => commit.sha === requestedSha) && Boolean(gitCursor || gitPageLoading))
    || (view === 'records' && Boolean(requestedRecordId)
      && !drafts.some(draft => draft.id === requestedRecordId)
      && !records.some(record => record.id === requestedRecordId)
      && Boolean(recordCursor || recordPageLoading))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div className="inline-flex p-1 rounded-lg bg-bg-secondary border border-border-subtle"><button onClick={() => changeView('records')} className={`h-8 px-3 rounded-md text-sm ${view === 'records' ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary'}`}>开发记录</button><button onClick={() => changeView('git')} className={`h-8 px-3 rounded-md text-sm ${view === 'git' ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary'}`}>Git 事实</button></div>{drafts.length > 0 && <span className="text-xs text-accent-blue flex items-center gap-1.5"><Sparkles size={13} />{drafts.length} 条草稿待审核</span>}</div>
      {loadError && <div className="rounded-xl border border-accent-red/25 bg-accent-red/[0.06] px-4 py-3 flex items-center justify-between gap-4"><p className="text-xs text-accent-red break-words">{loadError}</p><button onClick={() => void load()} className="h-8 px-3 rounded-lg border border-accent-red/25 text-xs text-accent-red flex-shrink-0">重试加载</button></div>}
      {locatingTarget && <div className="rounded-xl border border-accent-blue/25 bg-accent-blue/[0.06] px-4 py-3 text-xs text-accent-blue flex items-center gap-2"><Loader2 size={13} className="animate-spin" />正在自动加载更早内容并定位目标…</div>}
      {locateError && <div className="rounded-xl border border-accent-orange/25 bg-accent-orange/[0.06] px-4 py-3 text-xs text-accent-orange">{locateError}</div>}

      {view === 'records' ? (
        <>
          <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-4">
            <div className="grid md:grid-cols-[0.75fr_1.25fr_auto] gap-3">
              <input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void createRecord() }} placeholder="这次完成了什么？" aria-label="开发记录标题" className="h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" />
              <input value={description} onChange={event => setDescription(event.target.value)} placeholder="补充关键变化（可选）" aria-label="开发记录内容" className="h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" />
              <button onClick={createRecord} disabled={busy || !title.trim()} className="h-10 px-4 rounded-lg bg-text-primary text-primary text-sm font-semibold flex items-center gap-2 disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}保存</button>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button onClick={selectImages} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5"><ImagePlus size={13} />添加截图{imagePaths.length ? ` (${imagePaths.length})` : ''}</button>
              <button onClick={() => setGitPickerOpen(value => !value)} aria-expanded={gitPickerOpen} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5"><Link2 size={13} />关联 Git{selectedGitShas.length ? ` (${selectedGitShas.length})` : ''}</button>
              <button onClick={() => setAdvanced(value => !value)} aria-expanded={advanced} className="h-8 px-3 rounded-lg text-xs text-text-tertiary flex items-center gap-1"><ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />高级选项</button>
              {advanced && <label className="text-xs text-text-tertiary flex items-center gap-2">记录时间<input type="datetime-local" value={createdAt} onChange={event => setCreatedAt(event.target.value)} className="h-8 px-2 rounded-lg bg-bg-primary border border-border-subtle" /></label>}
            </div>
            {imagePaths.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" aria-label="待保存截图">
                {imagePaths.map((imagePath, index) => (
                  <div key={imagePath} className="relative aspect-video overflow-hidden rounded-lg border border-border-subtle bg-bg-primary group">
                    <SafeImage src={imagePath} alt={`待保存截图 ${index + 1}`} previewable thumbnailSize={480} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      aria-label={`移除待保存截图 ${index + 1}`}
                      onClick={() => setImagePaths(paths => paths.filter(path => path !== imagePath))}
                      className="absolute right-1.5 top-1.5 w-7 h-7 rounded-md bg-black/70 text-white grid place-items-center opacity-90 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent-blue"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {gitPickerOpen && <div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary/55 p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">选择要归档到这条手工记录的待处理提交</p>{selectedGitShas.length > 0 && <button onClick={() => setSelectedGitShas([])} className="text-[11px] text-text-tertiary">清空</button>}</div><div className="mt-2 max-h-48 overflow-auto divide-y divide-border-subtle">{gitCommits.filter(commit => (commit.disposition || 'pending') === 'pending' && !commit.activeRecord).map(commit => { const checked = selectedGitShas.includes(commit.sha); return <label key={commit.sha} className="py-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={checked} onChange={() => setSelectedGitShas(current => checked ? current.filter(sha => sha !== commit.sha) : [...current, commit.sha])} className="mt-0.5" /><code className="text-accent-blue">{commit.sha.slice(0, 8)}</code><span className="min-w-0 truncate text-text-secondary">{commit.subject}</span></label> })}{!gitCommits.some(commit => (commit.disposition || 'pending') === 'pending' && !commit.activeRecord) && <p className="py-5 text-center text-xs text-text-tertiary">当前没有可归档的待处理 Git 提交。</p>}</div></div>}
          </section>

          {drafts.map(draft => <DraftCard key={draft.id} draft={draft} onReviewed={async () => { await load(); await onChanged() }} />)}

          <div className="space-y-2">{records.map(record => <RecordCard key={record.id} record={record} onUpdated={async () => { await load(); await onChanged() }} onDelete={() => setPendingDeleteRecordId(record.id)} />)}{!records.length && !drafts.length && <div className="rounded-xl border border-dashed border-border-subtle py-16 text-center text-sm text-text-tertiary">还没有开发记录。</div>}</div>
          {recordPageError && <div className="rounded-xl border border-accent-red/25 bg-accent-red/[0.06] px-4 py-3 flex items-center justify-between gap-3"><p className="text-xs text-accent-red break-words">{recordPageError}</p><button disabled={recordPageLoading} onClick={() => void loadMoreRecords()} className="h-8 px-3 rounded-lg border border-accent-red/25 text-xs text-accent-red disabled:opacity-40">重试</button></div>}
          {recordCursor && <div className="text-center"><button disabled={recordPageLoading} onClick={() => void loadMoreRecords()} className="h-9 px-4 rounded-lg border border-border-subtle text-sm text-text-secondary disabled:opacity-40 inline-flex items-center gap-2">{recordPageLoading && <Loader2 size={13} className="animate-spin" />}加载更早记录</button></div>}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-border-subtle bg-bg-secondary/50 divide-y divide-border-subtle">{gitCommits.map(commit => <GitFactCard key={commit.sha} commit={commit} highlighted={requestedSha === commit.sha} busy={trackingBusySha === commit.sha} onStartRecord={() => startManualRecordFromCommit(commit)} onOpenRecord={() => openLinkedRecord(commit)} onDisposition={disposition => void setDisposition(commit.sha, disposition)} />)}{!gitCommits.length && <p className="py-16 text-center text-sm text-text-tertiary">尚未同步 Git 提交。</p>}</div>
          {gitPageError && <div className="rounded-xl border border-accent-red/25 bg-accent-red/[0.06] px-4 py-3 flex items-center justify-between gap-3"><p className="text-xs text-accent-red break-words">{gitPageError}</p><button disabled={gitPageLoading} onClick={() => void loadMoreGit()} className="h-8 px-3 rounded-lg border border-accent-red/25 text-xs text-accent-red disabled:opacity-40">重试</button></div>}
          {gitCursor && <div className="text-center"><button disabled={gitPageLoading} onClick={() => void loadMoreGit()} className="h-9 px-4 rounded-lg border border-border-subtle text-sm text-text-secondary disabled:opacity-40 inline-flex items-center gap-2">{gitPageLoading && <Loader2 size={13} className="animate-spin" />}加载更早 Git 提交</button></div>}
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(pendingDeleteRecordId)}
        title="删除开发记录"
        message={`确认删除「${records.find(record => record.id === pendingDeleteRecordId)?.title || '这条开发记录'}」？关联 Git 提交会恢复为待处理；仅清理不再被引用的应用托管图片。`}
        confirmText="删除记录"
        pending={deletingRecord}
        onConfirm={() => void confirmDeleteRecord()}
        onCancel={() => { if (!deletingRecord) setPendingDeleteRecordId('') }}
      />
    </div>
  )
}

function GitFactCard({ commit, highlighted, busy, onStartRecord, onOpenRecord, onDisposition }: { commit: GitCommitFact; highlighted: boolean; busy: boolean; onStartRecord: () => void; onOpenRecord: () => void; onDisposition: (disposition: 'pending' | 'handled' | 'ignored') => void }) {
  const disposition = commit.disposition || 'pending'
  const activeRecord = commit.activeRecord
  const status = activeRecord?.reviewStatus === 'draft'
    ? 'draft'
    : activeRecord?.reviewStatus === 'accepted'
      ? 'handled'
      : disposition
  const statusLabel = status === 'draft' ? '待审核草稿' : status === 'handled' ? '已处理' : status === 'ignored' ? '已忽略' : '待处理'
  const statusClass = status === 'handled'
    ? 'bg-status-completed/10 text-status-completed'
    : status === 'ignored'
      ? 'bg-bg-tertiary text-text-tertiary'
      : status === 'draft'
        ? 'bg-accent-orange/10 text-accent-orange'
        : 'bg-accent-blue/10 text-accent-blue'

  return (
    <article id={`git-${commit.sha}`} className={`p-4 scroll-mt-24 ${highlighted ? 'bg-accent-blue/[0.08] ring-1 ring-inset ring-accent-blue/30' : ''}`}>
      <div className="flex items-start gap-3">
        <GitCommit size={15} className="text-text-tertiary mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs text-accent-blue">{commit.sha.slice(0, 10)}</code>
            <strong className="text-sm truncate">{commit.subject}</strong>
            <span className={`text-[10px] px-2 py-0.5 rounded ${statusClass}`}>{statusLabel}</span>
          </div>
          <p className="text-xs text-text-tertiary mt-1">{commit.authorName} · {formatDateTime(commit.authoredAt)} · {commit.stats.files} 文件 · +{commit.stats.added}/-{commit.stats.deleted}</p>
          <div className="flex flex-wrap gap-1 mt-2">{commit.fileNames.slice(0, 6).map(file => <code key={file} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-primary text-text-tertiary">{file}</code>)}</div>
          {activeRecord && <p className="mt-2 text-[11px] text-text-tertiary">{activeRecord.reviewStatus === 'draft' ? '已由待审核草稿占用' : '已由正式开发记录处理'}：{activeRecord.title}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {activeRecord ? (
              <button onClick={onOpenRecord} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary flex items-center gap-1.5">
                <Link2 size={11} />{activeRecord.reviewStatus === 'draft' ? '查看并审核草稿' : '查看开发记录'}
              </button>
            ) : disposition === 'pending' ? <>
              <button disabled={busy} onClick={onStartRecord} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary flex items-center gap-1.5 disabled:opacity-40"><Link2 size={11} />写入手工记录</button>
              <button disabled={busy} onClick={() => onDisposition('handled')} className="h-7 px-2.5 rounded-md border border-status-completed/30 text-[11px] text-status-completed flex items-center gap-1.5 disabled:opacity-40"><CheckCircle2 size={11} />标记已处理</button>
              <button disabled={busy} onClick={() => onDisposition('ignored')} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-tertiary flex items-center gap-1.5 disabled:opacity-40"><EyeOff size={11} />忽略</button>
            </> : (
              <button disabled={busy} onClick={() => onDisposition('pending')} className="h-7 px-2.5 rounded-md border border-border-subtle text-[11px] text-text-secondary flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={11} />恢复待处理</button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function RecordCard({ record, onUpdated, onDelete }: { record: DevelopmentRecord; onUpdated: () => Promise<void>; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(record.title)
  const [description, setDescription] = useState(record.description)
  const [createdAt, setCreatedAt] = useState(toLocalDateTime(record.createdAt))
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [captionImageId, setCaptionImageId] = useState('')
  const [caption, setCaption] = useState('')
  const [traceOpen, setTraceOpen] = useState(false)
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState('')
  const [deletingImage, setDeletingImage] = useState(false)
  const imageOperationRef = useRef(false)
  const { notify } = useNotifications()

  const beginEdit = () => {
    setTitle(record.title)
    setDescription(record.description)
    setCreatedAt(toLocalDateTime(record.createdAt))
    setEditing(true)
  }
  const save = async () => {
    const normalizedTitle = title.trim()
    const timestamp = new Date(createdAt).getTime()
    if (!normalizedTitle) {
      notify({ tone: 'error', title: '开发记录标题不能为空' })
      return
    }
    if (!Number.isFinite(timestamp)) {
      notify({ tone: 'error', title: '请选择有效的记录时间' })
      return
    }
    setBusy(true)
    try {
      const updated = await window.vibe.records.update(record.id, {
        title: normalizedTitle,
        description: description.trim(),
        createdAt: timestamp,
      })
      if (!updated) throw new Error('记录不存在或已不再是正式记录')
      await onUpdated()
      setEditing(false)
      notify({ tone: 'success', title: '开发记录已更新' })
    } catch (error) {
      notify({ tone: 'error', title: '记录更新失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }
  const addImages = async () => {
    if (imageOperationRef.current) return
    imageOperationRef.current = true
    setImageBusy(true)
    try {
      const selected = await window.vibe.assets.chooseImages(true)
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
      for (const imagePath of [...new Set(paths)]) await window.vibe.records.addImage(record.id, { imagePath, caption: '' })
      if (paths.length) {
        await onUpdated()
        notify({ tone: 'success', title: `已添加 ${paths.length} 张截图` })
      }
    } catch (error) {
      notify({ tone: 'error', title: '添加截图失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      imageOperationRef.current = false
      setImageBusy(false)
    }
  }
  const saveCaption = async () => {
    if (!captionImageId || imageOperationRef.current) return
    imageOperationRef.current = true
    setImageBusy(true)
    try {
      await window.vibe.records.updateImage(record.id, captionImageId, { caption: caption.trim() })
      setCaptionImageId('')
      await onUpdated()
      notify({ tone: 'success', title: '截图说明已更新' })
    } catch (error) {
      notify({ tone: 'error', title: '截图说明保存失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      imageOperationRef.current = false
      setImageBusy(false)
    }
  }
  const moveImage = async (imageId: string, direction: -1 | 1) => {
    if (imageOperationRef.current) return
    const images = [...(record.images || [])].sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt)
    const index = images.findIndex(image => image.id === imageId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= images.length) return
    ;[images[index], images[target]] = [images[target], images[index]]
    imageOperationRef.current = true
    setImageBusy(true)
    try {
      await window.vibe.records.reorderImages(record.id, images.map(image => image.id))
      await onUpdated()
    } catch (error) {
      notify({ tone: 'error', title: '截图排序失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      imageOperationRef.current = false
      setImageBusy(false)
    }
  }
  const confirmDeleteImage = async () => {
    const imageId = pendingDeleteImageId
    if (!imageId || imageOperationRef.current) return
    imageOperationRef.current = true
    setDeletingImage(true)
    setImageBusy(true)
    try {
      const result = await window.vibe.records.deleteImage(record.id, imageId)
      if (!result.deleted) throw new Error('截图不存在或已经删除')
      if (captionImageId === imageId) setCaptionImageId('')
      setPendingDeleteImageId('')
      await onUpdated()
      if (result.assetFailures.length) {
        notify({
          tone: 'error',
          title: '截图记录已删除，但托管文件待后台重试清理',
          detail: result.assetFailures.map(item => item.path).filter(Boolean).join('；'),
        })
      } else {
        notify({ tone: 'success', title: '截图已删除' })
      }
    } catch (error) {
      notify({ tone: 'error', title: '截图删除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      imageOperationRef.current = false
      setDeletingImage(false)
      setImageBusy(false)
    }
  }

  return <>
    <article id={`record-${record.id}`} className="rounded-xl border border-border-subtle bg-bg-secondary/50 p-4 scroll-mt-24">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        {editing ? <input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save() }} aria-label="编辑开发记录标题" autoFocus className="w-full h-9 px-2 rounded-lg bg-bg-primary border border-border-subtle text-sm font-medium outline-none focus:border-accent-blue" /> : <div className="flex items-center gap-2"><h3 className="font-medium">{record.title}</h3><span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary">{record.source === 'ai' ? 'AI · 已审核' : '手工'}</span></div>}
        {editing ? <label className="mt-2 text-xs text-text-tertiary flex items-center gap-2">记录时间<input type="datetime-local" value={createdAt} onChange={event => setCreatedAt(event.target.value)} className="h-8 px-2 rounded-lg bg-bg-primary border border-border-subtle outline-none focus:border-accent-blue" /></label> : <p className="text-xs text-text-tertiary mt-1">{formatDateTime(record.createdAt)}</p>}
      </div>
      <div className="flex items-center gap-1">
        {editing ? <>
          <button aria-label="取消编辑" disabled={busy} onClick={() => setEditing(false)} className="w-8 h-8 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><X size={14} /></button>
          <button aria-label="保存开发记录" disabled={busy || !title.trim()} onClick={() => void save()} className="w-8 h-8 grid place-items-center text-accent-blue hover:text-text-primary disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}</button>
        </> : <>
          <button aria-label="编辑开发记录" onClick={beginEdit} className="w-8 h-8 grid place-items-center text-text-tertiary hover:text-text-primary"><Pencil size={14} /></button>
          <button aria-label="删除开发记录" onClick={onDelete} className="w-8 h-8 grid place-items-center text-text-tertiary hover:text-accent-red"><Trash2 size={14} /></button>
        </>}
      </div>
    </div>
    {editing ? <textarea value={description} onChange={event => setDescription(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save() }} aria-label="编辑开发记录内容" className="w-full mt-3 min-h-24 p-2 rounded-lg bg-bg-primary border border-border-subtle text-sm text-text-secondary resize-y outline-none focus:border-accent-blue" /> : record.description && <p className="text-sm text-text-secondary mt-3 whitespace-pre-wrap leading-6">{record.description}</p>}
    {record.gitShas && record.gitShas.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{record.gitShas.map(sha => <code key={sha} className="text-[10px] px-2 py-1 rounded bg-bg-primary text-accent-blue" title={sha}>{sha.slice(0, 10)}</code>)}</div>}
    {record.source === 'ai' && <div className="mt-3"><button onClick={() => setTraceOpen(value => !value)} aria-expanded={traceOpen} className="h-7 px-2 rounded-md text-[11px] text-text-tertiary flex items-center gap-1 hover:text-text-secondary"><ChevronDown size={12} className={traceOpen ? 'rotate-180' : ''} />AI 生成追溯</button>{traceOpen && <dl className="mt-2 grid md:grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-bg-primary/60 p-3 text-[11px]"><div><dt className="text-text-tertiary">Provider / Model</dt><dd className="text-text-secondary mt-0.5 break-all">{record.provider || '—'} / {record.model || '—'}</dd></div><div><dt className="text-text-tertiary">Prompt Version</dt><dd className="text-text-secondary mt-0.5 font-mono break-all">{record.promptVersion || '—'}</dd></div><div className="md:col-span-2"><dt className="text-text-tertiary">Input Hash</dt><dd className="text-text-secondary mt-0.5 font-mono break-all">{record.inputHash || '—'}</dd></div>{record.evidence && record.evidence.length > 0 && <div className="md:col-span-2"><dt className="text-text-tertiary">证据</dt><dd className="text-text-secondary mt-0.5">{record.evidence.join('；')}</dd></div>}</dl>}</div>}
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">截图 {record.images?.length || 0} 张</span>
      <button type="button" disabled={imageBusy} onClick={() => void addImages()} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary flex items-center gap-1.5 disabled:opacity-40"><ImagePlus size={13} />添加截图</button>
    </div>
    {record.images && record.images.length > 0 && (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
        {[...record.images].sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt).map((image, index, images) => (
          <div key={image.id} className="rounded-lg overflow-hidden border border-border-subtle bg-bg-primary">
            <div className="aspect-video bg-bg-tertiary"><SafeImage src={image.imagePath} alt={image.caption || `开发截图 ${index + 1}`} previewable thumbnailSize={640} className="w-full h-full object-cover" /></div>
            <div className="p-2">
              {captionImageId === image.id ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={caption}
                    onChange={event => setCaption(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Escape') setCaptionImageId(''); if (event.key === 'Enter') void saveCaption() }}
                    aria-label={`编辑截图 ${index + 1} 说明`}
                    maxLength={1000}
                    className="min-w-0 flex-1 h-8 px-2 rounded-md bg-bg-secondary border border-border-subtle text-xs outline-none focus:border-accent-blue"
                  />
                  <button aria-label="取消编辑截图说明" disabled={imageBusy} onClick={() => setCaptionImageId('')} className="w-7 h-7 grid place-items-center text-text-tertiary"><X size={12} /></button>
                  <button aria-label="保存截图说明" disabled={imageBusy} onClick={() => void saveCaption()} className="w-7 h-7 grid place-items-center text-accent-blue disabled:opacity-40">{imageBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}</button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <p className="min-w-0 flex-1 text-[11px] text-text-tertiary truncate" title={image.caption || ''}>{image.caption || '未添加说明'}</p>
                  <button aria-label={`编辑截图 ${index + 1} 说明`} disabled={imageBusy} onClick={() => { setCaptionImageId(image.id); setCaption(image.caption || '') }} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><Pencil size={12} /></button>
                  <button aria-label={`将截图 ${index + 1} 前移`} disabled={imageBusy || index === 0} onClick={() => void moveImage(image.id, -1)} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-25"><ChevronLeft size={13} /></button>
                  <button aria-label={`将截图 ${index + 1} 后移`} disabled={imageBusy || index === images.length - 1} onClick={() => void moveImage(image.id, 1)} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-25"><ChevronRight size={13} /></button>
                  <button aria-label={`删除截图 ${index + 1}`} disabled={imageBusy} onClick={() => setPendingDeleteImageId(image.id)} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-accent-red disabled:opacity-40"><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
    </article>
    <ConfirmDialog
      isOpen={Boolean(pendingDeleteImageId)}
      title="删除截图"
      message="确认删除这张截图？仅当它是应用托管且已无其他引用时，才会同时清理对应文件；外部原图不会被删除。"
      confirmText="删除截图"
      pending={deletingImage}
      onConfirm={() => void confirmDeleteImage()}
      onCancel={() => { if (!deletingImage) setPendingDeleteImageId('') }}
    />
  </>
}

function DraftCard({ draft, onReviewed }: { draft: DevelopmentRecord; onReviewed: () => Promise<void> }) {
  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description)
  const [busy, setBusy] = useState(false)
  const reviewRef = useRef(false)
  const { notify } = useNotifications()
  const review = async (status: 'accepted' | 'rejected', ignoreGitShas = false) => {
    if (!title.trim()) {
      notify({ tone: 'error', title: '草稿标题不能为空' })
      return
    }
    if (reviewRef.current) return
    reviewRef.current = true
    setBusy(true)
    try {
      const reviewed = await window.vibe.records.review(draft.id, { status, title: title.trim(), description, ignoreGitShas })
      if (!reviewed) throw new Error('草稿不存在或已经完成审核')
      await onReviewed()
      notify({ tone: 'success', title: status === 'accepted' ? '草稿已接受' : ignoreGitShas ? '草稿已拒绝，关联提交已忽略' : '草稿已拒绝，可稍后重新生成' })
    } catch (error) {
      notify({ tone: 'error', title: '审核失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      reviewRef.current = false
      setBusy(false)
    }
  }
  return (
    <article id={`record-${draft.id}`} className="rounded-xl border border-accent-blue/30 bg-accent-blue/[0.06] p-4 scroll-mt-24">
      <div className="flex items-center justify-between">
        <span className="text-xs text-accent-blue flex items-center gap-1.5"><Sparkles size={13} />AI 草稿 · 审核前不会成为正式记录</span>
        {draft.model && <span className="text-[10px] text-text-tertiary">{draft.provider} / {draft.model}{draft.confidence !== undefined ? ` · ${Math.round(draft.confidence * 100)}%` : ''}</span>}
      </div>
      <label className="sr-only" htmlFor={`draft-title-${draft.id}`}>AI 草稿标题</label>
      <input id={`draft-title-${draft.id}`} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} className="w-full mt-3 h-9 px-2 rounded-lg bg-bg-primary/70 border border-border-subtle text-sm font-medium outline-none focus:border-accent-blue disabled:opacity-50" />
      <label className="sr-only" htmlFor={`draft-description-${draft.id}`}>AI 草稿内容</label>
      <textarea id={`draft-description-${draft.id}`} disabled={busy} value={description} onChange={event => setDescription(event.target.value)} className="w-full mt-2 min-h-20 p-2 rounded-lg bg-bg-primary/70 border border-border-subtle text-sm text-text-secondary resize-y outline-none focus:border-accent-blue disabled:opacity-50" />
      {draft.evidence && draft.evidence.length > 0 && <p className="text-[11px] text-text-tertiary mt-2">证据：{draft.evidence.join('；')}</p>}
      <div className="flex items-center justify-between gap-3 mt-3">
        <div className="flex flex-wrap gap-1">{draft.gitShas?.map(sha => <code key={sha} title={sha} className="text-[10px] px-2 py-1 rounded bg-bg-primary text-accent-blue">{sha.slice(0, 10)}</code>)}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={busy} onClick={() => review('rejected', true)} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-tertiary">拒绝并忽略提交</button>
          <button disabled={busy} onClick={() => review('rejected')} className="h-8 px-3 rounded-lg border border-border-subtle text-xs text-text-secondary">仅拒绝</button>
          <button disabled={busy || !title.trim()} onClick={() => review('accepted')} className="h-8 px-3 rounded-lg bg-text-primary text-primary text-xs font-semibold">接受</button>
        </div>
      </div>
    </article>
  )
}
