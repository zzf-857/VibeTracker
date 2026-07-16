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
const onlineUpdate = process.env.VIBETRACKER_SMOKE_ONLINE_UPDATE === '1'
const suppliedPreviousInstaller = process.env.VIBETRACKER_SMOKE_PREVIOUS_INSTALLER
assert.notEqual(previousVersion, currentVersion, 'Previous smoke version must differ from the current package version')

const currentInstaller = path.join(appRoot, 'release', `VibeTracker-Setup-${currentVersion}.exe`)
const previousOutput = path.join(appRoot, 'release-smoke-previous')
const generatedPreviousInstaller = path.join(previousOutput, `VibeTracker-Setup-${previousVersion}.exe`)
const previousInstaller = suppliedPreviousInstaller ? path.resolve(suppliedPreviousInstaller) : generatedPreviousInstaller
const electronBuilderCli = path.join(appRoot, 'node_modules', 'electron-builder', 'cli.js')
if (!onlineUpdate) assert.ok(fs.existsSync(currentInstaller), `Current installer not found: ${currentInstaller}`)
if (!suppliedPreviousInstaller) assert.ok(fs.existsSync(electronBuilderCli), `electron-builder CLI not found: ${electronBuilderCli}`)
if (onlineUpdate) {
  assert.ok(suppliedPreviousInstaller, 'Online update smoke requires VIBETRACKER_SMOKE_PREVIOUS_INSTALLER')
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-installed-smoke-'))
const installDir = path.join(tempRoot, 'installed-app')
const userDataDir = path.join(tempRoot, 'user-data')
const localAppDataDir = path.join(tempRoot, 'local-app-data')
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
let smokeError = null

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

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function withTimeout(promise, timeout, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function runIsolatedPowerShell(command, timeout = 30_000) {
  return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
    env: {
      ...process.env,
      VIBETRACKER_SMOKE_EXECUTABLE: installedExecutable,
      VIBETRACKER_SMOKE_LOCAL_APP_DATA: localAppDataDir,
    },
  })
}

async function stopInstalledProcesses() {
  await runIsolatedPowerShell(`
    Get-CimInstance Win32_Process -Filter "Name = 'VibeTracker.exe'" |
      Where-Object { [string]::Equals($_.ExecutablePath, $env:VIBETRACKER_SMOKE_EXECUTABLE, [System.StringComparison]::OrdinalIgnoreCase) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `)
}

async function isolatedUpdaterInstallerPids() {
  const result = await runIsolatedPowerShell(`
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -like 'VibeTracker-Setup-*.exe' -and
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($env:VIBETRACKER_SMOKE_LOCAL_APP_DATA, [System.StringComparison]::OrdinalIgnoreCase)
      } |
      ForEach-Object { $_.ProcessId }
  `)
  return result.stdout
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0)
}

async function stopIsolatedUpdaterInstallers() {
  await runIsolatedPowerShell(`
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -like 'VibeTracker-Setup-*.exe' -and
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($env:VIBETRACKER_SMOKE_LOCAL_APP_DATA, [System.StringComparison]::OrdinalIgnoreCase)
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `)
}

async function waitForIsolatedUpdaterInstallersToExit() {
  const deadline = Date.now() + 180_000
  let pids = []
  while (Date.now() < deadline) {
    pids = await isolatedUpdaterInstallerPids()
    if (!pids.length) return
    await delay(250)
  }
  throw new Error(`Online update installer did not exit: ${pids.join(', ')}`)
}

async function readInstalledProductVersion() {
  if (!fs.existsSync(installedExecutable)) return ''
  const result = await runIsolatedPowerShell(`
    (Get-Item -LiteralPath $env:VIBETRACKER_SMOKE_EXECUTABLE).VersionInfo.ProductVersion
  `)
  return result.stdout.trim()
}

async function waitForInstalledProductVersion(expectedVersion) {
  const deadline = Date.now() + 300_000
  let observed = ''
  while (Date.now() < deadline) {
    observed = await readInstalledProductVersion().catch(() => '')
    if (observed === expectedVersion || observed.startsWith(`${expectedVersion}.`)) return observed
    await delay(500)
  }
  throw new Error(`Online update did not install ${expectedVersion}; last product version was ${observed || 'unavailable'}`)
}

async function preparePreviousInstaller() {
  if (suppliedPreviousInstaller) {
    assert.ok(fs.existsSync(previousInstaller), `Supplied previous installer not found: ${previousInstaller}`)
    return
  }
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
  assert.ok(fs.existsSync(generatedPreviousInstaller), `Previous installer was not generated: ${generatedPreviousInstaller}`)
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
      LOCALAPPDATA: localAppDataDir,
      VIBETRACKER_USER_DATA_DIR: userDataDir,
      VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
      VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
    },
    timeout: 30_000,
  })
  const page = await launched.firstWindow()
  page.on('console', message => {
    const text = message.text()
    if (text.startsWith('[OnlineUpdateSmoke]')) console.log(text)
  })
  await page.waitForFunction(() => window.vibe?.apiVersion === 1, undefined, { timeout: 20_000 })
  return { launched, page }
}

async function performOnlineUpdate(session) {
  await session.page.evaluate(() => {
    window.__vibetrackerOnlineUpdateMessages = []
    let lastProgressBucket = -1
    window.vibe.app.onUpdateMessage(payload => {
      window.__vibetrackerOnlineUpdateMessages.push(payload)
      if (payload.status === 'downloading') {
        const bucket = Math.floor(Number(payload.percent || 0) / 10) * 10
        if (bucket === lastProgressBucket) return
        lastProgressBucket = bucket
        console.log(`[OnlineUpdateSmoke] downloading ${bucket}%`)
        return
      }
      console.log(`[OnlineUpdateSmoke] ${payload.status}${payload.version ? ` ${payload.version}` : ''}`)
    })
  })

  const check = await withTimeout(
    session.page.evaluate(() => window.vibe.app.checkForUpdates()),
    120_000,
    'Online update check',
  )
  assert.equal(check.success, true, `Online update check failed: ${check.error || 'unknown error'}`)
  const announcedVersion = check.updateInfo && typeof check.updateInfo === 'object' && 'version' in check.updateInfo
    ? String(check.updateInfo.version)
    : ''
  assert.equal(announcedVersion, currentVersion, `Expected online version ${currentVersion}, got ${announcedVersion || 'none'}`)

  const download = await withTimeout(
    session.page.evaluate(() => window.vibe.app.downloadUpdate()),
    900_000,
    'Online update download',
  )
  assert.equal(download.success, true, `Online update download failed: ${download.error || 'unknown error'}`)
  await session.page.waitForFunction(expectedVersion => (
    window.__vibetrackerOnlineUpdateMessages.some(message => (
      message.status === 'downloaded' && message.version === expectedVersion
    ))
  ), currentVersion, { timeout: 30_000 })

  const messages = await session.page.evaluate(() => window.__vibetrackerOnlineUpdateMessages)
  assert.ok(messages.some(message => message.status === 'available' && message.version === currentVersion))
  assert.ok(messages.some(message => message.status === 'downloading'))
  assert.ok(messages.some(message => message.status === 'downloaded' && message.version === currentVersion))

  const closed = withTimeout(
    new Promise(resolve => session.launched.once('close', resolve)),
    180_000,
    'Application shutdown for online update',
  )
  const invocation = session.page.evaluate(() => window.vibe.app.quitAndInstallUpdate())
    .then(value => ({ type: 'result', value }))
    .catch(error => ({ type: 'error', error }))
  const first = await Promise.race([
    invocation,
    closed.then(() => ({ type: 'closed' })),
  ])
  if (first.type === 'result') {
    assert.equal(first.value.success, true, `Online update install request failed: ${first.value.error || 'unknown error'}`)
  } else if (first.type === 'error') {
    const message = first.error instanceof Error ? first.error.message : String(first.error)
    assert.match(message, /closed|destroyed|context/i)
  }
  await closed
  app = null

  const productVersion = await waitForInstalledProductVersion(currentVersion)
  await waitForIsolatedUpdaterInstallersToExit()
  await stopInstalledProcesses()
  return { announcedVersion, productVersion, messages }
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
  await stopIsolatedUpdaterInstallers().catch(() => undefined)
  await stopInstalledProcesses().catch(() => undefined)
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
  fs.mkdirSync(localAppDataDir, { recursive: true })

  await preparePreviousInstaller()
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
  let onlineUpdateResult = null
  if (onlineUpdate) {
    onlineUpdateResult = await performOnlineUpdate(session)
  } else {
    await closeApp()
    await install(currentInstaller, { updated: true })
  }
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
  if (onlineUpdate) {
    assert.equal(onlineUpdateResult.announcedVersion, currentVersion)
    assert.ok(onlineUpdateResult.productVersion === currentVersion || onlineUpdateResult.productVersion.startsWith(`${currentVersion}.`))
  }
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
  console.log(`Installed NSIS ${onlineUpdate ? 'online update' : 'overlay update'} smoke passed: ${previousVersion} -> ${currentVersion}, data persistence, updater install mode, shortcuts, registry, and uninstall.`)
} catch (error) {
  smokeError = error
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

  if (!suppliedPreviousInstaller) {
    try {
      assertSafeGeneratedDirectory(previousOutput, 'release-smoke-previous', appRoot)
      removeTreeWithRetries(previousOutput)
    } catch (error) {
      cleanupFailures.push(`previous-version build: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (cleanupFailures.length) {
    const cleanupError = new Error(`Installed smoke cleanup failed:\n${cleanupFailures.join('\n')}`)
    if (smokeError) throw new AggregateError([smokeError, cleanupError], 'Installed smoke and cleanup both failed')
    throw cleanupError
  }
  if (smokeError) throw smokeError
  if (!smokeSucceeded) process.exitCode = 1
}
