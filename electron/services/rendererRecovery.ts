export interface RendererRecoveryState {
  attempts: number
  windowStartedAt: number
}

export interface RendererRecoveryOptions {
  maxReloads: number
  windowMs: number
}

export interface RendererRecoveryDecision {
  action: 'reload' | 'diagnostic'
  state: RendererRecoveryState
}

const DEFAULT_OPTIONS: RendererRecoveryOptions = {
  maxReloads: 2,
  windowMs: 30_000,
}

export function createRendererRecoveryState(): RendererRecoveryState {
  return { attempts: 0, windowStartedAt: 0 }
}

export function decideRendererRecovery(
  current: RendererRecoveryState,
  now: number,
  options: Partial<RendererRecoveryOptions> = {},
): RendererRecoveryDecision {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const outsideWindow = current.windowStartedAt === 0 || now - current.windowStartedAt > resolved.windowMs
  const attempts = outsideWindow ? 1 : current.attempts + 1
  const state = {
    attempts,
    windowStartedAt: outsideWindow ? now : current.windowStartedAt,
  }
  return {
    action: attempts <= resolved.maxReloads ? 'reload' : 'diagnostic',
    state,
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function buildRendererDiagnosticDocument(input: {
  title: string
  summary: string
  details: string
  retryUrl?: string
}) {
  const retry = input.retryUrl
    ? `<a href="${escapeHtml(input.retryUrl)}">重新加载应用</a>`
    : '<p class="restart">请关闭并重新启动 VibeTracker。</p>'
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${escapeHtml(input.title)}</title>
    <style>
      html,body{min-height:100%;margin:0;background:#080a0d;color:#eef1f5;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif}
      body{display:grid;place-items:center;padding:32px;box-sizing:border-box;background:radial-gradient(circle at 20% 0%,rgba(116,169,255,.14),transparent 32%),linear-gradient(180deg,#101318,#080a0d 58%)}
      main{width:min(680px,100%);padding:28px;border:1px solid #353d49;border-radius:16px;background:#11151a;box-sizing:border-box}
      h1{margin:0;font-size:24px}p{color:#a8b0bd;line-height:1.7}pre{white-space:pre-wrap;overflow:auto;padding:14px;border-radius:9px;background:#080a0d;color:#f3bb6c;font-size:12px}
      a{display:inline-flex;align-items:center;min-height:40px;margin-top:8px;padding:0 16px;border-radius:9px;background:#eef1f5;color:#080a0d;text-decoration:none;font-weight:650}.restart{margin-top:18px}
    </style>
  </head>
  <body>
    <main role="alert">
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.summary)}</p>
      <pre>${escapeHtml(input.details)}</pre>
      ${retry}
    </main>
  </body>
</html>`
}
