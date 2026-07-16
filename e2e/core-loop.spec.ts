import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const appRoot = process.cwd()

async function runGit(cwd: string, args: string[]) {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return result.stdout.trim()
}

function createBmp(width: number, height: number) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowSize * height
  const buffer = Buffer.alloc(54 + pixelBytes)
  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(buffer.length, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelBytes, 34)
  buffer.writeInt32LE(2_835, 38)
  buffer.writeInt32LE(2_835, 42)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3
      buffer[offset] = Math.round((x / Math.max(1, width - 1)) * 255)
      buffer[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255)
      buffer[offset + 2] = 120
    }
  }
  return buffer
}

async function createGitFixture(root: string) {
  const projectDir = path.join(root, 'vibetracker-e2e-project')
  const projectImagePath = path.join(projectDir, 'docs', 'preview.png')
  const thumbnailImagePath = path.join(projectDir, 'docs', 'thumbnail-source.bmp')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(path.dirname(projectImagePath), { recursive: true })
  await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({
    name: 'vibetracker-e2e-project',
    version: '1.0.0',
    scripts: { dev: 'node demo.js' },
    dependencies: { react: '^18.0.0' },
  }, null, 2))
  await fs.writeFile(path.join(projectDir, 'README.md'), '# E2E 本地项目\n\n用于验证 VibeTracker 核心闭环。\n')
  await fs.writeFile(path.join(projectDir, 'demo.js'), 'console.log("demo")\n')
  await fs.writeFile(projectImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=', 'base64'))
  await fs.writeFile(thumbnailImagePath, createBmp(320, 180))
  await runGit(projectDir, ['init'])
  await runGit(projectDir, ['config', 'user.name', 'VibeTracker E2E'])
  await runGit(projectDir, ['config', 'user.email', 'e2e@example.invalid'])
  await runGit(projectDir, ['add', '.'])
  await runGit(projectDir, ['commit', '-m', 'feat: 建立 E2E 项目闭环'])
  await fs.appendFile(path.join(projectDir, 'demo.js'), 'console.log("second-step")\n')
  await runGit(projectDir, ['add', 'demo.js'])
  await runGit(projectDir, ['commit', '-m', 'chore: 增加第二个可追溯步骤'])
  await runGit(projectDir, ['branch', '-M', 'main'])
  return { projectDir, projectImagePath, thumbnailImagePath, headSha: await runGit(projectDir, ['rev-parse', 'HEAD']) }
}

async function createRelinkFixture(root: string, sourceProjectDir: string) {
  const projectDir = path.join(root, 'vibetracker-e2e-relinked')
  await runGit(root, ['clone', '--no-local', sourceProjectDir, projectDir])
  return projectDir
}

async function startProvider(headSha: string) {
  const requests: Array<Record<string, unknown>> = []
  let failuresRemaining = 0
  const server = http.createServer(async (request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'e2e-model' }] }))
      return
    }
    if (request.url?.endsWith('/chat/completions')) {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const requestBody = Buffer.concat(chunks).toString('utf8')
      requests.push(JSON.parse(requestBody) as Record<string, unknown>)
      if (failuresRemaining > 0) {
        failuresRemaining -= 1
        response.writeHead(500, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'simulated generation failure' } }))
        return
      }
      const inputShas = [...new Set(requestBody.match(/\b[0-9a-f]{40,64}\b/gi) || [])]
      const responseSha = inputShas.includes(headSha) ? headSha : inputShas.at(-1) || headSha
      await new Promise(resolve => setTimeout(resolve, 250))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              project: {
                name: 'E2E 本地项目',
                description: '通过真实 Electron 流程验证的本地项目。',
                techStack: ['React', 'Node.js'],
                tags: ['E2E'],
                phase: '核心闭环验证',
                phaseReason: '已完成导入、同步和审核。',
                confidence: 0.96,
                evidence: [responseSha],
              },
              records: [{
                title: 'E2E AI 开发记录',
                description: '完成本地项目导入、Git 同步与 AI 草稿审核。',
                gitShas: [responseSha],
                confidence: 0.95,
                evidence: ['Git commit message 与文件统计'],
              }],
              assetNotes: [],
            }),
          },
        }],
      }))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法启动 E2E LLM Provider')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    failNext: () => { failuresRemaining += 1 },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

test('Electron 核心闭环：导入、Git、AI 审核、启动、停止与删除', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetracker-e2e-'))
  const userDataDir = path.join(tempRoot, 'user-data')
  const screenshotsTarget = path.join(tempRoot, 'screenshots-target')
  const unauthorizedImagePath = path.join(tempRoot, 'unauthorized.png')
  await fs.mkdir(screenshotsTarget, { recursive: true })
  await fs.writeFile(unauthorizedImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=', 'base64'))
  const fixture = await createGitFixture(tempRoot)
  const provider = await startProvider(fixture.headSha)
  let electronApp: ElectronApplication | null = null
  const rendererErrors: string[] = []

  try {
    electronApp = await electron.launch({
      cwd: appRoot,
      args: ['.'],
      env: {
        ...process.env,
        VIBETRACKER_USER_DATA_DIR: userDataDir,
        VIBETRACKER_SKIP_LEGACY_MIGRATION: '1',
        VIBETRACKER_ALLOW_MULTIPLE_INSTANCES: '1',
        VIBETRACKER_E2E_PROJECT_DIR: fixture.projectDir,
        VIBETRACKER_E2E_SCREENSHOTS_DIR: screenshotsTarget,
        VIBETRACKER_E2E_IMAGE_PATHS: JSON.stringify([fixture.thumbnailImagePath]),
      } as Record<string, string>,
      timeout: 30_000,
    })
    const page = await electronApp.firstWindow()
    page.on('pageerror', error => rendererErrors.push(error.message))

    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByRole('link', { name: '首页' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '今天从哪里继续？' })).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(8, 10, 13)')

    await page.getByRole('link', { name: '设置' }).click()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await page.getByLabel('Base URL').fill(provider.baseUrl)
    await page.getByLabel('Model').fill('e2e-model')
    await page.getByLabel('API Key').fill('temporary-e2e-key')
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByText('连接成功', { exact: true })).toBeVisible()
    await expect(page.getByText(/设置尚未保存/)).toBeVisible()
    const settingsAfterTest = await page.evaluate(async () => (window as any).vibe.settings.get()) as {
      llm: { model: string; hasApiKey: boolean }
    }
    expect(settingsAfterTest.llm.model).toBe('')
    expect(settingsAfterTest.llm.hasApiKey).toBe(false)
    await page.getByRole('button', { name: '保存设置' }).click()
    await expect(page.getByText('LLM 设置已保存', { exact: true })).toBeVisible()
    const settingsAfterSave = await page.evaluate(async () => (window as any).vibe.settings.get()) as {
      llm: { model: string; hasApiKey: boolean }
    }
    expect(settingsAfterSave.llm.model).toBe('e2e-model')
    expect(settingsAfterSave.llm.hasApiKey).toBe(true)

    await page.getByRole('tab', { name: '状态与标签' }).click()
    await page.getByPlaceholder('状态名称').fill('E2E 验收中')
    await page.getByRole('button', { name: '创建状态' }).click()
    await expect(page.getByText('状态已创建', { exact: true })).toBeVisible()
    const statusRow = page.locator('.status-row').last()
    const statusInput = statusRow.locator('input:not([type])').first()
    await expect(statusInput).toHaveValue('E2E 验收中')
    await statusInput.fill('E2E 已验收')
    await statusRow.getByTitle('保存').click()
    await expect(page.getByText('状态已保存', { exact: true })).toBeVisible()
    await statusRow.getByTitle('删除').click()
    await statusRow.getByRole('button', { name: '确认' }).click()
    await expect(page.getByText('状态已删除', { exact: true })).toBeVisible()

    const taxonomy = page.locator('#taxonomy')
    await taxonomy.getByPlaceholder('新标签').fill('E2E 标签')
    await taxonomy.getByRole('button', { name: '创建标签' }).evaluate(button => { button.click(); button.click() })
    await expect(taxonomy.getByText('E2E 标签', { exact: true })).toBeVisible()
    const createdTagCount = await page.evaluate(async () => {
      const tags = await (window as any).vibe.taxonomy.listTags() as Array<{ name: string }>
      return tags.filter(tag => tag.name === 'E2E 标签').length
    })
    expect(createdTagCount).toBe(1)
    await taxonomy.getByRole('button', { name: '编辑标签 E2E 标签' }).click()
    const tagEditRow = taxonomy.getByRole('button', { name: '保存标签' }).locator('xpath=..')
    await tagEditRow.locator('input:not([type])').fill('E2E 标签更新')
    await tagEditRow.getByRole('button', { name: '保存标签' }).click()
    await expect(taxonomy.getByText('E2E 标签更新', { exact: true })).toBeVisible()
    await taxonomy.getByRole('button', { name: '删除标签 E2E 标签更新' }).click()
    await expect(taxonomy.getByText('E2E 标签更新', { exact: true })).toBeHidden()

    await page.getByRole('tab', { name: '存储与更新' }).click()
    await page.getByRole('button', { name: '更改文件夹' }).click()
    await expect(page.locator('input[readonly]')).toHaveValue(screenshotsTarget)
    const screenshotTaskCenter = page.locator('aside').filter({ hasText: '后台任务' })
    await screenshotTaskCenter.getByRole('button', { name: /后台任务/ }).click()
    await expect(screenshotTaskCenter.getByText('截图目录迁移', { exact: true })).toBeVisible()
    await expect(screenshotTaskCenter.getByText('已完成', { exact: true }).first()).toBeVisible()
    await screenshotTaskCenter.getByRole('button', { name: /后台任务/ }).click()
    const preloadBoundary = await page.evaluate(() => ({
      genericBridgeExposed: 'ipcRenderer' in window,
      apiVersion: (window as any).vibe?.apiVersion,
      hasDomainProjects: typeof (window as any).vibe?.projects?.list === 'function',
      hasDomainUpdater: typeof (window as any).vibe?.app?.checkForUpdates === 'function',
    }))
    expect(preloadBoundary).toEqual({
      genericBridgeExposed: false,
      apiVersion: 1,
      hasDomainProjects: true,
      hasDomainUpdater: true,
    })

    await page.getByRole('link', { name: '项目' }).click()
    await page.getByRole('button', { name: '导入本地项目' }).first().click()
    await page.getByRole('button', { name: '选择本地项目目录' }).click()
    await expect(page.getByText('HEAD', { exact: false })).toBeVisible()
    await page.getByRole('radio', { name: '最近提交基线' }).check()
    await page.getByLabel('Git 历史基线数量').selectOption('200')
    await page.getByRole('radio', { name: '暂不配置' }).check()
    await page.getByLabel('项目名称').fill('E2E 本地项目')
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('h1').filter({ hasText: 'E2E 本地项目' })).toBeVisible()

    const imported = await page.evaluate(async () => {
      const projects = await (window as any).vibe.projects.list()
      return projects.find((project: { name: string }) => project.name === 'E2E 本地项目')
    }) as { id: string; gitSync: { commitCount: number; historyLimit: number; historyTruncated: boolean } }
    expect(imported.gitSync.commitCount).toBe(2)
    expect(imported.gitSync.historyLimit).toBe(200)
    expect(imported.gitSync.historyTruncated).toBe(false)

    const imageDimensions = await page.evaluate(async imagePath => {
      const load = (src: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error(`图片加载失败: ${src}`))
        image.src = src
      })
      const base = `vibe-asset://local/${encodeURIComponent(imagePath)}`
      return {
        original: await load(base),
        thumbnail: await load(`${base}?size=96`),
      }
    }, fixture.thumbnailImagePath)
    expect(imageDimensions.original).toEqual({ width: 320, height: 180 })
    expect(imageDimensions.thumbnail.width).toBeGreaterThan(0)
    expect(imageDimensions.thumbnail.height).toBeGreaterThan(0)
    expect(imageDimensions.thumbnail.width).toBeLessThanOrEqual(96)
    expect(imageDimensions.thumbnail.height).toBeLessThanOrEqual(96)
    expect(imageDimensions.thumbnail.width).toBeLessThan(imageDimensions.original.width)

    const rejectedAssetWrites = await page.evaluate(async ({ projectId, imagePath }) => {
      const errors: string[] = []
      try {
        await (window as any).vibe.projects.update(projectId, { coverImagePath: imagePath })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      try {
        await (window as any).vibe.records.create({ projectId, title: '不应写入的图片', imagePaths: [imagePath] })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      return errors
    }, { projectId: imported.id, imagePath: unauthorizedImagePath })
    expect(rejectedAssetWrites).toHaveLength(2)
    expect(rejectedAssetWrites.every(message => message.includes('图片路径未通过授权'))).toBe(true)

    const legalImageRecordId = await page.evaluate(async ({ projectId, imagePath }) => {
      await (window as any).vibe.projects.update(projectId, { coverImagePath: imagePath })
      return (window as any).vibe.records.create({ projectId, title: '合法项目图片验证', imagePaths: [imagePath] })
    }, { projectId: imported.id, imagePath: fixture.projectImagePath }) as string
    await page.evaluate(async recordId => (window as any).vibe.records.delete(recordId), legalImageRecordId)

    const rejectedTaxonomyWrites = await page.evaluate(async selectedPath => {
      const attempts = [
        () => (window as any).vibe.projects.createEmpty({ name: '无效状态项目', status: 'missing-status' }),
        () => (window as any).vibe.projects.createEmpty({ name: '无效标签项目', tagIds: ['missing-tag'] }),
        () => (window as any).vibe.projects.import({ selectedPath, name: '无效导入状态', status: 'missing-status' }),
        () => (window as any).vibe.projects.import({ selectedPath, name: '无效导入标签', tagIds: ['missing-tag'] }),
      ]
      const errors: string[] = []
      for (const attempt of attempts) {
        try { await attempt(); errors.push('') }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
      }
      return errors
    }, fixture.projectDir)
    expect(rejectedTaxonomyWrites[0]).toContain('项目状态不存在')
    expect(rejectedTaxonomyWrites[1]).toContain('标签包含不存在的 ID')
    expect(rejectedTaxonomyWrites[2]).toContain('项目状态不存在')
    expect(rejectedTaxonomyWrites[3]).toContain('标签包含不存在的 ID')

    const strictInputErrors = await page.evaluate(async projectId => {
      const attempts = [
        () => (window as any).vibe.projects.update(projectId, { progress: 50 }),
        () => (window as any).vibe.records.create({ projectId, title: '非法旧字段', progressDelta: 10 }),
        () => (window as any).vibe.git.list(projectId, { limit: 10, offset: 0 }),
      ]
      const errors: string[] = []
      for (const attempt of attempts) {
        try { await attempt(); errors.push('') }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
      }
      return errors
    }, imported.id)
    expect(strictInputErrors[0]).toContain('项目更新包含不支持字段: progress')
    expect(strictInputErrors[1]).toContain('开发记录包含不支持字段: progressDelta')
    expect(strictInputErrors[2]).toContain('分页参数包含不支持字段: offset')

    const duplicateSync = await page.evaluate(async projectId => (window as any).vibe.git.sync(projectId), imported.id)
    expect(duplicateSync.inserted).toBe(0)

    await page.evaluate(async ({ baseUrl }) => {
      await (window as any).vibe.settings.update({
        llm: {
          baseUrl,
          model: 'e2e-model',
          apiKey: 'e2e-secret',
          defaultLanguage: 'zh-CN',
          logGranularity: 'minimal',
          toneMode: 'historical',
          excludedPaths: ['node_modules/**'],
          customRules: ['只陈述可验证事实'],
        },
      })
    }, { baseUrl: provider.baseUrl })

    await page.getByRole('button', { name: 'AI 同步' }).click()
    await expect(page.getByRole('button', { name: '生成待审核草稿' })).toBeVisible()
    await page.getByRole('button', { name: '生成待审核草稿' }).evaluate(button => { button.click(); button.click() })
    await expect(page.locator('input[value="E2E AI 开发记录"]')).toBeVisible()
    await page.getByRole('button', { name: '明确应用建议' }).evaluate(button => { button.click(); button.click() })
    await expect(page.getByText('项目建议已应用', { exact: true })).toBeVisible()
    const applicationTrace = page.getByText(/项目资料建议已明确应用 1 次/)
    await expect(applicationTrace).toBeVisible()
    await applicationTrace.click()
    await expect(page.getByText('项目简介', { exact: true })).toBeVisible()
    await expect(page.getByText('核心闭环验证', { exact: true })).toBeVisible()
    await expect(page.getByLabel('本次应用关联的 Git SHA').locator('code')).toHaveCount(2)
    const appliedSuggestion = await page.evaluate(async projectId => {
      const project = await (window as any).vibe.projects.get(projectId) as {
        name: string
        description: string
        phase: string
        tags: Array<{ name: string }>
      }
      const tags = await (window as any).vibe.taxonomy.listTags() as Array<{ name: string }>
      return {
        name: project.name,
        description: project.description,
        phase: project.phase,
        projectTagCount: project.tags.filter(tag => tag.name === 'E2E').length,
        globalTagCount: tags.filter(tag => tag.name === 'E2E').length,
      }
    }, imported.id)
    expect(appliedSuggestion).toEqual({
      name: 'E2E 本地项目',
      description: '通过真实 Electron 流程验证的本地项目。',
      phase: '核心闭环验证',
      projectTagCount: 1,
      globalTagCount: 1,
    })
    const generatedDraft = await page.evaluate(async projectId => {
      const drafts = await (window as any).vibe.records.drafts(projectId) as Array<{ id: string; gitShas: string[] }>
      if (!drafts[0]?.gitShas[0]) throw new Error('AI 草稿没有关联 Git SHA')
      return { id: drafts[0].id, sha: drafts[0].gitShas[0] }
    }, imported.id)
    const generatedRunTrace = await page.evaluate(async projectId => {
      const runs = await (window as any).vibe.ai.listRuns(projectId) as Array<{ id: string }>
      return (window as any).vibe.ai.getRun(projectId, runs[0].id)
    }, imported.id) as {
      status: string; inputHash: string; inputShas: string[]; settingsSnapshot: Record<string, unknown>; inputSnapshot: { commits: unknown[] }
    }
    expect(generatedRunTrace.status).toBe('succeeded')
    expect(generatedRunTrace.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(generatedRunTrace.inputShas).toContain(generatedDraft.sha)
    expect(generatedRunTrace.inputSnapshot.commits.length).toBeGreaterThan(0)
    expect(JSON.stringify(generatedRunTrace.settingsSnapshot)).not.toContain('e2e-secret')
    await page.getByRole('button', { name: '完成审核' }).click()
    const recordsTab = page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: /开发记录/ })
    await recordsTab.click()
    await page.getByRole('button', { name: 'Git 事实' }).click()
    const draftCommit = page.locator(`[id="git-${generatedDraft.sha}"]`)
    await expect(draftCommit.getByText('待审核草稿', { exact: true })).toBeVisible()
    await expect(draftCommit.getByRole('button', { name: '写入手工记录' })).toHaveCount(0)
    await expect(draftCommit.getByRole('button', { name: '恢复待处理' })).toHaveCount(0)
    await draftCommit.getByRole('button', { name: '查看并审核草稿' }).click()
    const draftCard = page.locator(`[id="record-${generatedDraft.id}"]`)
    await expect(draftCard).toBeVisible()
    await draftCard.getByRole('button', { name: '接受' }).evaluate(button => { button.click(); button.click() })
    await expect(page.getByText('E2E AI 开发记录', { exact: true })).toBeVisible()
    expect(provider.requests).toHaveLength(1)
    expect(JSON.stringify(provider.requests[0])).toContain('每条记录必须关联真实 Git SHA')

    await page.getByRole('button', { name: 'Git 事实' }).click()
    const acceptedCommit = page.locator(`[id="git-${generatedDraft.sha}"]`)
    await expect(acceptedCommit.getByText('已处理', { exact: true })).toBeVisible()
    await expect(acceptedCommit.getByRole('button', { name: '恢复待处理' })).toHaveCount(0)
    const pendingSha = await page.evaluate(async projectId => {
      const gitPage = await (window as any).vibe.git.list(projectId, { limit: 30 }) as {
        items: Array<{ sha: string; disposition?: string }>
      }
      const pending = gitPage.items.find(commit => (commit.disposition || 'pending') === 'pending')
      if (!pending) throw new Error('没有找到 AI 审核后剩余的待处理提交')
      return pending.sha
    }, imported.id)
    const pendingCommit = page.locator(`[id="git-${pendingSha}"]`)
    await expect(pendingCommit.getByText('待处理', { exact: true })).toBeVisible()
    await pendingCommit.getByRole('button', { name: '忽略' }).click()
    await expect(pendingCommit.getByText('已忽略', { exact: true })).toBeVisible()
    await pendingCommit.getByRole('button', { name: '恢复待处理' }).click()
    await expect(pendingCommit.getByText('待处理', { exact: true })).toBeVisible()
    await pendingCommit.getByRole('button', { name: '写入手工记录' }).click()
    await page.getByLabel('开发记录标题').fill('E2E 手工 Git 归档')
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect(page.getByText('E2E 手工 Git 归档', { exact: true })).toBeVisible()
    const manualRecord = page.getByText('E2E 手工 Git 归档', { exact: true }).locator('xpath=ancestor::article')
    await expect(manualRecord.locator('code').filter({ hasText: pendingSha.slice(0, 10) })).toBeVisible()
    const trackingSummary = await page.evaluate(async () => (window as any).vibe.dashboard.get()) as { counts: { pendingGit: number } }
    expect(trackingSummary.counts.pendingGit).toBe(0)

    const recordImageFixture = await page.evaluate(async projectId => {
      const page = await (window as any).vibe.records.list(projectId, { limit: 20 }) as {
        items: Array<{ id: string; title: string }>
      }
      const record = page.items.find(item => item.title === 'E2E 手工 Git 归档')
      if (!record) throw new Error('没有找到用于验证图片编辑的正式记录')
      const managedPath = await (window as any).vibe.assets.saveImage(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlFhE0AAAAASUVORK5CYII=',
        'managed-record-image.png',
      ) as string
      const managed = await (window as any).vibe.records.addImage(record.id, { imagePath: managedPath, caption: '托管图片' })
      return { recordId: record.id, managedImageId: managed.id, managedPath }
    }, imported.id) as {
      recordId: string; managedImageId: string; managedPath: string
    }
    const detailNavigation = page.locator('nav[aria-label="项目详情分区"]')
    await detailNavigation.getByRole('button', { name: '概览', exact: true }).click()
    await detailNavigation.getByRole('button', { name: /开发记录/ }).click()
    const imageRecord = page.locator(`[id="record-${recordImageFixture.recordId}"]`)
    await expect(imageRecord.getByText('截图 1 张', { exact: true })).toBeVisible()
    await expect(imageRecord.getByText('托管图片', { exact: true })).toBeVisible()
    await imageRecord.getByRole('button', { name: '添加截图' }).click()
    await expect(imageRecord.getByText('截图 2 张', { exact: true })).toBeVisible()
    await imageRecord.getByRole('button', { name: '编辑截图 2 说明' }).click()
    await imageRecord.getByLabel('编辑截图 2 说明').fill('E2E 项目截图')
    await imageRecord.getByRole('button', { name: '保存截图说明' }).click()
    await expect(imageRecord.getByText('E2E 项目截图', { exact: true })).toBeVisible()
    await imageRecord.getByRole('button', { name: '预览图片：E2E 项目截图' }).click()
    const imagePreview = page.getByRole('dialog', { name: '图片预览' })
    const previewDimensions = await imagePreview.locator('img[alt="图片预览"]').evaluate(image => ({
      width: (image as HTMLImageElement).naturalWidth,
      height: (image as HTMLImageElement).naturalHeight,
    }))
    expect(previewDimensions).toEqual({ width: 320, height: 180 })
    await imagePreview.getByRole('button', { name: '关闭图片预览' }).click()
    await imageRecord.getByRole('button', { name: '将截图 2 前移' }).click()
    const reorderedImages = await page.evaluate(async ({ projectId, recordId }) => {
      const page = await (window as any).vibe.records.list(projectId, { limit: 20 }) as {
        items: Array<{ id: string; images: Array<{ id: string; caption: string }> }>
      }
      return page.items.find(item => item.id === recordId)?.images || []
    }, { projectId: imported.id, recordId: recordImageFixture.recordId }) as Array<{ id: string; caption: string }>
    expect(reorderedImages[0].caption).toBe('E2E 项目截图')
    expect(reorderedImages[1].id).toBe(recordImageFixture.managedImageId)
    await imageRecord.getByRole('button', { name: '删除截图 2' }).click()
    const deleteImageDialog = page.getByRole('dialog', { name: '删除截图' })
    await expect(deleteImageDialog).toBeVisible()
    await deleteImageDialog.getByRole('button', { name: '删除截图' }).evaluate(button => { button.click(); button.click() })
    await expect(imageRecord.getByText('截图 1 张', { exact: true })).toBeVisible()
    await expect(imageRecord.getByText('托管图片', { exact: true })).toBeHidden()
    await expect(fs.stat(recordImageFixture.managedPath)).rejects.toThrow()
    await expect(fs.stat(fixture.thumbnailImagePath)).resolves.toBeTruthy()
    await expect(page.getByText('截图删除失败', { exact: true })).toHaveCount(0)

    await page.getByLabel('开发记录标题').fill('E2E 待删除记录')
    await page.getByRole('button', { name: '保存', exact: true }).first().evaluate(button => { button.click(); button.click() })
    const deletableRecord = page.getByText('E2E 待删除记录', { exact: true }).locator('xpath=ancestor::article')
    await expect(deletableRecord).toBeVisible()
    await deletableRecord.getByRole('button', { name: '删除开发记录' }).click()
    const deleteRecordDialog = page.getByRole('dialog', { name: '删除开发记录' })
    await expect(deleteRecordDialog).toBeVisible()
    await deleteRecordDialog.getByRole('button', { name: '删除记录' }).evaluate(button => { button.click(); button.click() })
    await expect(deletableRecord).toBeHidden()
    const deletedRecordCount = await page.evaluate(async projectId => {
      const recordPage = await (window as any).vibe.records.list(projectId, { limit: 100 }) as {
        items: Array<{ title: string }>
      }
      return recordPage.items.filter(record => record.title === 'E2E 待删除记录').length
    }, imported.id)
    expect(deletedRecordCount).toBe(0)
    await expect(page.getByText('开发记录删除失败', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'AI 同步' }).click()
    await page.getByRole('button', { name: '历史运行' }).click()
    const completedRun = page.locator('article').filter({ hasText: '已完成' }).first()
    await completedRun.getByRole('button', { name: '重新打开' }).click()
    await expect(page.getByRole('heading', { name: '生成追溯' })).toBeVisible()
    await expect(page.getByText('已接受', { exact: true })).toBeVisible()
    await expect(page.getByText('查看规则、设置与输入快照')).toBeVisible()
    await page.getByRole('button', { name: '完成审核' }).click()

    await fs.writeFile(path.join(fixture.projectDir, 'retry-history.js'), 'console.log("retry-history")\n')
    await runGit(fixture.projectDir, ['add', 'retry-history.js'])
    await runGit(fixture.projectDir, ['commit', '-m', 'test: AI 运行历史失败重试'])
    await page.evaluate(async projectId => (window as any).vibe.git.sync(projectId), imported.id)
    await page.getByRole('button', { name: 'AI 同步' }).click()
    await expect(page.getByRole('button', { name: '生成待审核草稿' })).toBeVisible()
    provider.failNext()
    await page.getByRole('button', { name: '生成待审核草稿' }).click()
    await expect(page.getByText('AI 生成失败').last()).toBeVisible()
    const failedRunTrace = await page.evaluate(async projectId => {
      const runs = await (window as any).vibe.ai.listRuns(projectId) as Array<{ id: string; status: string }>
      const failed = runs.find(run => run.status === 'failed')
      if (!failed) throw new Error('没有找到失败的 AI generation run')
      return (window as any).vibe.ai.getRun(projectId, failed.id)
    }, imported.id) as { status: string; inputHash: string; inputShas: string[] }
    expect(failedRunTrace.status).toBe('failed')
    expect(failedRunTrace.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(failedRunTrace.inputShas.length).toBeGreaterThan(0)
    await page.getByRole('button', { name: '历史运行' }).click()
    const failedRun = page.locator('article').filter({ hasText: 'simulated generation failure' })
    await failedRun.getByRole('button', { name: '按原范围重试' }).click()
    const retriedAiDialog = page.getByRole('dialog', { name: 'AI 同步与审核' })
    await expect(retriedAiDialog.getByRole('heading', { name: '生成追溯' })).toBeVisible()
    await expect(retriedAiDialog.locator('input[value="E2E AI 开发记录"]')).toBeVisible()
    await retriedAiDialog.getByRole('button', { name: '接受' }).evaluate(button => { button.click(); button.click() })
    await retriedAiDialog.getByRole('button', { name: '完成审核' }).click()
    expect(provider.requests).toHaveLength(3)

    const backgroundTaskToggle = page.getByRole('button', { name: /后台任务/ })
    if (await backgroundTaskToggle.count() && await backgroundTaskToggle.getAttribute('aria-expanded') === 'true') {
      await backgroundTaskToggle.click()
      await expect(backgroundTaskToggle).toHaveAttribute('aria-expanded', 'false')
    }

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: '备注与待办' }).click()
    await page.getByPlaceholder('添加备注').fill('E2E 备注')
    await page.getByRole('button', { name: '添加备注' }).evaluate(button => { button.click(); button.click() })
    await expect(page.getByText('E2E 备注', { exact: true })).toBeVisible()
    await page.getByPlaceholder('添加下一项行动').fill('E2E 待办')
    await page.getByRole('button', { name: '添加待办' }).evaluate(button => { button.click(); button.click() })
    await expect(page.getByText('E2E 待办', { exact: true })).toBeVisible()
    const createdNoteTodoCounts = await page.evaluate(async projectId => {
      const project = await (window as any).vibe.projects.get(projectId) as {
        noteblocks: Array<{ content: string }>
        todos: Array<{ content: string }>
      }
      return {
        notes: project.noteblocks.filter(item => item.content === 'E2E 备注').length,
        todos: project.todos.filter(item => item.content === 'E2E 待办').length,
      }
    }, imported.id)
    expect(createdNoteTodoCounts).toEqual({ notes: 1, todos: 1 })
    const invalidTodoBoolean = await page.evaluate(async projectId => {
      const project = await (window as any).vibe.projects.get(projectId) as {
        todos: Array<{ id: string; content: string }>
      }
      const todo = project.todos.find(item => item.content === 'E2E 待办')
      if (!todo) throw new Error('没有找到待验证的待办')
      try {
        await (window as any).vibe.todos.update(todo.id, { completed: 'false' })
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, imported.id)
    expect(invalidTodoBoolean).toContain('布尔值')
    await page.getByRole('button', { name: '编辑待办' }).click()
    await page.getByLabel('编辑待办内容').fill('E2E 已编辑待办')
    await page.getByRole('button', { name: '保存待办' }).click()
    await expect(page.getByText('E2E 已编辑待办', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '编辑备注' }).click()
    await page.getByLabel('编辑备注内容').fill('E2E 已编辑备注')
    await page.getByRole('button', { name: '保存备注' }).click()
    await expect(page.getByText('E2E 已编辑备注', { exact: true })).toBeVisible()
    const todoRow = page.getByText('E2E 已编辑待办', { exact: true }).locator('xpath=..')
    await todoRow.getByRole('button', { name: '标记为完成' }).click()
    await todoRow.getByRole('button', { name: '删除待办' }).click()
    await expect(page.getByText('E2E 已编辑待办', { exact: true })).toBeHidden()
    const noteRow = page.getByText('E2E 已编辑备注', { exact: true }).locator('xpath=..')
    await noteRow.getByRole('button', { name: '删除备注' }).click()
    await expect(page.getByText('E2E 已编辑备注', { exact: true })).toBeHidden()

    await page.evaluate(async projectId => {
      const base = Date.now()
      for (let index = 0; index < 22; index += 1) {
        await (window as any).vibe.records.create({
          projectId,
          title: `E2E 分页记录 ${String(index + 1).padStart(2, '0')}`,
          description: '用于验证旧记录深链接自动翻页。',
          createdAt: base + index,
        })
      }
    }, imported.id)
    for (let index = 0; index < 55; index += 1) {
      await runGit(fixture.projectDir, ['commit', '--allow-empty', '-m', `test: 深链接分页提交 ${String(index + 1).padStart(2, '0')}`])
    }
    const paginationSync = await page.evaluate(async projectId => (window as any).vibe.git.sync(projectId), imported.id) as {
      inserted: number
    }
    expect(paginationSync.inserted).toBe(55)
    await page.getByRole('button', { name: 'AI 同步' }).click()
    const pagedAiDialog = page.getByRole('dialog', { name: 'AI 同步与审核' })
    await expect(pagedAiDialog.getByText(/已加载 50 \/ 55 条待处理提交/)).toBeVisible()
    await pagedAiDialog.getByRole('button', { name: '加载更多待处理提交' }).evaluate(button => { button.click(); button.click() })
    await expect(pagedAiDialog.getByText(/已加载 55 \/ 55 条待处理提交/)).toBeVisible()
    await pagedAiDialog.getByRole('button', { name: '关闭 AI 同步' }).evaluate(button => button.click())
    await page.reload()
    await expect(page.getByRole('link', { name: '项目' })).toBeVisible()
    await page.evaluate(({ projectId, sha }) => {
      window.location.hash = `/project/${projectId}?tab=records&view=git&sha=${sha}`
    }, { projectId: imported.id, sha: generatedDraft.sha })
    await expect(page.locator(`[id="git-${generatedDraft.sha}"]`)).toBeVisible({ timeout: 20_000 })
    await page.evaluate(({ projectId, recordId }) => {
      window.location.hash = `/project/${projectId}?tab=records&view=records&record=${recordId}`
    }, { projectId: imported.id, recordId: generatedDraft.id })
    await expect(page.locator(`[id="record-${generatedDraft.id}"]`)).toBeVisible({ timeout: 20_000 })

    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: '项目设置' }).click()
    const relinkProjectDir = await createRelinkFixture(tempRoot, fixture.projectDir)
    const relinkResult = await page.evaluate(async ({ projectId, selectedPath }) => (
      (window as any).vibe.projects.relink(projectId, selectedPath)
    ), { projectId: imported.id, selectedPath: relinkProjectDir }) as {
      assetWarnings: Array<{ kind: string; path: string }>
    }
    expect(relinkResult.assetWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cover', path: fixture.projectImagePath }),
    ]))
    await page.reload()
    await expect(page.getByRole('heading', { name: '图片仍引用重新关联前的仓库' })).toBeVisible()
    const projectProfileSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '项目资料' }) }).first()
    await projectProfileSection.getByRole('button', { name: '移除引用' }).click()
    await projectProfileSection.getByRole('button', { name: '保存', exact: true }).click()
    const remainingAssetWarning = page.locator('section[role="status"]').filter({
      has: page.getByRole('heading', { name: '图片仍引用重新关联前的仓库' }),
    })
    await expect(remainingAssetWarning).toBeVisible()
    await expect(remainingAssetWarning.getByText('项目封面', { exact: true })).toBeHidden()
    await expect(remainingAssetWarning.getByText('开发记录：E2E 手工 Git 归档', { exact: true })).toBeVisible()
    await remainingAssetWarning.getByRole('button', { name: '查看记录' }).click()
    const relinkedImageRecord = page.locator(`[id="record-${recordImageFixture.recordId}"]`)
    await expect(relinkedImageRecord).toBeVisible()
    await relinkedImageRecord.getByRole('button', { name: '删除截图 1' }).click()
    await page.getByRole('dialog', { name: '删除截图' }).getByRole('button', { name: '删除截图' }).click()
    await expect(relinkedImageRecord.getByText('截图 1 张', { exact: true })).toBeHidden()
    await page.locator('nav[aria-label="项目详情分区"]').getByRole('button', { name: '项目设置' }).click()
    await expect(page.getByRole('heading', { name: '图片仍引用重新关联前的仓库' })).toBeHidden()

    const relinkBackResult = await page.evaluate(async ({ projectId, selectedPath }) => (
      (window as any).vibe.projects.relink(projectId, selectedPath)
    ), { projectId: imported.id, selectedPath: fixture.projectDir }) as { syncError: string }
    expect(relinkBackResult.syncError).toBe('')
    await page.reload()
    await expect(page.getByRole('heading', { name: '项目资料' })).toBeVisible()
    const launchSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '启动配置' }) })
    await launchSection.getByLabel('名称').fill('E2E 启动')
    await launchSection.getByLabel('Executable').fill(process.execPath)
    await launchSection.getByLabel('参数（每行一个，按数组传递）').fill('-e\nsetInterval(() => console.log("e2e-running"), 100); setTimeout(() => process.exit(0), 15000)')
    await launchSection.getByLabel('工作目录').fill(fixture.projectDir)
    await launchSection.getByLabel('Ready URL（可选）').fill(`${provider.baseUrl}/models`)
    await launchSection.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('启动配置已保存').last()).toBeVisible()
    await launchSection.getByRole('button', { name: '启动', exact: true }).click()
    const confirmDialog = page.getByRole('dialog', { name: '确认首次启动' })
    await expect(confirmDialog).toContainText(process.execPath)
    await expect(confirmDialog).toContainText(fixture.projectDir)
    await confirmDialog.getByRole('button', { name: '确认并启动' }).click()
    await expect(launchSection.getByText('已就绪', { exact: true })).toBeVisible()
    await expect(launchSection.getByText('e2e-running', { exact: false }).first()).toBeVisible()
    const profileId = await page.evaluate(async projectId => {
      const profiles = await (window as any).vibe.launch.list(projectId)
      return profiles.find((profile: { name: string }) => profile.name === 'E2E 启动').id as string
    }, imported.id)
    await expect(launchSection.getByText('当前启动配置正在运行，请先停止再修改或删除。')).toBeVisible()
    await expect(launchSection.getByLabel('Executable')).toBeDisabled()
    await expect(launchSection.getByRole('button', { name: '保存' })).toBeDisabled()
    const runningSaveError = await page.evaluate(async ({ projectId, profileId: activeProfileId }) => {
      const profiles = await (window as any).vibe.launch.list(projectId)
      const profile = profiles.find((item: { id: string }) => item.id === activeProfileId)
      try {
        await (window as any).vibe.launch.save({
          id: profile.id,
          projectId: profile.projectId,
          name: '不应在运行中保存',
          executable: profile.executable,
          args: profile.args,
          cwd: profile.cwd,
          env: profile.env,
          readyUrl: profile.readyUrl,
          readyPort: profile.readyPort,
          enabled: profile.enabled,
        })
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, { projectId: imported.id, profileId })
    expect(runningSaveError).toContain('正在运行')
    const runningRelinkError = await page.evaluate(async ({ projectId, projectDir }) => {
      try {
        await (window as any).vibe.projects.relink(projectId, projectDir)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, { projectId: imported.id, projectDir: fixture.projectDir })
    expect(runningRelinkError).toContain('先停止')
    await launchSection.getByRole('button', { name: '停止', exact: true }).click()
    await expect(launchSection.getByText('已停止', { exact: true })).toBeVisible()
    const stoppedOpenError = await page.evaluate(async activeProfileId => {
      try {
        await (window as any).vibe.launch.open(activeProfileId)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, profileId)
    expect(stoppedOpenError).toContain('尚未达到可打开的就绪状态')

    await launchSection.getByRole('button', { name: '新增启动配置' }).click()
    await launchSection.getByLabel('名称').fill('E2E 备用启动')
    await launchSection.getByLabel('Executable').fill(process.execPath)
    await launchSection.getByLabel('参数（每行一个，按数组传递）').fill('-e\nsetInterval(() => {}, 1000)')
    await launchSection.getByLabel('工作目录').fill(fixture.projectDir)
    await launchSection.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('启动配置已保存').last()).toBeVisible()
    await launchSection.getByRole('button', { name: '启动', exact: true }).click()
    const backupConfirmDialog = page.getByRole('dialog', { name: '确认首次启动' })
    await backupConfirmDialog.getByRole('button', { name: '确认并启动' }).click()
    await expect(launchSection.getByText('运行中', { exact: true })).toBeVisible()
    await launchSection.getByRole('button', { name: '停止', exact: true }).click()
    await expect(launchSection.getByText('已停止', { exact: true })).toBeVisible()

    await launchSection.getByLabel('启动配置', { exact: true }).selectOption({ label: 'E2E 启动' })
    await expect(launchSection.getByLabel('名称')).toHaveValue('E2E 启动')
    await page.evaluate(async activeProfileId => (window as any).vibe.launch.start(activeProfileId), profileId)
    await expect(launchSection.getByText('已就绪', { exact: true })).toBeVisible()
    const runtimeProjectedProfileId = await page.evaluate(async projectId => {
      const projects = await (window as any).vibe.projects.list()
      return projects.find((item: { id: string }) => item.id === projectId).launchCapability.profileId as string
    }, imported.id)
    expect(runtimeProjectedProfileId).toBe(profileId)

    await page.reload()
    await expect(page.getByRole('link', { name: '项目' })).toBeVisible()

    await page.getByRole('link', { name: '项目' }).click()
    await expect(page).toHaveURL(/#\/projects$/)
    const projectCard = page.getByRole('article').filter({ hasText: 'E2E 本地项目' })
    await expect(projectCard.getByRole('button', { name: '打开项目', exact: true })).toBeVisible()
    await expect(projectCard.getByRole('button', { name: '停止项目' })).toBeVisible()
    await projectCard.getByRole('button', { name: '停止项目' }).click()
    const cardLaunch = projectCard.getByRole('button', { name: '启动项目' })
    await expect(cardLaunch).toBeVisible()
    await cardLaunch.click()
    await expect(page).toHaveURL(/#\/projects$/)
    await expect(projectCard.getByRole('button', { name: '停止项目' })).toBeVisible()
    await projectCard.getByRole('button', { name: '停止项目' }).click()

    await page.getByRole('button', { name: '导入本地项目' }).first().click()
    await page.getByRole('button', { name: '选择本地项目目录' }).click()
    await page.getByRole('radio', { name: '暂不配置' }).check()
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByText('导入失败').last()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '导入本地项目' })).toBeHidden()

    await projectCard.getByRole('button', { name: '打开项目 E2E 本地项目' }).click()
    await expect(page).toHaveURL(/#\/project\//)
    const detailHeader = page.locator('header').filter({ has: page.locator('h1').filter({ hasText: 'E2E 本地项目' }) })
    await detailHeader.getByRole('button', { name: '启动项目' }).click()
    await expect(detailHeader.getByRole('button', { name: '停止项目' })).toBeVisible()

    await fs.appendFile(path.join(fixture.projectDir, 'README.md'), '\n并发删除验证。\n')
    await runGit(fixture.projectDir, ['add', 'README.md'])
    await runGit(fixture.projectDir, ['commit', '-m', 'test: 验证生成与删除串行化'])
    const concurrentSha = await runGit(fixture.projectDir, ['rev-parse', 'HEAD'])
    await page.evaluate(async projectId => (window as any).vibe.git.sync(projectId), imported.id)
    const generationDuringDelete = page.evaluate(
      async ({ projectId, sha }) => (window as any).vibe.ai.generateDrafts(projectId, [sha]),
      { projectId: imported.id, sha: concurrentSha },
    ) as Promise<{ draftIds: string[] }>
    await expect.poll(() => provider.requests.length).toBe(4)
    await detailHeader.getByRole('button', { name: '更多项目操作' }).click()
    await page.getByRole('menuitem', { name: '删除项目' }).click()
    await page.getByRole('dialog', { name: '删除项目' }).getByRole('button', { name: '删除项目' }).evaluate(button => { button.click(); button.click() })
    await expect(page.getByText('从一个本地项目开始')).toBeVisible()
    expect((await generationDuringDelete).draftIds).toHaveLength(1)
    expect(provider.requests).toHaveLength(4)
    const runtimeAfterDelete = await page.evaluate(async id => (window as any).vibe.launch.status(id), profileId)
    expect(runtimeAfterDelete).toBeNull()
    expect(rendererErrors).toEqual([])
  } finally {
    await electronApp?.close().catch(() => undefined)
    await provider.close().catch(() => undefined)
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
