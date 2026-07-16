import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import type Database from 'better-sqlite3'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import './appIdentity'
import { registerAssetScheme, setupAssetProtocol } from './assetProtocol'
import { setupDomainIpc } from './domainIpc'
import {
  buildDatabaseRecoveryDocument,
  getDatabasePaths,
  initializeDatabase,
  listDatabaseBackups,
  restoreDatabaseBackup,
} from './database'
import {
  buildRendererDiagnosticDocument,
  createRendererRecoveryState,
  decideRendererRecovery,
} from './services/rendererRecovery'
import { isTrustedRendererUrl } from './services/rendererTrust'
import { validateIpcResponse } from './services/ipcResponseValidation'

registerAssetScheme()

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const RENDERER_FILE = path.join(RENDERER_DIST, 'index.html')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null
let databaseConnection: Database.Database | null = null
let databaseRecoveryWindow: BrowserWindow | null = null
let databaseStartupError: Error | null = null
let databaseRestoreError = ''
let databaseStartupInProgress = false
let applicationServicesStarted = false
let autoUpdaterInitialized = false
let processManager: ReturnType<typeof setupDomainIpc>['processManager'] | null = null
let gitSyncScheduler: ReturnType<typeof setupDomainIpc>['gitSyncScheduler'] | null = null
let shutdownStarted = false
let shutdownReady = false

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

type UpdateMessagePayload = {
  status: 'checking' | 'available' | 'not-available' | 'error' | 'downloading' | 'downloaded' | 'portable' | 'dev'
  version?: string
  percent?: number
  error?: string
  isPortable?: boolean
}

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
}

function assertTrustedRendererSender(event: IpcMainInvokeEvent) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (!owner || owner.isDestroyed() || !isTrustedRendererUrl(senderUrl, {
    devServerUrl: VITE_DEV_SERVER_URL,
    rendererFile: RENDERER_FILE,
  })) {
    throw new Error('拒绝来自非应用页面的 IPC 请求')
  }
}

function sendUpdateMessage(payload: UpdateMessagePayload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-message', {
      isPortable: isPortableBuild(),
      ...payload,
    })
  }
}

function setupAutoUpdater() {
  if (autoUpdaterInitialized) return
  autoUpdaterInitialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    sendUpdateMessage({ status: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    sendUpdateMessage({ status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', info => {
    sendUpdateMessage({ status: 'not-available', version: info.version })
  })

  autoUpdater.on('error', error => {
    sendUpdateMessage({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  })

  autoUpdater.on('download-progress', progress => {
    sendUpdateMessage({
      status: 'downloading',
      percent: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', info => {
    sendUpdateMessage({ status: 'downloaded', version: info.version })
  })

  const handleValidated = (channel: string, handler: () => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async event => {
      assertTrustedRendererSender(event)
      return validateIpcResponse(channel, await handler())
    })
  }

  handleValidated('get-app-version', () => ({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      isPortable: isPortableBuild(),
  }))

  handleValidated('update-check', async () => {
    if (isPortableBuild()) {
      sendUpdateMessage({ status: 'portable', isPortable: true })
      return { success: false, status: 'portable', isPortable: true, error: '便携版不支持应用内自动更新' }
    }

    if (!app.isPackaged) {
      sendUpdateMessage({ status: 'dev', error: '开发环境跳过更新检查' })
      return { success: false, status: 'dev', error: '开发环境跳过更新检查' }
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, updateInfo: result?.updateInfo ?? null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendUpdateMessage({ status: 'error', error: message })
      return { success: false, status: 'error', error: message }
    }
  })

  handleValidated('update-download', async () => {
    if (isPortableBuild()) {
      sendUpdateMessage({ status: 'portable', isPortable: true })
      return { success: false, status: 'portable', isPortable: true, error: '便携版不支持应用内自动更新' }
    }

    if (!app.isPackaged) {
      sendUpdateMessage({ status: 'dev', error: '开发环境跳过更新下载' })
      return { success: false, status: 'dev', error: '开发环境跳过更新下载' }
    }

    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendUpdateMessage({ status: 'error', error: message })
      return { success: false, status: 'error', error: message }
    }
  })

  handleValidated('update-quit-and-install', async () => {
    if (isPortableBuild() || !app.isPackaged) {
      return { success: false, error: '当前环境不支持重启安装更新' }
    }

    try {
      shutdownStarted = true
      if (gitSyncScheduler) await gitSyncScheduler.stop()
      if (processManager) await processManager.stopAll()
      shutdownReady = true
      autoUpdater.quitAndInstall(false, true)
      return { success: true }
    } catch (error) {
      shutdownStarted = false
      shutdownReady = false
      gitSyncScheduler?.start()
      const message = error instanceof Error ? error.message : String(error)
      sendUpdateMessage({ status: 'error', error: `仍有项目进程未能安全停止：${message}` })
      return { success: false, error: `仍有项目进程未能安全停止，已取消更新安装：${message}` }
    }
  })

  if (app.isPackaged && !isPortableBuild()) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(error => {
        console.error('[AutoUpdater] Startup update check failed:', error)
      })
    }, 5000)
  }
}

async function showDatabaseRecoveryWindow() {
  const { userDataPath } = getDatabasePaths()
  const latestBackup = listDatabaseBackups()[0] || null
  const document = buildDatabaseRecoveryDocument({
    error: databaseStartupError?.stack || databaseStartupError?.message || '未知数据库启动错误',
    userDataPath,
    backup: latestBackup,
    restoreError: databaseRestoreError,
  })

  if (databaseRecoveryWindow && !databaseRecoveryWindow.isDestroyed()) {
    await databaseRecoveryWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`)
    databaseRecoveryWindow.show()
    databaseRecoveryWindow.focus()
    win = databaseRecoveryWindow
    return
  }

  const recoveryWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#080A0D',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  databaseRecoveryWindow = recoveryWindow
  win = recoveryWindow
  recoveryWindow.setMenuBarVisibility(false)
  recoveryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  recoveryWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('data:text/html')) return
    event.preventDefault()
    if (!url.startsWith('vibe-recovery://')) return
    let action = ''
    try { action = new URL(url).hostname } catch { return }
    if (action === 'exit') {
      app.quit()
      return
    }
    if (action === 'open-data') {
      void shell.openPath(userDataPath).then(error => {
        if (error) dialog.showErrorBox('无法打开数据目录', error)
      })
      return
    }
    if (action === 'retry') {
      void attemptDatabaseStartup()
      return
    }
    if (action === 'restore') {
      const backup = listDatabaseBackups()[0]
      if (!backup) {
        databaseRestoreError = '没有找到可恢复的数据库备份。'
        void showDatabaseRecoveryWindow()
        return
      }
      void attemptDatabaseStartup(backup.path)
    }
  })
  recoveryWindow.on('closed', () => {
    if (databaseRecoveryWindow === recoveryWindow) databaseRecoveryWindow = null
    if (win === recoveryWindow) win = null
  })
  await recoveryWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`)
}

function startApplicationServices(db: Database.Database) {
  if (applicationServicesStarted) return
  applicationServicesStarted = true
  setupAssetProtocol(db)
  const domain = setupDomainIpc(db, VITE_DEV_SERVER_URL)
  processManager = domain.processManager
  gitSyncScheduler = domain.gitSyncScheduler
  createWindow()
  gitSyncScheduler.start()
  setupAutoUpdater()
}

async function attemptDatabaseStartup(backupPath?: string) {
  if (databaseStartupInProgress || applicationServicesStarted) return
  databaseStartupInProgress = true
  try {
    if (backupPath) {
      try {
        const result = restoreDatabaseBackup(backupPath)
        console.warn('[Database] Restored startup backup:', result)
        databaseRestoreError = ''
      } catch (error) {
        databaseRestoreError = error instanceof Error ? error.message : String(error)
        await showDatabaseRecoveryWindow()
        return
      }
    }

    try {
      const initialized = initializeDatabase()
      databaseConnection = initialized.db
      databaseStartupError = null
      databaseRestoreError = ''
    } catch (error) {
      databaseStartupError = error instanceof Error ? error : new Error(String(error))
      console.error('[Database] Startup failed:', databaseStartupError)
      await showDatabaseRecoveryWindow()
      return
    }

    const recoveryWindow = databaseRecoveryWindow
    databaseRecoveryWindow = null
    startApplicationServices(databaseConnection)
    // Keep at least one BrowserWindow alive throughout the handoff. Destroying
    // the recovery window first would emit window-all-closed and quit the app
    // before the normal project window can be created on Windows/Linux.
    if (recoveryWindow && !recoveryWindow.isDestroyed()) recoveryWindow.destroy()
  } finally {
    databaseStartupInProgress = false
  }
}

function createWindow() {
  const browserWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#080A0D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win = browserWindow
  const rendererEntryUrl = VITE_DEV_SERVER_URL || pathToFileURL(RENDERER_FILE).toString()
  let diagnosticNavigationAllowed = false
  let showingDiagnostic = false
  let recoveryState = createRendererRecoveryState()
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null
  let rendererUnresponsive = false
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null
  let unresponsivePromptOpen = false
  const autoReloadUnresponsive = process.env.VIBETRACKER_E2E_AUTO_RELOAD_UNRESPONSIVE === '1'
  const unresponsivePromptDelayMs = autoReloadUnresponsive ? 25 : 4_000

  const loadRendererEntry = () => VITE_DEV_SERVER_URL
    ? browserWindow.loadURL(VITE_DEV_SERVER_URL)
    : browserWindow.loadFile(RENDERER_FILE)

  const showRendererDiagnostic = async (title: string, summary: string, details: string) => {
    if (showingDiagnostic || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) return
    showingDiagnostic = true
    const document = buildRendererDiagnosticDocument({
      title,
      summary,
      details,
      retryUrl: rendererEntryUrl,
    })
    diagnosticNavigationAllowed = true
    try {
      await browserWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`)
    } catch (error) {
      console.error('[Renderer] Unable to display recovery page:', error)
    } finally {
      diagnosticNavigationAllowed = false
    }
  }

  const reloadRendererSafely = (details: string) => {
    const decision = decideRendererRecovery(recoveryState, Date.now())
    recoveryState = decision.state
    if (decision.action === 'diagnostic') {
      void showRendererDiagnostic(
        '页面进程反复退出',
        'VibeTracker 已停止自动重载，避免陷入崩溃循环。你可以查看详情后手动重试。',
        details,
      )
      return
    }
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      if (showingDiagnostic || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) return
      void loadRendererEntry().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        void showRendererDiagnostic('页面重新加载失败', 'VibeTracker 无法恢复前端页面。', message)
      })
    }, 250)
  }

  const clearUnresponsiveTimer = () => {
    if (!unresponsiveTimer) return
    clearTimeout(unresponsiveTimer)
    unresponsiveTimer = null
  }

  const markRendererResponsive = () => {
    rendererUnresponsive = false
    clearUnresponsiveTimer()
  }

  const scheduleUnresponsiveRecovery = () => {
    clearUnresponsiveTimer()
    unresponsiveTimer = setTimeout(async () => {
      unresponsiveTimer = null
      if (!rendererUnresponsive || showingDiagnostic || shutdownStarted || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) return
      if (autoReloadUnresponsive) {
        rendererUnresponsive = false
        reloadRendererSafely('renderer remained unresponsive during the recovery grace period')
        return
      }
      if (unresponsivePromptOpen) return
      unresponsivePromptOpen = true
      try {
        const result = await dialog.showMessageBox(browserWindow, {
          type: 'warning',
          title: 'VibeTracker 页面无响应',
          message: '页面进程暂时没有响应。',
          detail: '可以继续等待，或重新加载页面恢复操作。重新加载会丢失尚未保存的输入。',
          buttons: ['继续等待', '重新加载页面'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (!rendererUnresponsive || shutdownStarted || browserWindow.isDestroyed()) return
        if (result.response === 1) {
          rendererUnresponsive = false
          reloadRendererSafely('renderer remained unresponsive and the user requested a reload')
        } else {
          scheduleUnresponsiveRecovery()
        }
      } catch (error) {
        console.error('[Renderer] Unable to show unresponsive recovery prompt:', error)
        if (rendererUnresponsive) reloadRendererSafely('renderer remained unresponsive and the recovery prompt failed')
      } finally {
        unresponsivePromptOpen = false
      }
    }, unresponsivePromptDelayMs)
  }
  
  // Hide menu bar
  browserWindow.setMenuBarVisibility(false)

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  browserWindow.webContents.on('will-navigate', (event, url) => {
    const trustedRenderer = isTrustedRendererUrl(url, {
      devServerUrl: VITE_DEV_SERVER_URL,
      rendererFile: RENDERER_FILE,
    })
    const allowedDiagnostic = diagnosticNavigationAllowed && url.startsWith('data:text/html')
    if (!trustedRenderer && !allowedDiagnostic) {
      event.preventDefault()
      return
    }
    if (trustedRenderer && showingDiagnostic) {
      showingDiagnostic = false
      recoveryState = createRendererRecoveryState()
    }
  })

  browserWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const logger = level >= 2 ? console.error : console.log
    logger(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  browserWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    const details = `${errorDescription} (${errorCode})\n${validatedURL}`
    console.error(`[Renderer] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
    void showRendererDiagnostic('页面加载失败', 'VibeTracker 没有成功加载前端页面。', details)
  })
  browserWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[Renderer] Preload failed: ${preloadPath}`, error)
    if (showingDiagnostic) return
    void showRendererDiagnostic(
      '预加载桥接失败',
      'VibeTracker 无法安全连接主进程，因此没有继续加载项目数据。',
      `${preloadPath}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
    )
  })
  browserWindow.webContents.on('unresponsive', () => {
    if (shutdownStarted || showingDiagnostic || rendererUnresponsive || browserWindow.isDestroyed()) return
    rendererUnresponsive = true
    console.error('[Renderer] Page became unresponsive')
    scheduleUnresponsiveRecovery()
  })
  browserWindow.webContents.on('responsive', () => {
    if (rendererUnresponsive) console.info('[Renderer] Page became responsive again')
    markRendererResponsive()
  })
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] Process exited unexpectedly:', details)
    markRendererResponsive()
    if (shutdownStarted || details.reason === 'clean-exit' || browserWindow.isDestroyed()) return
    reloadRendererSafely(`reason=${details.reason}\nexitCode=${details.exitCode}`)
  })
  browserWindow.on('closed', () => {
    if (recoveryTimer) clearTimeout(recoveryTimer)
    clearUnresponsiveTimer()
  })

  void loadRendererEntry().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Renderer] Unable to load ${rendererEntryUrl}:`, error)
    void showRendererDiagnostic('页面加载失败', 'VibeTracker 无法打开前端入口文件。', message)
  })
  if (VITE_DEV_SERVER_URL) browserWindow.webContents.openDevTools()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (applicationServicesStarted) createWindow()
    else void attemptDatabaseStartup()
  }
})

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const development = Boolean(VITE_DEV_SERVER_URL)
    // Vite injects an inline React Refresh bootstrap in development. Keep the
    // packaged app strict while allowing that development-only module to run.
    const scriptSource = development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
    const connectSource = development ? "'self' ws: http: https:" : "'self' https:"
    const csp = `default-src 'self'; script-src ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: vibe-asset:; font-src 'self' data:; connect-src ${connectSource}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
  void attemptDatabaseStartup()
})

app.on('before-quit', event => {
  if (!processManager || shutdownReady) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void Promise.resolve().then(async () => {
    await gitSyncScheduler?.stop()
    await processManager?.stopAll()
    shutdownReady = true
    app.quit()
  }).catch(error => {
    shutdownStarted = false
    gitSyncScheduler?.start()
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Launch] Application quit cancelled because child processes are still running:', error)
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    dialog.showErrorBox('无法安全退出 VibeTracker', `仍有项目进程未能停止，应用将保持运行。请重试停止后再退出。\n\n${message}`)
  })
})

app.on('will-quit', () => {
  if (!databaseConnection) return
  try { databaseConnection.close() } catch (error) { console.error('[Database] Close failed:', error) }
  databaseConnection = null
})
