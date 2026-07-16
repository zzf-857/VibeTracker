import { History, Loader2, RefreshCcw, RotateCcw } from 'lucide-react'
import type { AiGenerationRunSummary } from '../../types'
import { formatDateTime } from '../../lib/projectView'

const statusLabel: Record<AiGenerationRunSummary['status'], string> = {
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function AiRunHistoryPanel({
  runs,
  loading,
  busyRunId,
  onReload,
  onOpen,
  onRetry,
}: {
  runs: AiGenerationRunSummary[]
  loading: boolean
  busyRunId: string
  onReload: () => void
  onOpen: (runId: string) => void
  onRetry: (runId: string) => void
}) {
  return (
    <section aria-labelledby="ai-run-history-title" className="rounded-xl border border-border-subtle bg-bg-primary/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="ai-run-history-title" className="text-sm font-semibold flex items-center gap-2"><History size={15} />AI 运行历史</h3>
          <p className="text-xs text-text-tertiary mt-1">成功、失败和取消的批次都会保留输入范围与规则快照。</p>
        </div>
        <button type="button" onClick={onReload} disabled={loading} className="h-8 px-3 rounded-lg border border-border-subtle text-xs flex items-center gap-1.5 disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}刷新
        </button>
      </div>

      {loading && !runs.length ? (
        <div className="py-14 grid place-items-center"><Loader2 className="animate-spin text-text-tertiary" /></div>
      ) : runs.length ? (
        <div className="mt-4 divide-y divide-border-subtle rounded-lg border border-border-subtle overflow-hidden">
          {runs.map(run => {
            const retryable = run.status === 'failed' || run.status === 'cancelled'
            const busy = busyRunId === run.id
            return (
              <article key={run.id} className="p-3 bg-bg-secondary/45 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{statusLabel[run.status]}</strong>
                    <span className="text-[10px] text-text-tertiary">{run.provider} / {run.model || '未配置模型'}</span>
                    {run.rulesVersion > 0 && <span className="text-[10px] text-text-tertiary">规则 v{run.rulesVersion}</span>}
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-1">
                    {formatDateTime(run.createdAt)} · {run.inputShas.length} 个 SHA · 待审核 {run.draftCount} / 已接受 {run.acceptedCount} / 已拒绝 {run.rejectedCount}
                  </p>
                  {run.error && <p className="text-[11px] text-accent-red mt-1 line-clamp-2" title={run.error}>{run.error}</p>}
                </div>
                <div className="flex gap-2">
                  {run.status === 'succeeded' && (
                    <button type="button" onClick={() => onOpen(run.id)} disabled={busy} className="h-8 px-3 rounded-lg border border-border-primary text-xs disabled:opacity-50">重新打开</button>
                  )}
                  {retryable && (
                    <button type="button" onClick={() => onRetry(run.id)} disabled={busy} className="h-8 px-3 rounded-lg border border-accent-blue/35 text-accent-blue text-xs flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}按原范围重试
                    </button>
                  )}
                  {run.status === 'running' && <span className="h-8 px-3 inline-flex items-center gap-1.5 text-xs text-accent-blue"><Loader2 size={12} className="animate-spin" />进行中</span>}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-text-tertiary">还没有 AI 运行历史。</p>
      )}
    </section>
  )
}
