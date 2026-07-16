import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  buildRendererDiagnosticDocument,
  createRendererRecoveryState,
  decideRendererRecovery,
} from '../electron/services/rendererRecovery.ts'
import { getMissingRendererBridges } from '../src/lib/rendererBootstrap.ts'

test('renderer recovery reloads only a bounded number of times inside the crash window', () => {
  let state = createRendererRecoveryState()
  const first = decideRendererRecovery(state, 1_000, { maxReloads: 2, windowMs: 30_000 })
  assert.equal(first.action, 'reload')
  state = first.state

  const second = decideRendererRecovery(state, 2_000, { maxReloads: 2, windowMs: 30_000 })
  assert.equal(second.action, 'reload')
  state = second.state

  const third = decideRendererRecovery(state, 3_000, { maxReloads: 2, windowMs: 30_000 })
  assert.equal(third.action, 'diagnostic')
  assert.equal(third.state.attempts, 3)
})

test('renderer recovery starts a fresh budget after a stable window', () => {
  const exhausted = { attempts: 3, windowStartedAt: 1_000 }
  const decision = decideRendererRecovery(exhausted, 32_000, { maxReloads: 2, windowMs: 30_000 })
  assert.equal(decision.action, 'reload')
  assert.deepEqual(decision.state, { attempts: 1, windowStartedAt: 32_000 })
})

test('renderer diagnostic document is dark, localized, script-free and escapes details', () => {
  const document = buildRendererDiagnosticDocument({
    title: '<启动失败>',
    summary: '无法加载 & 恢复',
    details: '<script>alert("unsafe")</script>',
    retryUrl: 'file:///C:/VibeTracker/index.html?value="unsafe"',
  })

  assert.match(document, /<html lang="zh-CN">/)
  assert.match(document, /background:#080a0d/)
  assert.match(document, /default-src 'none'/)
  assert.doesNotMatch(document, /<script>alert/)
  assert.match(document, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/)
  assert.match(document, /value=&quot;unsafe&quot;/)
})

test('renderer bootstrap reports missing preload bridges explicitly', () => {
  assert.deepEqual(getMissingRendererBridges({}), ['window.vibe'])
  assert.deepEqual(getMissingRendererBridges({ vibe: {} }), ['window.vibe.apiVersion=1'])
  assert.deepEqual(getMissingRendererBridges({ vibe: { apiVersion: 2 } }), ['window.vibe.apiVersion=1'])
  assert.deepEqual(getMissingRendererBridges({ vibe: { apiVersion: 1 } }), [])
})

test('index.html contains a readable dark boot state outside the React root', async () => {
  const html = await fs.readFile(path.resolve('index.html'), 'utf8')
  const bootIndex = html.indexOf('id="vibetracker-boot"')
  const rootIndex = html.indexOf('id="root"')

  assert.ok(bootIndex >= 0)
  assert.ok(rootIndex > bootIndex)
  assert.match(html, /VibeTracker 正在启动/)
  assert.match(html, /background:\s*#080a0d/)
  assert.match(html, /如果此页面长时间没有消失/)
})

test('the active route is visible by default when route animation cannot run', async () => {
  const css = await fs.readFile(path.resolve('src/index.css'), 'utf8')
  const activeRoute = css.match(/\.page-route-enter\s*\{([^}]*)\}/)?.[1] || ''

  assert.match(activeRoute, /opacity:\s*1\s*;/)
  assert.doesNotMatch(activeRoute, /opacity:\s*0\s*;/)
})
