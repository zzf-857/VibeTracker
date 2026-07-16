import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Play, Plus, Save, Square, Trash2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { LaunchProfile, LaunchRuntimeState, Project } from '../../types'
import { useNotifications } from '../../lib/notifications'

interface Draft {
  id?: string
  name: string
  executable: string
  argsText: string
  cwd: string
  envText: string
  readyUrl: string
  readyPort: string
  enabled: boolean
}

function fromProfile(profile: LaunchProfile): Draft {
  return {
    id: profile.id,
    name: profile.name,
    executable: profile.executable,
    argsText: profile.args.join('\n'),
    cwd: profile.cwd,
    envText: Object.entries(profile.env).map(([key, value]) => `${key}=${value}`).join('\n'),
    readyUrl: profile.readyUrl,
    readyPort: profile.readyPort ? String(profile.readyPort) : '',
    enabled: profile.enabled,
  }
}

function emptyDraft(projectPath: string): Draft {
  return {
    name: '开发服务器',
    executable: navigator.userAgent.includes('Windows') ? 'npm.cmd' : 'npm',
    argsText: 'run\ndev',
    cwd: projectPath,
    envText: '',
    readyUrl: '',
    readyPort: '',
    enabled: true,
  }
}

function parseEnv(text: string) {
  return Object.fromEntries(text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const index = line.indexOf('=')
    return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, '']
  }))
}

export function LaunchProfilesPanel({ project, onChanged, refreshKey = 0 }: { project: Project; onChanged: () => Promise<void>; refreshKey?: number }) {
  const projectPath = project.canonicalPath || project.path || ''
  const [profiles, setProfiles] = useState<LaunchProfile[]>([])
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(projectPath))
  const [runtime, setRuntime] = useState<LaunchRuntimeState | null>(null)
  const [confirmProfile, setConfirmProfile] = useState<LaunchProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const runtimeRequestRef = useRef(0)
  const confirmDialogRef = useRef<HTMLDivElement | null>(null)
  const busyRef = useRef(false)
  const [searchParams] = useSearchParams()
  const requestedProfileId = searchParams.get('profile') || ''
  const { notify } = useNotifications()

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    if (!confirmProfile) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        setConfirmProfile(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = confirmDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        event.preventDefault()
        confirmDialogRef.current?.focus()
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
    document.addEventListener('keydown', onKeyDown)
    confirmDialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [confirmProfile])

  const selectProfile = useCallback(async (profile: LaunchProfile) => {
    const requestId = ++runtimeRequestRef.current
    setDraft(fromProfile(profile))
    setRuntime(null)
    try {
      const nextRuntime = await window.vibe.launch.status(profile.id)
      if (runtimeRequestRef.current === requestId) setRuntime(nextRuntime)
    } catch (error) {
      if (runtimeRequestRef.current === requestId) {
        notify({ tone: 'error', title: '启动状态读取失败', detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }, [notify])

  const startNewProfile = useCallback(() => {
    runtimeRequestRef.current += 1
    setDraft(emptyDraft(projectPath))
    setRuntime(null)
  }, [projectPath])

  const load = useCallback(async (preferredProfileId?: string) => {
    setLoadError('')
    try {
      const items = await window.vibe.launch.list(project.id)
      setProfiles(items)
      const selected = (preferredProfileId ? items.find(item => item.id === preferredProfileId) : undefined) || items[0]
      if (selected) await selectProfile(selected)
      else startNewProfile()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      notify({ tone: 'error', title: '启动配置加载失败', detail: message })
    }
  }, [notify, project.id, selectProfile, startNewProfile])

  useEffect(() => {
    void load(requestedProfileId || undefined)
  }, [load, requestedProfileId, refreshKey])

  useEffect(() => window.vibe.launch.onState(state => {
    if (state.projectId === project.id && state.profileId === draft.id) {
      runtimeRequestRef.current += 1
      setRuntime(state)
    }
  }), [project.id, draft.id])

  useEffect(() => {
    if (!projectPath) return
    setDraft(current => current.id || current.cwd ? current : { ...current, cwd: projectPath })
  }, [projectPath])

  const payload = useMemo(() => ({
    id: draft.id,
    projectId: project.id,
    name: draft.name.trim(),
    executable: draft.executable,
    args: draft.argsText.split('\n').map(line => line.trim()).filter(Boolean),
    cwd: draft.cwd,
    env: parseEnv(draft.envText),
    readyUrl: draft.readyUrl.trim(),
    readyPort: draft.readyPort ? Number(draft.readyPort) : null,
    enabled: draft.enabled,
  }), [draft, project.id])

  const save = async () => {
    setBusy(true)
    try {
      const saved = await window.vibe.launch.save(payload)
      setDraft(fromProfile(saved))
      await load(saved.id)
      await onChanged()
      notify({ tone: 'success', title: '启动配置已保存', detail: saved.validated ? '配置未变化，确认状态保留。' : '首次执行前需要确认实际命令。' })
    } catch (error) {
      notify({ tone: 'error', title: '启动配置保存失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const requestStart = async () => {
    setBusy(true)
    try {
      // Save first so the confirmation always reflects the exact current executable/args/cwd.
      const profile = await window.vibe.launch.save(payload)
      setDraft(fromProfile(profile))
      await load(profile.id)
      await onChanged()
      if (!profile.validated) setConfirmProfile(profile)
      else setRuntime(await window.vibe.launch.start(profile.id))
    } catch (error) {
      notify({ tone: 'error', title: '启动失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const confirmAndStart = async () => {
    if (!confirmProfile) return
    setBusy(true)
    try {
      const confirmed = await window.vibe.launch.confirm(confirmProfile.id)
      setConfirmProfile(null)
      setDraft(fromProfile(confirmed))
      await load(confirmed.id)
      await onChanged()
      setRuntime(await window.vibe.launch.start(confirmed.id))
    } catch (error) {
      notify({ tone: 'error', title: '启动失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!draft.id) return
    setBusy(true)
    try {
      setRuntime(await window.vibe.launch.stop(draft.id))
    } catch (error) {
      notify({ tone: 'error', title: '停止失败，可再次重试', detail: error instanceof Error ? error.message : String(error) })
      setRuntime(await window.vibe.launch.status(draft.id))
    } finally {
      setBusy(false)
    }
  }

  const open = async () => {
    if (!draft.id) return
    setBusy(true)
    try {
      await window.vibe.launch.open(draft.id)
    } catch (error) {
      notify({ tone: 'error', title: '打开失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const deleteProfile = async () => {
    if (!draft.id) return
    setBusy(true)
    try {
      await window.vibe.launch.delete(draft.id)
      startNewProfile()
      await load()
      await onChanged()
      notify({ tone: 'success', title: '启动配置已删除' })
    } catch (error) {
      notify({ tone: 'error', title: '启动配置删除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const failedWithLiveProcess = runtime?.state === 'failed' && runtime.pid !== null
  const runtimeActive = runtime?.state === 'starting'
    || runtime?.state === 'running'
    || runtime?.state === 'ready'
    || failedWithLiveProcess
  const formDisabled = busy || runtimeActive
  const inputClassName = 'w-full rounded-lg bg-bg-primary border border-border-subtle disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">启动配置</h2>
          <p className="text-xs text-text-tertiary mt-1">扫描器只推荐；保存后仍需展示命令并由你确认，才会首次执行。</p>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="启动配置"
            value={draft.id || ''}
            disabled={busy}
            onChange={event => {
              const profile = profiles.find(item => item.id === event.target.value)
              if (profile) void selectProfile(profile)
              else startNewProfile()
            }}
            className="h-9 px-2 rounded-lg bg-bg-primary border border-border-subtle text-xs disabled:opacity-60"
          >
            <option value="">新配置</option>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.validated ? '' : ' · 待确认'}</option>)}
          </select>
          <button type="button" onClick={startNewProfile} disabled={busy} className="w-9 h-9 rounded-lg border border-border-subtle grid place-items-center disabled:opacity-40" aria-label="新增启动配置"><Plus size={14} /></button>
        </div>
      </div>

      {loadError && (
        <div className="mt-4 rounded-lg border border-accent-red/25 bg-accent-red/[0.06] px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-accent-red break-words">{loadError}</p>
          <button type="button" onClick={() => void load(draft.id)} className="h-7 px-2.5 rounded-md border border-accent-red/25 text-[11px] text-accent-red flex-shrink-0">重试</button>
        </div>
      )}

      {runtimeActive && <p role="status" className="mt-4 rounded-lg border border-accent-blue/20 bg-accent-blue/[0.06] px-3 py-2 text-xs text-text-secondary">当前启动配置正在运行，请先停止再修改或删除。</p>}

      <div className="grid md:grid-cols-2 gap-3 mt-4">
        <label className="text-xs text-text-secondary space-y-1.5">名称<input disabled={formDisabled} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className={`${inputClassName} h-9 px-3 text-sm`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5">Executable<input disabled={formDisabled} value={draft.executable} onChange={event => setDraft({ ...draft, executable: event.target.value })} className={`${inputClassName} h-9 px-3 text-sm font-mono`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5">参数（每行一个，按数组传递）<textarea disabled={formDisabled} value={draft.argsText} onChange={event => setDraft({ ...draft, argsText: event.target.value })} className={`${inputClassName} h-24 p-3 text-xs font-mono resize-y`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5">环境变量（KEY=VALUE）<textarea disabled={formDisabled} value={draft.envText} onChange={event => setDraft({ ...draft, envText: event.target.value })} className={`${inputClassName} h-24 p-3 text-xs font-mono resize-y`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5 md:col-span-2">工作目录<input disabled={formDisabled} value={draft.cwd} onChange={event => setDraft({ ...draft, cwd: event.target.value })} className={`${inputClassName} h-9 px-3 text-xs font-mono`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5">Ready URL（可选）<input disabled={formDisabled} value={draft.readyUrl} onChange={event => setDraft({ ...draft, readyUrl: event.target.value })} placeholder="http://localhost:5173" className={`${inputClassName} h-9 px-3 text-sm`} /></label>
        <label className="text-xs text-text-secondary space-y-1.5">Ready Port（可选）<input disabled={formDisabled} type="number" min="1" max="65535" value={draft.readyPort} onChange={event => setDraft({ ...draft, readyPort: event.target.value })} className={`${inputClassName} h-9 px-3 text-sm`} /></label>
        <label className="md:col-span-2 flex items-center gap-2 text-xs text-text-secondary"><input disabled={formDisabled} type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />启用这个启动配置</label>
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-3">
        <div className="text-xs text-text-tertiary self-center" aria-live="polite">状态：<span className={runtime?.state === 'failed' ? 'text-accent-red' : runtime?.state === 'ready' ? 'text-status-completed' : 'text-text-secondary'}>{runtime?.state === 'starting' ? '启动中' : runtime?.state === 'running' ? '运行中' : runtime?.state === 'ready' ? '已就绪' : failedWithLiveProcess ? '停止失败，进程仍在运行' : runtime?.state === 'failed' ? '失败' : '已停止'}</span></div>
        <div className="flex gap-2">
          {draft.id && <button type="button" onClick={() => void deleteProfile()} disabled={busy || runtimeActive} className="w-9 h-9 rounded-lg border border-border-subtle grid place-items-center text-text-tertiary hover:text-accent-red disabled:cursor-not-allowed disabled:opacity-40" aria-label="删除启动配置"><Trash2 size={14} /></button>}
          <button type="button" onClick={save} disabled={busy || runtimeActive} className="h-9 px-3 rounded-lg border border-border-subtle text-xs flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"><Save size={13} />保存</button>
          {runtime && (['starting', 'running'].includes(runtime.state) || failedWithLiveProcess) ? (
            <button type="button" onClick={() => void stop()} disabled={busy} className="h-9 px-3 rounded-lg border border-accent-red/40 text-accent-red text-xs flex items-center gap-1.5 disabled:opacity-40"><Square size={12} />{failedWithLiveProcess ? '重试停止' : '停止'}</button>
          ) : runtime?.state === 'ready' ? (
            <>
              {draft.readyUrl && <button type="button" onClick={() => void open()} disabled={busy} className="h-9 px-3 rounded-lg border border-border-subtle text-xs flex items-center gap-1.5 disabled:opacity-40"><ExternalLink size={13} />打开</button>}
              <button type="button" onClick={() => void stop()} disabled={busy} className="h-9 px-3 rounded-lg border border-accent-red/40 text-accent-red text-xs flex items-center gap-1.5 disabled:opacity-40"><Square size={12} />停止</button>
            </>
          ) : (
            <button type="button" onClick={requestStart} disabled={busy || !draft.id || !draft.enabled} className="h-9 px-4 rounded-lg bg-text-primary text-primary text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}启动</button>
          )}
        </div>
      </div>

      {runtime?.error && <p className="mt-3 rounded-lg bg-accent-red/10 px-3 py-2 text-xs text-accent-red">{runtime.error}</p>}
      {runtime && runtime.logs.length > 0 && <div className="mt-4 rounded-lg bg-bg-primary border border-border-subtle p-3 max-h-44 overflow-auto font-mono text-[11px] leading-5">{runtime.logs.slice(-80).map((log, index) => <div key={`${log.timestamp}-${index}`} className={log.stream === 'stderr' ? 'text-accent-red' : log.stream === 'system' ? 'text-text-tertiary' : 'text-text-secondary'}>{log.text}</div>)}</div>}

      {confirmProfile && createPortal(
        <div className="fixed inset-0 z-[120] bg-black/70 p-5 grid place-items-center">
          <div ref={confirmDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="confirm-launch-title" className="w-full max-w-xl rounded-2xl border border-border-primary bg-bg-secondary p-5 outline-none">
            <div className="flex justify-between gap-3">
              <div><h3 id="confirm-launch-title" className="font-semibold">确认首次启动</h3><p className="text-xs text-text-tertiary mt-1">请核对主进程将直接执行的参数数组。不会经过 Shell 字符串拼接。</p></div>
              <button type="button" aria-label="关闭" onClick={() => setConfirmProfile(null)} disabled={busy} className="w-8 h-8 grid place-items-center disabled:opacity-40"><X size={16} /></button>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div><dt className="text-xs text-text-tertiary">Executable</dt><dd className="mt-1 p-2 rounded bg-bg-primary font-mono break-all">{confirmProfile.executable}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Args[]</dt><dd className="mt-1 p-2 rounded bg-bg-primary font-mono break-all">[{confirmProfile.args.map(arg => JSON.stringify(arg)).join(', ')}]</dd></div>
              <div><dt className="text-xs text-text-tertiary">CWD</dt><dd className="mt-1 p-2 rounded bg-bg-primary font-mono break-all">{confirmProfile.cwd}</dd></div>
            </dl>
            <div className="flex justify-end gap-2 mt-5"><button type="button" onClick={() => setConfirmProfile(null)} disabled={busy} className="h-9 px-4 rounded-lg text-sm text-text-secondary disabled:opacity-40">取消</button><button type="button" autoFocus onClick={confirmAndStart} disabled={busy} className="h-9 px-4 rounded-lg bg-text-primary text-primary text-sm font-semibold disabled:opacity-40">确认并启动</button></div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
