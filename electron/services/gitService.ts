import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 8 * 1024 * 1024
const GIT_TIMEOUT_MS = 20_000
const MAX_PACKAGE_JSON_BYTES = 2 * 1024 * 1024
const MAX_README_BYTES = 256 * 1024
const NUL = '\0'
const SHA_PATTERN = /^[0-9a-f]{40,64}$/i
export const DEFAULT_GIT_HISTORY_BATCH_SIZE = 500
const GIT_HISTORY_COMMAND_TIMEOUT_MS = 60_000

export interface GitCommitFact {
  sha: string
  parentShas: string[]
  authorName: string
  authorEmail: string
  authoredAt: number
  subject: string
  body: string
  fileNames: string[]
  stats: { added: number; deleted: number; files: number }
  disposition?: 'pending' | 'handled' | 'ignored'
  seenAt?: number | null
  activeRecord?: {
    recordId: string
    title: string
    source: 'manual' | 'ai'
    reviewStatus: 'draft' | 'accepted'
  } | null
}

export interface LaunchCandidate {
  name: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  readyUrl: string
  readyPort: number | null
  reason: string
}

export interface ProjectInspection {
  selectedPath: string
  canonicalPath: string
  isGitRepository: boolean
  gitAvailable: boolean
  repositoryRoot: string
  projectName: string
  branch: string
  headSha: string
  detached: boolean
  emptyRepository: boolean
  commitCount: number
  recentCommits: GitCommitFact[]
  remoteUrl: string
  techStack: string[]
  readmeSummary: string
  launchCandidates: LaunchCandidate[]
  assetCandidates: string[]
  warnings: string[]
}

export interface GitSyncResult {
  headSha: string
  branch: string
  detached: boolean
  remoteUrl: string
  commitCount: number
  commits: GitCommitFact[]
  cursorWasReset: boolean
  scanMode: 'full' | 'incremental' | 'unchanged'
}

export interface GitScanPlan extends Omit<GitSyncResult, 'commits'> {
  repositoryPath: string
  baseSha: string
  revisionArgs: string[]
  totalToScan: number
}

export interface GitCommitBatch {
  commits: GitCommitFact[]
  offset: number
  nextOffset: number
  total: number
  complete: boolean
}

export type GitRunner = (cwd: string, args: string[], timeoutMs?: number) => Promise<string>

export async function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS, signal?: AbortSignal) {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_GIT_OUTPUT,
      windowsHide: true,
      signal,
    })
    return result.stdout.trimEnd()
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean }
    if (candidate.name === 'AbortError') throw new Error('操作已取消')
    if (candidate.code === 'ENOENT') throw new Error('Git 命令不可用，请安装 Git 并确保其在 PATH 中')
    if (candidate.killed) throw new Error(`Git 命令超时（${timeoutMs}ms）`)
    const stderr = typeof candidate.stderr === 'string' ? candidate.stderr.trim() : ''
    throw new Error(stderr || candidate.message || 'Git 命令执行失败')
  }
}

function cleanText(value: string, max = 20_000) {
  return value.split('\0').join('').slice(0, max)
}

function stripGitRecordPadding(value: string) {
  if (value.startsWith('\r\n')) return value.slice(2)
  if (value.startsWith('\n')) return value.slice(1)
  return value
}

function parseNumstatToken(value: string) {
  const token = stripGitRecordPadding(value)
  const firstTab = token.indexOf('\t')
  const secondTab = firstTab < 0 ? -1 : token.indexOf('\t', firstTab + 1)
  if (firstTab < 1 || secondTab < 0) return null
  const addedText = token.slice(0, firstTab)
  const deletedText = token.slice(firstTab + 1, secondTab)
  if (!/^(?:\d+|-)$/.test(addedText) || !/^(?:\d+|-)$/.test(deletedText)) return null
  return {
    added: addedText === '-' ? 0 : Number(addedText),
    deleted: deletedText === '-' ? 0 : Number(deletedText),
    path: token.slice(secondTab + 1),
  }
}

/**
 * Parse `git log -z --numstat` output. NUL cannot appear in Git paths or commit
 * metadata, so tabs, newlines, and other control characters remain inert data.
 */
export function parseGitLog(output: string): GitCommitFact[] {
  if (!output) return []
  const tokens = output.split(NUL)
  const commits: GitCommitFact[] = []
  let index = 0

  while (index < tokens.length) {
    const sha = stripGitRecordPadding(tokens[index] || '')
    if (!sha && index === tokens.length - 1) break
    if (!SHA_PATTERN.test(sha) || index + 6 >= tokens.length) throw new Error('Git 日志格式不完整')

    const parents = tokens[index + 1] || ''
    const authorName = tokens[index + 2] || ''
    const authorEmail = tokens[index + 3] || ''
    const isoDate = tokens[index + 4] || ''
    const subject = tokens[index + 5] || ''
    const body = tokens[index + 6] || ''
    index += 7

    const parentShas = parents.trim() ? parents.trim().split(/\s+/) : []
    const authoredAt = Date.parse(isoDate)
    if (!Number.isFinite(authoredAt) || parentShas.some(parent => !SHA_PATTERN.test(parent))) {
      throw new Error('Git 日志包含无效提交数据')
    }

    let added = 0
    let deleted = 0
    let files = 0
    const fileNames: string[] = []
    while (index < tokens.length) {
      const token = tokens[index] || ''
      if (SHA_PATTERN.test(stripGitRecordPadding(token))) break
      if (!token && index === tokens.length - 1) {
        index += 1
        break
      }

      const stat = parseNumstatToken(token)
      if (!stat) throw new Error('Git numstat 格式不完整')
      index += 1
      added += stat.added
      deleted += stat.deleted
      files += 1

      // Rename/copy records put the old and new path in the next two NUL fields.
      let fileName = stat.path
      if (!fileName) {
        if (index + 1 >= tokens.length) throw new Error('Git rename numstat 格式不完整')
        index += 1 // Skip the old path; expose the current destination path.
        fileName = tokens[index] || ''
        index += 1
      }
      if (fileNames.length < 2_000 && fileName) fileNames.push(cleanText(fileName))
    }

    commits.push({
      sha,
      parentShas,
      authorName: cleanText(authorName, 500),
      authorEmail: cleanText(authorEmail, 500),
      authoredAt,
      subject: cleanText(subject, 2_000),
      body: cleanText(body),
      fileNames,
      stats: { added, deleted, files },
    })
  }
  return commits
}

async function gitLog(cwd: string, revisionArgs: string[], runner: GitRunner, limit?: number, skip = 0) {
  const format = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b'
  const raw = await runner(cwd, [
    'log', '-z', '--no-color', '--no-decorate', '--no-show-signature', '--encoding=UTF-8',
    ...(limit ? [`--max-count=${limit}`] : []), ...(skip ? [`--skip=${skip}`] : []),
    '--date=iso-strict', `--format=${format}`, '--numstat', ...revisionArgs,
  ], GIT_HISTORY_COMMAND_TIMEOUT_MS)
  return parseGitLog(raw)
}

export async function readGitCommitBatch(
  plan: GitScanPlan,
  offset: number,
  runner: GitRunner = runGit,
  limit = DEFAULT_GIT_HISTORY_BATCH_SIZE,
): Promise<GitCommitBatch> {
  const normalizedOffset = Math.max(0, Math.trunc(offset))
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.trunc(limit)))
  if (plan.scanMode === 'unchanged' || normalizedOffset >= plan.totalToScan) {
    return {
      commits: [],
      offset: normalizedOffset,
      nextOffset: Math.min(normalizedOffset, plan.totalToScan),
      total: plan.totalToScan,
      complete: true,
    }
  }
  const commits = await gitLog(plan.repositoryPath, plan.revisionArgs, runner, normalizedLimit, normalizedOffset)
  const nextOffset = normalizedOffset + commits.length
  return {
    commits,
    offset: normalizedOffset,
    nextOffset,
    total: plan.totalToScan,
    complete: nextOffset >= plan.totalToScan || commits.length < normalizedLimit,
  }
}

async function readTextFileBounded(filePath: string, maxBytes: number) {
  const file = await fs.open(filePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxBytes) return null
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

async function readPackageJson(root: string) {
  try {
    const content = await readTextFileBounded(path.join(root, 'package.json'), MAX_PACKAGE_JSON_BYTES)
    return content ? JSON.parse(content) as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function detectTechStack(root: string, packageJson: Record<string, unknown> | null) {
  const stack = new Set<string>()
  const dependencies = {
    ...((packageJson?.dependencies as Record<string, unknown> | undefined) || {}),
    ...((packageJson?.devDependencies as Record<string, unknown> | undefined) || {}),
  }
  const dependencyMap: Record<string, string> = {
    react: 'React', vue: 'Vue', svelte: 'Svelte', electron: 'Electron', next: 'Next.js', vite: 'Vite',
    typescript: 'TypeScript', tailwindcss: 'Tailwind CSS', express: 'Express', '@nestjs/core': 'NestJS',
  }
  for (const [dependency, label] of Object.entries(dependencyMap)) if (dependency in dependencies) stack.add(label)
  const markers: Array<[string, string]> = [
    ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['manage.py', 'Python'], ['main.py', 'Python'], ['app.py', 'Python'],
    ['Cargo.toml', 'Rust'], ['go.mod', 'Go'],
    ['pom.xml', 'Java'], ['build.gradle', 'Java'], ['Gemfile', 'Ruby'], ['Package.swift', 'Swift'],
  ]
  await Promise.all(markers.map(async ([file, label]) => {
    try { await fs.access(path.join(root, file)); stack.add(label) } catch { /* optional marker */ }
  }))
  try {
    const entries = await fs.readdir(root)
    if (entries.some(entry => /\.(?:csproj|sln)$/i.test(entry))) stack.add('.NET')
    if (entries.some(entry => /^deno(?:\.jsonc?)?$/i.test(entry))) stack.add('Deno')
  } catch { /* optional root markers */ }
  if (packageJson) stack.add('Node.js')
  return [...stack]
}

async function resolveNpmInvocation() {
  if (process.platform !== 'win32') return { executable: 'npm', prefixArgs: [] as string[] }
  try {
    const result = await execFileAsync('where.exe', ['npm.cmd'], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
    const npmCommand = result.stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean)
    if (npmCommand) {
      const directory = path.dirname(npmCommand)
      const nodeExecutable = path.join(directory, 'node.exe')
      const npmCli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      await Promise.all([fs.access(nodeExecutable), fs.access(npmCli)])
      return { executable: nodeExecutable, prefixArgs: [npmCli] }
    }
  } catch { /* candidate remains available but must be resolved when the profile is saved */ }
  return { executable: 'npm.cmd', prefixArgs: [] as string[] }
}

function inferredNodeReadiness(scriptName: string, command: string) {
  const explicitPort = command.match(/(?:--port(?:=|\s+)|\s-p\s+)(\d{1,5})(?:\s|$)/i)
  const parsedPort = explicitPort ? Number(explicitPort[1]) : 0
  let port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535 ? parsedPort : 0
  if (!port && /\bvite\b/i.test(command)) port = scriptName === 'preview' ? 4_173 : 5_173
  if (!port && /\bnext(?:\.js)?\b/i.test(command)) port = 3_000
  if (!port && /\breact-scripts\s+start\b/i.test(command)) port = 3_000
  if (!port && /\bastro\b/i.test(command)) port = 4_321
  return port ? { readyUrl: `http://127.0.0.1:${port}`, readyPort: port } : { readyUrl: '', readyPort: null }
}

function candidate(input: Omit<LaunchCandidate, 'cwd' | 'env'> & { cwd?: string; env?: Record<string, string> }, root: string): LaunchCandidate {
  return { cwd: input.cwd || root, env: input.env || {}, ...input }
}

async function rootFileNames(root: string) {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

export async function discoverLaunchCandidates(root: string, packageJson: Record<string, unknown> | null): Promise<LaunchCandidate[]> {
  const candidates: LaunchCandidate[] = []
  if (packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts) {
    const scripts = packageJson.scripts as Record<string, unknown>
    const preferred = ['dev', 'start', 'preview', 'serve']
    const npm = await resolveNpmInvocation()
    for (const name of preferred) {
      const command = scripts[name]
      if (typeof command !== 'string') continue
      const readiness = inferredNodeReadiness(name, command)
      candidates.push(candidate({
        name: `npm run ${name}`,
        executable: npm.executable,
        args: [...npm.prefixArgs, 'run', name],
        ...readiness,
        reason: `package.json 定义了 ${name} 脚本（仅推荐，不会自动执行）`,
      }, root))
    }
  }

  const files = await rootFileNames(root)
  const fileSet = new Set(files.map(file => file.toLowerCase()))
  const hasFile = (name: string) => fileSet.has(name.toLowerCase())

  if (hasFile('manage.py')) {
    candidates.push(candidate({
      name: 'Django 开发服务器', executable: 'python', args: ['manage.py', 'runserver'],
      readyUrl: 'http://127.0.0.1:8000', readyPort: 8_000,
      reason: '检测到 manage.py（仅推荐，不会自动执行）',
    }, root))
  } else {
    const pythonEntry = files.find(file => /^(?:main|app)\.py$/i.test(file))
    if (pythonEntry) {
      const source = await readTextFileBounded(path.join(root, pythonEntry), MAX_README_BYTES).catch(() => null)
      const moduleName = path.basename(pythonEntry, path.extname(pythonEntry))
      const fastApiApp = source?.match(/\b([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/)?.[1]
      const flaskApp = source?.match(/\b([A-Za-z_]\w*)\s*=\s*Flask\s*\(/)?.[1]
      if (fastApiApp) {
        candidates.push(candidate({
          name: 'FastAPI 开发服务器', executable: 'python',
          args: ['-m', 'uvicorn', `${moduleName}:${fastApiApp}`, '--reload'],
          readyUrl: 'http://127.0.0.1:8000', readyPort: 8_000,
          reason: `检测到 ${pythonEntry} 中的 FastAPI 应用（仅推荐，不会自动执行）`,
        }, root))
      } else if (flaskApp) {
        candidates.push(candidate({
          name: 'Flask 开发服务器', executable: 'python',
          args: ['-m', 'flask', '--app', `${moduleName}:${flaskApp}`, 'run'],
          readyUrl: 'http://127.0.0.1:5000', readyPort: 5_000,
          reason: `检测到 ${pythonEntry} 中的 Flask 应用（仅推荐，不会自动执行）`,
        }, root))
      } else {
        candidates.push(candidate({
          name: `运行 ${pythonEntry}`, executable: 'python', args: [pythonEntry],
          readyUrl: '', readyPort: null,
          reason: `检测到 Python 入口文件 ${pythonEntry}（仅推荐，不会自动执行）`,
        }, root))
      }
    }
  }

  if (hasFile('Cargo.toml')) {
    candidates.push(candidate({
      name: 'cargo run', executable: 'cargo', args: ['run'], readyUrl: '', readyPort: null,
      reason: '检测到 Cargo.toml（仅推荐，不会自动执行）',
    }, root))
  }
  if (hasFile('go.mod')) {
    candidates.push(candidate({
      name: 'go run .', executable: 'go', args: ['run', '.'], readyUrl: '', readyPort: null,
      reason: '检测到 go.mod（仅推荐，不会自动执行）',
    }, root))
  }
  const dotnetProject = files.find(file => /\.csproj$/i.test(file))
  if (dotnetProject) {
    candidates.push(candidate({
      name: `dotnet run ${dotnetProject}`, executable: 'dotnet', args: ['run', '--project', dotnetProject],
      readyUrl: '', readyPort: null,
      reason: `检测到 ${dotnetProject}（仅推荐，不会自动执行）`,
    }, root))
  }
  if (hasFile('Package.swift')) {
    candidates.push(candidate({
      name: 'swift run', executable: 'swift', args: ['run'], readyUrl: '', readyPort: null,
      reason: '检测到 Package.swift（仅推荐，不会自动执行）',
    }, root))
  }

  const unique = new Map<string, LaunchCandidate>()
  for (const item of candidates) {
    const key = JSON.stringify([item.executable, item.args, item.cwd])
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()].slice(0, 12)
}

export async function findProjectAssetCandidates(root: string) {
  const results: string[] = []
  const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'])
  const imagePattern = /\.(?:png|jpe?g|webp|gif)$/i
  async function walk(directory: string, depth: number) {
    if (depth > 4 || results.length >= 20) return
    let handle: Awaited<ReturnType<typeof fs.opendir>> | null = null
    try {
      handle = await fs.opendir(directory)
      for await (const entry of handle) {
        if (results.length >= 20) break
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory() && !excluded.has(entry.name)) await walk(fullPath, depth + 1)
        else if (entry.isFile() && imagePattern.test(entry.name) && /(?:screen|cover|hero|demo|preview|shot|docs?|assets?)/i.test(fullPath)) results.push(fullPath)
      }
    } catch {
      return
    } finally {
      if (handle) await handle.close().catch(() => undefined)
    }
  }
  await walk(root, 0)
  return results
}

export function extractReadmeSummary(content: string, maxLength = 700) {
  const blocks = cleanText(content, MAX_README_BYTES)
    .replace(/<!--.*?-->/gs, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n\s*\r?\n/)
  const paragraphs: string[] = []

  for (const block of blocks) {
    const rawLines = block.split(/\r?\n/)
    const listOrTableLines = rawLines.filter(line => /^\s*(?:[-+*]\s+|\d+[.)]\s+|\|.*\|\s*$)/.test(line)).length
    if (listOrTableLines > rawLines.length / 2) continue
    const paragraph = rawLines
      .filter(line => !/^\s{0,3}#{1,6}(?:\s+|$)/.test(line))
      .filter(line => !/^\s*(?:[-*_]\s*){3,}$/.test(line))
      .join(' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*>+\s?/gm, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/[*_~`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (paragraph.length < 24) continue
    if (/img\.shields\.io|English Version|简体中文|table of contents/i.test(block)) continue
    if (!/[\p{L}\p{N}]/u.test(paragraph)) continue
    paragraphs.push(paragraph)
    if (paragraphs.length >= 2 || paragraphs.join(' ').length >= maxLength) break
  }

  return cleanText(paragraphs.join(' '), maxLength).trim()
}

async function readReadme(root: string) {
  let entries: string[] = []
  try { entries = await fs.readdir(root) } catch { return '' }
  const readme = entries.find(entry => /^readme(?:\.[^.]+)?$/i.test(entry))
  if (!readme) return ''
  try {
    const content = await readTextFileBounded(path.join(root, readme), MAX_README_BYTES)
    if (!content) return ''
    return extractReadmeSummary(content)
  } catch {
    return ''
  }
}

function isNotGitRepositoryError(message: string) {
  return /not a git repository|不是(?:一个)?\s*git\s*仓库|非\s*git\s*仓库/i.test(message)
}

async function canonicalDirectory(selectedPath: string) {
  const resolved = path.resolve(selectedPath)
  const stat = await fs.stat(resolved).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('选择的路径不存在或不是目录')
  return fs.realpath(resolved)
}

export async function inspectProjectDirectory(selectedPath: string, runner: GitRunner = runGit): Promise<ProjectInspection> {
  const canonicalPath = await canonicalDirectory(selectedPath)
  const warnings: string[] = []
  let gitAvailable = true
  let repositoryRoot = canonicalPath
  let isGitRepository = false
  try {
    repositoryRoot = (await runner(canonicalPath, ['rev-parse', '--show-toplevel'])).trim()
    isGitRepository = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    gitAvailable = !/Git 命令不可用/.test(message)
    if (!gitAvailable) {
      warnings.push(message)
    } else if (isNotGitRepositoryError(message)) {
      warnings.push('所选目录不是 Git 仓库，仍可作为空项目导入。')
    } else {
      throw new Error(`无法检查 Git 仓库：${message}`)
    }
  }

  const root = isGitRepository ? await canonicalDirectory(repositoryRoot) : canonicalPath
  const packageJson = await readPackageJson(root)
  const [techStack, readmeSummary, assetCandidates] = await Promise.all([
    detectTechStack(root, packageJson), readReadme(root), findProjectAssetCandidates(root),
  ])
  const launchCandidates = await discoverLaunchCandidates(root, packageJson)
  let headSha = ''
  let branch = ''
  let remoteUrl = ''
  let commitCount = 0
  let recentCommits: GitCommitFact[] = []
  let detached = false
  if (isGitRepository) {
    try { headSha = (await runner(root, ['rev-parse', 'HEAD'])).trim() } catch { warnings.push('仓库还没有提交。') }
    try { branch = (await runner(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() } catch { /* detached or unborn */ }
    if (headSha) {
      detached = !branch
      if (detached) branch = 'DETACHED'
      commitCount = Number(await runner(root, ['rev-list', '--count', 'HEAD'])) || 0
      recentCommits = await gitLog(root, ['HEAD'], runner, 8)
    }
    try { remoteUrl = (await runner(root, ['config', '--get', 'remote.origin.url'])).trim() } catch { /* optional remote */ }
  }
  return {
    selectedPath: path.resolve(selectedPath), canonicalPath: root, isGitRepository, gitAvailable,
    repositoryRoot: root, projectName: path.basename(root), branch, headSha, detached,
    emptyRepository: isGitRepository && !headSha, commitCount, recentCommits, remoteUrl,
    techStack, readmeSummary, launchCandidates,
    assetCandidates, warnings,
  }
}

export async function prepareGitScan(
  repositoryPath: string,
  lastSyncedSha: string,
  runner: GitRunner = runGit,
): Promise<GitScanPlan> {
  const root = await canonicalDirectory(repositoryPath)
  const insideWorkTree = (await runner(root, ['rev-parse', '--is-inside-work-tree'])).trim()
  if (insideWorkTree !== 'true') throw new Error('项目路径不是 Git 工作区')
  let headSha = ''
  try { headSha = (await runner(root, ['rev-parse', '--verify', 'HEAD'])).trim() } catch { /* empty repository */ }
  let branch = ''
  try { branch = (await runner(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() } catch { /* detached */ }
  let remoteUrl = ''
  try { remoteUrl = (await runner(root, ['config', '--get', 'remote.origin.url'])).trim() } catch { /* optional */ }
  if (!headSha) {
    return {
      headSha: '', branch: branch || '', detached: false, remoteUrl, commitCount: 0,
      cursorWasReset: Boolean(lastSyncedSha), scanMode: 'full', repositoryPath: root,
      baseSha: lastSyncedSha, revisionArgs: [], totalToScan: 0,
    }
  }
  // Everything below is pinned to this immutable object id. Using symbolic HEAD with
  // --skip across batches can otherwise mix two histories when the branch changes.
  const commitCount = Number(await runner(root, ['rev-list', '--count', headSha])) || 0
  let cursorWasReset = false
  let scanMode: GitSyncResult['scanMode'] = 'full'
  let revisionArgs = [headSha]
  if (lastSyncedSha === headSha) {
    scanMode = 'unchanged'
  } else if (lastSyncedSha) {
    try {
      await runner(root, ['merge-base', '--is-ancestor', lastSyncedSha, headSha])
      revisionArgs = [`${lastSyncedSha}..${headSha}`]
      scanMode = 'incremental'
    } catch {
      cursorWasReset = true
    }
  }
  const totalToScan = scanMode === 'unchanged'
    ? 0
    : scanMode === 'full'
      ? commitCount
      : Number(await runner(root, ['rev-list', '--count', ...revisionArgs], GIT_HISTORY_COMMAND_TIMEOUT_MS)) || 0
  return {
    headSha, branch: branch || 'DETACHED', detached: !branch, remoteUrl, commitCount,
    cursorWasReset, scanMode, repositoryPath: root, baseSha: lastSyncedSha,
    revisionArgs, totalToScan,
  }
}

export async function scanGitIncrementally(
  repositoryPath: string,
  lastSyncedSha: string,
  runner: GitRunner = runGit,
): Promise<GitSyncResult> {
  const plan = await prepareGitScan(repositoryPath, lastSyncedSha, runner)
  if (plan.scanMode === 'unchanged' || plan.totalToScan === 0) {
    return {
      headSha: plan.headSha,
      branch: plan.branch,
      detached: plan.detached,
      remoteUrl: plan.remoteUrl,
      commitCount: plan.commitCount,
      commits: [],
      cursorWasReset: plan.cursorWasReset,
      scanMode: plan.scanMode,
    }
  }
  const commits: GitCommitFact[] = []
  let offset = 0
  while (offset < plan.totalToScan) {
    const batch = await readGitCommitBatch(plan, offset, runner)
    commits.push(...batch.commits)
    if (batch.nextOffset <= offset) throw new Error('Git 历史扫描没有继续推进')
    offset = batch.nextOffset
    if (batch.complete) break
  }
  return {
    headSha: plan.headSha,
    branch: plan.branch,
    detached: plan.detached,
    remoteUrl: plan.remoteUrl,
    commitCount: plan.commitCount,
    commits: commits.reverse(),
    cursorWasReset: plan.cursorWasReset,
    scanMode: plan.scanMode,
  }
}
