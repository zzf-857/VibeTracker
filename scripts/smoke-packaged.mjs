import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'

if (process.platform !== 'win32') {
  console.log('Packaged smoke is Windows-only; skipped.')
  process.exit(0)
}

const appRoot = process.cwd()
const executablePath = path.join(appRoot, 'release', 'win-unpacked', 'VibeTracker.exe')
assert.ok(fs.existsSync(executablePath), `Packaged executable not found: ${executablePath}`)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-packaged-smoke-'))
const userDataDir = path.join(tempRoot, 'user-data')
fs.mkdirSync(userDataDir, { recursive: true })
const secret = `packaged-smoke-${crypto.randomUUID()}`
let app = null

async function launch() {
  const launched = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      VIBETRACKER_USER_DATA_DIR: userDataDir,
      VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
      VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
    },
    timeout: 30_000,
  })
  const page = await launched.firstWindow()
  await page.waitForFunction(() => window.vibe?.apiVersion === 1, undefined, { timeout: 20_000 })
  return { launched, page }
}

try {
  let session = await launch()
  app = session.launched
  const result = await session.page.evaluate(async ({ nodeExecutable, cwd, apiKey }) => {
    const projectId = await window.vibe.projects.createEmpty({
      name: 'Packaged Smoke Project', description: '隔离安装包冒烟数据',
    })
    const imagePath = await window.vibe.assets.saveImage(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=',
      'packaged-smoke.png',
    )
    await window.vibe.projects.update(projectId, { coverImagePath: imagePath })
    const assetUrl = `vibe-asset://local/${encodeURIComponent(imagePath)}?size=96`
    const imageLoaded = await new Promise(resolve => {
      const image = new Image()
      image.onload = () => resolve({ ok: true, width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve({ ok: false, width: 0, height: 0 })
      image.src = assetUrl
    })

    const current = await window.vibe.settings.get()
    const settings = await window.vibe.settings.update({
      llm: {
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'packaged-smoke-model',
        defaultLanguage: current.llm.defaultLanguage,
        logGranularity: current.llm.logGranularity,
        toneMode: current.llm.toneMode,
        excludedPaths: current.llm.excludedPaths,
        customRules: current.llm.customRules,
        apiKey,
      },
    })

    const saved = await window.vibe.launch.save({
      projectId,
      name: 'Packaged watchdog smoke',
      executable: nodeExecutable,
      args: ['-e', "console.log('packaged-watchdog-ready'); setInterval(() => {}, 1000)"],
      cwd,
      env: {},
      readyUrl: '',
      readyPort: null,
      enabled: true,
    })
    const confirmed = await window.vibe.launch.confirm(saved.id)
    await window.vibe.launch.start(confirmed.id)
    const deadline = Date.now() + 10_000
    let runtime = await window.vibe.launch.status(confirmed.id)
    while (!(runtime?.state === 'running' && runtime.logs.some(log => log.text.includes('packaged-watchdog-ready'))) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
      runtime = await window.vibe.launch.status(confirmed.id)
    }
    const running = runtime?.state === 'running'
      && runtime.logs.some(log => log.text.includes('packaged-watchdog-ready'))
    const stopped = await window.vibe.launch.stop(confirmed.id)
    return {
      projectId,
      imageLoaded,
      hasApiKey: settings.llm.hasApiKey,
      running,
      runtimeError: runtime?.error || '',
      runtimeLogs: runtime?.logs.map(log => log.text) || [],
      stopped: stopped?.state,
    }
  }, { nodeExecutable: process.execPath, cwd: tempRoot, apiKey: secret })
  assert.equal(result.imageLoaded.ok, true)
  assert.ok(result.imageLoaded.width > 0 && result.imageLoaded.height > 0)
  assert.equal(result.hasApiKey, true)
  assert.equal(result.running, true, `${result.runtimeError}\n${result.runtimeLogs.join('\n')}`)
  assert.equal(result.stopped, 'stopped')
  await app.close()
  app = null

  const configPath = path.join(userDataDir, 'config.json')
  const keyPath = path.join(userDataDir, 'llm-api-key.bin')
  assert.equal(fs.readFileSync(configPath, 'utf8').includes(secret), false)
  assert.equal(fs.readFileSync(keyPath).includes(Buffer.from(secret)), false)
  const db = new DatabaseSync(path.join(userDataDir, 'vibetracker.db'), { readOnly: true })
  try {
    assert.equal((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).version, 17)
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM projects WHERE name = 'Packaged Smoke Project'").get()).count, 1)
    assert.equal((db.prepare('PRAGMA integrity_check').get()).integrity_check, 'ok')
  } finally {
    db.close()
  }

  session = await launch()
  app = session.launched
  const restored = await session.page.evaluate(async projectId => {
    const settings = await window.vibe.settings.get()
    const project = await window.vibe.projects.get(projectId)
    await window.vibe.settings.update({ llm: { apiKey: '' } })
    return { hasApiKey: settings.llm.hasApiKey, projectName: project?.name }
  }, result.projectId)
  assert.equal(restored.hasApiKey, true)
  assert.equal(restored.projectName, 'Packaged Smoke Project')
  await app.close()
  app = null
  console.log('Packaged smoke passed: schema, safeStorage, asset protocol, watchdog launch/stop, and restart persistence.')
} finally {
  await app?.close().catch(() => undefined)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
