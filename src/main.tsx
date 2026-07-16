import React, { useLayoutEffect, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { getMissingRendererBridges, RENDERER_BOOT_ELEMENT_ID } from './lib/rendererBootstrap'

function RendererMounted({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.rendererMounted = 'true'
    document.getElementById(RENDERER_BOOT_ELEMENT_ID)?.remove()
  }, [])
  return children
}

function PreloadDiagnostic({ missing }: { missing: string[] }) {
  return (
    <main
      role="alert"
      style={{
        minHeight: '100vh',
        padding: 32,
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(180deg, #101318, #080a0d 58%)',
        color: '#eef1f5',
      }}
    >
      <section style={{ width: 'min(620px, 100%)', padding: 28, border: '1px solid #353d49', borderRadius: 16, background: '#11151a' }}>
        <p style={{ margin: 0, color: '#f3bb6c', fontSize: 13 }}>启动诊断</p>
        <h1 style={{ margin: '12px 0 0', fontSize: 24 }}>Electron 预加载桥接未就绪</h1>
        <p style={{ margin: '12px 0 0', color: '#a8b0bd', lineHeight: 1.7 }}>
          VibeTracker 已加载前端文件，但无法连接主进程。为避免访问不存在的 API，本次不会继续渲染项目数据。
        </p>
        <pre style={{ margin: '18px 0 0', padding: 14, overflow: 'auto', borderRadius: 9, background: '#080a0d', color: '#f3bb6c', whiteSpace: 'pre-wrap' }}>
          缺少：{missing.join('、')}
        </pre>
        <p style={{ margin: '14px 0 0', color: '#a8b0bd', fontSize: 13, lineHeight: 1.7 }}>
          请关闭并重新启动应用。如果问题持续存在，请重新构建 Electron 主进程与 preload 文件。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 18, minHeight: 40, padding: '0 16px', border: '1px solid #4a5564', borderRadius: 9, background: '#eef1f5', color: '#080a0d', fontWeight: 650, cursor: 'pointer' }}
        >
          重新加载
        </button>
      </section>
    </main>
  )
}

const missingBridges = getMissingRendererBridges({
  vibe: window.vibe,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RendererMounted>
      {missingBridges.length ? <PreloadDiagnostic missing={missingBridges} /> : <App />}
    </RendererMounted>
  </React.StrictMode>,
)
