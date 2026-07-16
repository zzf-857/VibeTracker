import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, args: string[]) {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return result.stdout.trim()
}

async function createRepository(root: string) {
  const projectDir = path.join(root, 'no-llm-project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# 未配置 LLM 项目\n\n验证纯本地项目流程。\n')
  await fs.writeFile(path.join(projectDir, 'index.js'), 'console.log("local-only")\n')
  await runGit(projectDir, ['init'])
  await runGit(projectDir, ['config', 'user.name', 'VibeTracker E2E'])
  await runGit(projectDir, ['config', 'user.email', 'e2e@example.invalid'])
  await runGit(projectDir, ['add', '.'])
  await runGit(projectDir, ['commit', '-m', 'feat: 验证未配置 LLM 的本地流程'])
  return projectDir
}

test('未配置 LLM 时 Git 导入、空项目和手工记录仍可用', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-no-llm-e2e-'))
  const projectDir = await createRepository(tempRoot)
  let electronApp: ElectronApplication | null = null
  const rendererErrors: string[] = []

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
        VIBETRACKER_E2E_PROJECT_DIR: projectDir,
      } as Record<string, string>,
      timeout: 30_000,
    })
    const page = await electronApp.firstWindow()
    page.on('pageerror', error => rendererErrors.push(error.message))

    const initialSettings = await page.evaluate(async () => (window as any).vibe.settings.get()) as {
      llm: { model: string; hasApiKey: boolean }
    }
    expect(initialSettings.llm).toMatchObject({ model: '', hasApiKey: false })

    await page.getByRole('link', { name: '项目' }).click()
    await page.getByRole('button', { name: '导入本地项目' }).first().click()
    await page.getByRole('button', { name: '选择本地项目目录' }).click()
    await page.getByLabel('项目名称').fill('未配置 LLM Git 项目')
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('h1').filter({ hasText: '未配置 LLM Git 项目' })).toBeVisible()

    const importedProject = await page.evaluate(async () => {
      const projects = await (window as any).vibe.projects.list() as Array<{
        id: string
        name: string
        gitSync: { status: string; commitCount: number }
      }>
      return projects.find(project => project.name === '未配置 LLM Git 项目')
    }) as { id: string; gitSync: { status: string; commitCount: number } }
    expect(importedProject.gitSync).toMatchObject({ status: 'synced', commitCount: 1 })

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: /开发记录/ }).click()
    await page.getByLabel('开发记录标题').fill('未配置 LLM 的手工记录')
    await page.getByLabel('开发记录内容').fill('Git 与手工记录不依赖模型配置。')
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect(page.getByText('未配置 LLM 的手工记录', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'AI 同步' }).click()
    const aiDialog = page.getByRole('dialog', { name: 'AI 同步与审核' })
    await expect(aiDialog.getByRole('button', { name: '生成待审核草稿' })).toBeVisible()
    await aiDialog.getByRole('button', { name: '生成待审核草稿' }).click()
    await expect(page.getByText('AI 生成失败', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/请先在设置中配置 Base URL、Model 和 API Key/).first()).toBeVisible()

    const localOnlyState = await page.evaluate(async projectId => {
      const [drafts, records] = await Promise.all([
        (window as any).vibe.records.drafts(projectId),
        (window as any).vibe.records.list(projectId, { limit: 20 }),
      ])
      return {
        draftCount: drafts.length,
        manualRecords: records.items.filter((record: { source: string; reviewStatus: string }) => (
          record.source === 'manual' && record.reviewStatus === 'accepted'
        )).length,
      }
    }, importedProject.id)
    expect(localOnlyState).toEqual({ draftCount: 0, manualRecords: 1 })
    await aiDialog.getByRole('button', { name: '关闭 AI 同步' }).evaluate(button => button.click())

    await page.getByRole('link', { name: '项目' }).click()
    await page.getByRole('button', { name: '导入本地项目' }).first().click()
    await page.getByRole('tab', { name: '空项目' }).click()
    await page.getByLabel('项目名称').fill('未配置 LLM 空项目')
    await page.getByRole('button', { name: '创建项目' }).click()
    await expect(page.locator('h1').filter({ hasText: '未配置 LLM 空项目' })).toBeVisible()

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: /开发记录/ }).click()
    await page.getByLabel('开发记录标题').fill('空项目手工记录')
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect(page.getByText('空项目手工记录', { exact: true })).toBeVisible()

    const emptyProjectState = await page.evaluate(async () => {
      const projects = await (window as any).vibe.projects.list() as Array<{
        id: string
        name: string
        gitSync: { status: string }
      }>
      const project = projects.find(item => item.name === '未配置 LLM 空项目')
      if (!project) throw new Error('空项目未创建')
      const records = await (window as any).vibe.records.list(project.id, { limit: 20 })
      return { gitStatus: project.gitSync.status, recordTitles: records.items.map((record: { title: string }) => record.title) }
    }) as { gitStatus: string; recordTitles: string[] }
    expect(emptyProjectState.gitStatus).toBe('unavailable')
    expect(emptyProjectState.recordTitles).toContain('空项目手工记录')
    expect(rendererErrors).toEqual([])
  } finally {
    await electronApp?.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
