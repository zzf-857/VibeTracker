import { expect, test, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function setContentSize(electronApp: ElectronApplication, page: Page, width: number, height: number) {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed())
    if (!window) throw new Error('找不到 Electron 主窗口')
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
    .toEqual({ width, height })
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))).toEqual({ document: 0, body: 0 })
}

test('960px/1440px 主页面、焦点管理和 reduced motion 可用', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-responsive-e2e-'))
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
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()

    await setContentSize(electronApp, page, 960, 720)
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('link', { name: '项目' }).click()
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    const importButton = page.getByRole('button', { name: '导入本地项目' }).first()
    await importButton.click()
    const importDialog = page.getByRole('dialog', { name: '导入本地项目' })
    await expect(importDialog).toBeVisible()
    await expect(importDialog.getByRole('button', { name: '关闭导入向导' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(importDialog.getByRole('button', { name: '取消' }).last()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(importDialog).toBeHidden()
    await expect(importButton).toBeFocused()

    await page.getByRole('link', { name: '设置' }).click()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    const settingsTabs = page.getByRole('tablist', { name: '设置分类' })
    const aiTab = settingsTabs.getByRole('tab', { name: 'AI 与生成' })
    const taxonomyTab = settingsTabs.getByRole('tab', { name: '状态与标签' })
    const appTab = settingsTabs.getByRole('tab', { name: '存储与更新' })
    await expect(aiTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('生成与日志规则', { exact: true })).toBeVisible()
    await expect(page.getByText('日志粒度', { exact: true })).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await aiTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(taxonomyTab).toBeFocused()
    await expect(taxonomyTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: '项目状态' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '标签' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.keyboard.press('End')
    await expect(appTab).toBeFocused()
    await expect(appTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: '软件本身设置' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.keyboard.press('Home')
    await expect(aiTab).toBeFocused()
    await expect(aiTab).toHaveAttribute('aria-selected', 'true')
    await expectNoHorizontalOverflow(page)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reducedMotion = await page.evaluate(() => {
      const probe = document.createElement('button')
      probe.className = 'motion-action animate-spin'
      document.body.appendChild(probe)
      const style = getComputedStyle(probe)
      const result = { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }
      probe.remove()
      return result
    })
    expect(['0s', '0.001s']).toContain(reducedMotion.animationDuration)
    expect(['0s', '0.001s']).toContain(reducedMotion.transitionDuration)

    await setContentSize(electronApp, page, 1440, 900)
    for (const tab of [taxonomyTab, appTab, aiTab]) {
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expectNoHorizontalOverflow(page)
    }
    await expectNoHorizontalOverflow(page)
    await page.getByRole('link', { name: '首页' }).click()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
