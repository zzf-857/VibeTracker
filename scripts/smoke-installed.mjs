import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const execFileAsync = promisify(execFile)

if (process.platform !== 'win32') {
  console.log('Installed NSIS smoke is Windows-only; skipped.')
  process.exit(0)
}

const appRoot = path.resolve(process.cwd())
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
const currentVersion = String(packageJson.version)
const previousVersion = process.env.VIBETRACKER_SMOKE_PREVIOUS_VERSION || '0.0.9'
assert.notEqual(previousVersion, currentVersion, 'Previous smoke version must differ from the current package version')

const currentInstaller = path.join(appRoot, 'release', `VibeTracker-Setup-${currentVersion}.exe`)
const previousOutput = path.join(appRoot, 'release-smoke-previous')
const previousInstaller = path.join(previousOutput, `VibeTracker-Setup-${previousVersion}.exe`)
const electronBuilderCli = path.join(appRoot, 'node_modules', 'electron-builder', 'cli.js')
assert.ok(fs.existsSync(currentInstaller), `Current installer not found: ${currentInstaller}`)
assert.ok(fs.existsSync(electronBuilderCli), `electron-builder CLI not found: ${electronBuilderCli}`)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-installed-smoke-'))
const installDir = path.join(tempRoot, 'installed-app')
const userDataDir = path.join(tempRoot, 'user-data')
const installedExecutable = path.join(installDir, 'VibeTracker.exe')
const uninstaller = path.join(installDir, 'Uninstall VibeTracker.exe')
const desktopShortcut = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'VibeTracker.lnk')
const startMenuShortcut = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'VibeTracker.lnk',
)
const uninstallRegistryRoot = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`

let app = null
let installed = false
let smokeSucceeded = false

function assertSafeGeneratedDirectory(target, expectedName, parent) {
  const resolvedTarget = path.resolve(target)
  const resolvedParent = path.resolve(parent)
  assert.equal(path.basename(resolvedTarget), expectedName)
  assert.equal(path.dirname(resolvedTarget).toLowerCase(), resolvedParent.toLowerCase())
}

function assertSafeTempRoot(target) {
  const resolvedTarget = path.resolve(target)
  const resolvedTemp = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase()
  assert.ok(resolvedTarget.toLowerCase().startsWith(resolvedTemp), `Unsafe temp cleanup target: ${resolvedTarget}`)
  assert.match(path.basename(resolvedTarget), /^vibetracker-installed-smoke-/)
}

function removeTreeWithRetries(target) {
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 120,
    retryDelay: 250,
  })
}

async function runExecutable(file, args, timeout = 180_000) {
  return execFileAsync(file, args, {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  })
}

async function buildPreviousInstaller() {
  assertSafeGeneratedDirectory(previousOutput, 'release-smoke-previous', appRoot)
  removeTreeWithRetries(previousOutput)
  await runExecutable(process.execPath, [
    electronBuilderCli,
    '--win',
    'nsis',
    '--publish',
    'never',
    `--config.directories.output=${previousOutput}`,
    `--config.extraMetadata.version=${previousVersion}`,
  ], 300_000)
  assert.ok(fs.existsSync(previousInstaller), `Previous installer was not generated: ${previousInstaller}`)
}

async function install(installerPath, { updated = false } = {}) {
  const args = []
  if (updated) args.push('--updated')
  args.push('/S', `/D=${installDir}`)
  await runExecutable(installerPath, args)
  assert.ok(fs.existsSync(installedExecutable), `Installed executable not found: ${installedExecutable}`)
  assert.ok(fs.existsSync(uninstaller), `Uninstaller not found: ${uninstaller}`)
  installed = true
}

async function registryContainsInstallDirectory() {
  try {
    const result = await runExecutable('reg.exe', [
      'query', uninstallRegistryRoot, '/s', '/f', installDir, '/d',
    ], 30_000)
    return result.stdout.toLowerCase().includes(installDir.toLowerCase())
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) return false
    throw error
  }
}

async function launchInstalled() {
  const launched = await electron.launch({
    executablePath: installedExecutable,
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

async function closeApp() {
  if (!app) return
  await app.close()
  app = null
}

async function waitForUninstall() {
  const deadline = Date.now() + 30_000
  while (fs.existsSync(installedExecutable) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function uninstallIfPresent() {
  await closeApp().catch(() => undefined)
  if (!fs.existsSync(uninstaller)) {
    installed = false
    return
  }
  await runExecutable(uninstaller, ['/S'], 180_000)
  await waitForUninstall()
  await new Promise(resolve => setTimeout(resolve, 1_000))
  installed = fs.existsSync(installedExecutable)
}

try {
  assert.equal(fs.existsSync(desktopShortcut), false, `Refusing to overwrite an existing shortcut: ${desktopShortcut}`)
  assert.equal(fs.existsSync(startMenuShortcut), false, `Refusing to overwrite an existing shortcut: ${startMenuShortcut}`)
  assert.equal(await registryContainsInstallDirectory(), false)
  fs.mkdirSync(userDataDir, { recursive: true })

  await buildPreviousInstaller()
  await install(previousInstaller)
  assert.equal(fs.existsSync(desktopShortcut), true)
  assert.equal(fs.existsSync(startMenuShortcut), true)
  assert.equal(await registryContainsInstallDirectory(), true)

  let session = await launchInstalled()
  app = session.launched
  const initial = await session.page.evaluate(async expectedVersion => {
    const version = await window.vibe.app.getVersion()
    const projectId = await window.vibe.projects.createEmpty({
      name: 'Installed Upgrade Smoke Project',
      description: '隔离 NSIS 安装与升级验收数据',
    })
    await window.vibe.records.create({
      projectId,
      title: '安装前记录',
      description: '用于证明覆盖升级没有丢失已有数据。',
    })
    return { version, projectId, expectedVersion }
  }, previousVersion)
  assert.equal(initial.version.version, previousVersion)
  assert.equal(initial.version.isPackaged, true)
  assert.equal(initial.version.isPortable, false)
  await closeApp()

  await install(currentInstaller, { updated: true })
  assert.equal(fs.existsSync(desktopShortcut), true)
  assert.equal(fs.existsSync(startMenuShortcut), true)
  assert.equal(await registryContainsInstallDirectory(), true)

  session = await launchInstalled()
  app = session.launched
  const upgraded = await session.page.evaluate(async projectId => {
    const version = await window.vibe.app.getVersion()
    const project = await window.vibe.projects.get(projectId)
    const records = await window.vibe.records.list(projectId, { limit: 20 })
    return {
      version,
      projectName: project?.name || '',
      recordTitles: records.items.map(record => record.title),
    }
  }, initial.projectId)
  assert.equal(upgraded.version.version, currentVersion)
  assert.equal(upgraded.version.isPackaged, true)
  assert.equal(upgraded.projectName, 'Installed Upgrade Smoke Project')
  assert.deepEqual(upgraded.recordTitles, ['安装前记录'])
  await closeApp()

  const dbPath = path.join(userDataDir, 'vibetracker.db')
  const beforeUninstall = new DatabaseSync(dbPath, { readOnly: true })
  try {
    assert.equal(beforeUninstall.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 17)
    assert.equal(beforeUninstall.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally {
    beforeUninstall.close()
  }

  await uninstallIfPresent()
  assert.equal(installed, false, 'Installed executable still exists after silent uninstall')
  assert.equal(fs.existsSync(desktopShortcut), false)
  assert.equal(fs.existsSync(startMenuShortcut), false)
  assert.equal(await registryContainsInstallDirectory(), false)
  assert.equal(fs.existsSync(dbPath), true, 'Uninstall unexpectedly deleted isolated application data')

  const afterUninstall = new DatabaseSync(dbPath, { readOnly: true })
  try {
    assert.equal(afterUninstall.prepare("SELECT COUNT(*) AS count FROM projects WHERE name = 'Installed Upgrade Smoke Project'").get().count, 1)
    assert.equal(afterUninstall.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally {
    afterUninstall.close()
  }

  smokeSucceeded = true
  console.log(`Installed NSIS smoke passed: ${previousVersion} -> ${currentVersion}, data persistence, updater install mode, shortcuts, registry, and uninstall.`)
} finally {
  const cleanupFailures = []
  await uninstallIfPresent().catch(error => {
    cleanupFailures.push(`uninstall: ${error instanceof Error ? error.message : String(error)}`)
  })

  if (!installed) {
    try {
      assertSafeTempRoot(tempRoot)
      removeTreeWithRetries(tempRoot)
    } catch (error) {
      cleanupFailures.push(`temporary data: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    cleanupFailures.push(`isolated installation remains at ${installDir}`)
  }

  try {
    assertSafeGeneratedDirectory(previousOutput, 'release-smoke-previous', appRoot)
    removeTreeWithRetries(previousOutput)
  } catch (error) {
    cleanupFailures.push(`previous-version build: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (cleanupFailures.length) {
    throw new Error(`Installed smoke cleanup failed:\n${cleanupFailures.join('\n')}`)
  }
  if (!smokeSucceeded) process.exitCode = 1
}
