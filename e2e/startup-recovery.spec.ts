import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

async function reserveClosedPort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配恢复测试端口')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

test('successful renderer mount removes the static boot state', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-mounted-e2e-'))
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({
      cwd: process.cwd(),
      args: ['.'],
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        VIBETRACKER_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
        VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
      } as Record<string, string>,
      timeout: 30_000,
    })
    const page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await expect(page.locator('#vibetracker-boot')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-renderer-mounted', 'true')
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('renderer entry load failure shows a dark recovery page instead of a blank window', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-recovery-e2e-'))
  const unavailablePort = await reserveClosedPort()
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({
      cwd: process.cwd(),
      args: ['.'],
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${unavailablePort}`,
        VIBETRACKER_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
        VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
      } as Record<string, string>,
      timeout: 30_000,
    })
    const page = electronApp.windows().find(candidate => !candidate.url().startsWith('devtools://'))
      || await electronApp.waitForEvent('window', { predicate: candidate => !candidate.url().startsWith('devtools://') })

    await expect(page.getByRole('heading', { name: '页面加载失败' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '重新加载应用' })).toBeVisible()
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(8, 10, 13)')
    await expect(page.locator('body')).not.toBeEmpty()
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('a sustained renderer unresponsive event reloads into a visible route', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-unresponsive-e2e-'))
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({
      cwd: process.cwd(),
      args: ['.'],
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        VIBETRACKER_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
        VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
        VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
        VIBETRACKER_E2E_AUTO_RELOAD_UNRESPONSIVE: '1',
      } as Record<string, string>,
      timeout: 30_000,
    })
    const page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await page.evaluate(() => window.sessionStorage.setItem('unresponsive-recovery', 'pending'))

    const reloaded = page.waitForEvent('load')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.emit('unresponsive')
    })
    await reloaded

    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await expect(page.locator('.page-route-enter')).toHaveCSS('opacity', '1')
    expect(await page.evaluate(() => window.sessionStorage.getItem('unresponsive-recovery'))).toBe('pending')
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
