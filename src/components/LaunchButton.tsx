import { useEffect, useState, type MouseEvent } from 'react'
import { ExternalLink, Loader2, Play, Settings2, Square } from 'lucide-react'
import type { LaunchCapability, LaunchRuntimeState } from '../types'
import { useNotifications } from '../lib/notifications'

export function LaunchButton({
  capability,
  onConfigure,
  compact = false,
}: {
  capability?: LaunchCapability | null
  onConfigure: () => void
  compact?: boolean
}) {
  const [runtime, setRuntime] = useState<LaunchRuntimeState | null>(null)
  const [busy, setBusy] = useState(false)
  const { notify } = useNotifications()

  useEffect(() => {
    const profileId = capability?.profileId
    setRuntime(null)
    if (!profileId) return

    let disposed = false
    let receivedUpdate = false
    const unsubscribe = window.vibe.launch.onState(state => {
      if (state.profileId === profileId) {
        receivedUpdate = true
        setRuntime(state)
      }
    })
    void window.vibe.launch.status(profileId).then(state => {
      if (!disposed && !receivedUpdate) setRuntime(state)
    }).catch(error => {
      if (!disposed) notify({ tone: 'error', title: '启动状态读取失败', detail: error instanceof Error ? error.message : String(error) })
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [capability?.profileId, notify])

  const execute = async (event: MouseEvent, operation: 'start' | 'stop' | 'open') => {
    event.stopPropagation()
    if (!capability) return
    setBusy(true)
    try {
      if (operation === 'open') {
        await window.vibe.launch.open(capability.profileId)
      } else if (operation === 'stop') {
        setRuntime(await window.vibe.launch.stop(capability.profileId))
      } else {
        setRuntime(await window.vibe.launch.start(capability.profileId))
      }
    } catch (error) {
      notify({ tone: 'error', title: '启动操作失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const primaryAction = (event: MouseEvent) => {
    event.stopPropagation()
    if (!capability || !capability.validated) {
      onConfigure()
      return
    }
    const shouldStop = runtime?.state === 'starting'
      || runtime?.state === 'running'
      || runtime?.state === 'ready'
      || (runtime?.state === 'failed' && runtime.pid !== null)
    void execute(event, shouldStop ? 'stop' : 'start')
  }

  const state = runtime?.state
  const failedWithLiveProcess = state === 'failed' && runtime?.pid !== null
  const sizeClassName = compact ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'
  const baseClassName = `inline-flex items-center justify-center gap-2 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue disabled:cursor-wait disabled:opacity-60 ${sizeClassName}`

  if (capability?.validated && state === 'ready' && capability.canOpen) {
    return (
      <span role="group" aria-label="项目启动操作" className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={event => void execute(event, 'open')}
          disabled={busy}
          aria-label="打开项目"
          title="打开项目"
          className={`${baseClassName} border-border-subtle bg-bg-tertiary text-text-secondary hover:text-text-primary hover:border-border-primary`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}打开
        </button>
        <button
          type="button"
          onClick={event => void execute(event, 'stop')}
          disabled={busy}
          aria-label="停止项目"
          title={runtime?.error || '停止项目'}
          className={`${baseClassName} border-accent-red/40 bg-accent-red/10 text-accent-red`}
        >
          <Square size={13} />停止
        </button>
      </span>
    )
  }

  const label = !capability
    ? '配置启动'
    : !capability.validated
      ? '确认启动'
      : busy
        ? (state === 'starting' || state === 'running' || state === 'ready' || failedWithLiveProcess ? '停止中' : '启动中')
        : state === 'starting'
          ? '启动中'
          : state === 'running' || state === 'ready'
            ? '停止'
            : failedWithLiveProcess
              ? '重试停止'
              : state === 'failed'
                ? '重试'
                : '启动'
  const icon = !capability || !capability.validated
    ? <Settings2 size={14} />
    : busy || state === 'starting'
      ? <Loader2 size={14} className="animate-spin" />
      : state === 'running' || state === 'ready' || failedWithLiveProcess
        ? <Square size={13} />
        : <Play size={14} />

  return (
    <button
      type="button"
      onClick={primaryAction}
      disabled={busy}
      aria-label={`${label}项目`}
      title={runtime?.error || label}
      className={`${baseClassName} ${state === 'failed' ? 'border-accent-red/40 text-accent-red bg-accent-red/10' : 'border-border-subtle bg-bg-tertiary text-text-secondary hover:text-text-primary hover:border-border-primary'}`}
    >
      {icon}{label}
    </button>
  )
}
