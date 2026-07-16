import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { discoverLaunchCandidates, extractReadmeSummary, inspectProjectDirectory, parseGitLog, scanGitIncrementally } from '../electron/services/gitService.ts'

function git(directory: string, args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}

test('Git inspection parses facts and incremental scans return only new commits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-scan-'))
  try {
    git(directory, ['init'])
    git(directory, ['config', 'user.name', 'Vibe Test'])
    git(directory, ['config', 'user.email', 'vibe@example.com'])
    const emptyInspection = await inspectProjectDirectory(directory)
    assert.equal(emptyInspection.emptyRepository, true)
    const emptySync = await scanGitIncrementally(directory, '')
    assert.equal(emptySync.commits.length, 0)
    assert.equal(emptySync.headSha, '')
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { react: '18' }, devDependencies: { typescript: '5', vite: '5' } }))
    fs.writeFileSync(path.join(directory, 'README.md'), '# Scan Fixture\nA local project hub fixture.')
    git(directory, ['add', 'package.json', 'README.md'])
    git(directory, ['commit', '-m', 'feat: initial fixture'])

    const inspection = await inspectProjectDirectory(directory)
    assert.equal(inspection.isGitRepository, true)
    assert.equal(inspection.commitCount, 1)
    assert.equal(inspection.recentCommits[0].subject, 'feat: initial fixture')
    assert.deepEqual(inspection.recentCommits[0].fileNames.sort(), ['README.md', 'package.json'])
    assert.ok(inspection.techStack.includes('React'))
    assert.equal(inspection.readmeSummary, 'A local project hub fixture.')
    assert.ok(inspection.launchCandidates.some(candidate => candidate.args.slice(-2).join(' ') === 'run dev'))
    const viteCandidate = inspection.launchCandidates.find(candidate => candidate.args.slice(-2).join(' ') === 'run dev')
    assert.equal(viteCandidate?.readyUrl, 'http://127.0.0.1:5173')
    assert.equal(viteCandidate?.readyPort, 5173)

    const first = await scanGitIncrementally(directory, '')
    assert.equal(first.commits.length, 1)
    assert.equal(first.scanMode, 'full')
    const cursor = first.headSha
    const unchanged = await scanGitIncrementally(directory, cursor)
    assert.equal(unchanged.commits.length, 0)
    assert.equal(unchanged.scanMode, 'unchanged')

    fs.writeFileSync(path.join(directory, 'src.txt'), 'next')
    git(directory, ['add', 'src.txt'])
    git(directory, ['commit', '-m', 'fix: next change'])
    const incremental = await scanGitIncrementally(directory, cursor)
    assert.equal(incremental.commits.length, 1)
    assert.equal(incremental.scanMode, 'incremental')
    assert.equal(incremental.commits[0].subject, 'fix: next change')

    git(directory, ['mv', 'src.txt', 'renamed.txt'])
    git(directory, ['commit', '-m', 'refactor: rename tracked file'])
    const renamed = await scanGitIncrementally(directory, incremental.headSha)
    assert.equal(renamed.commits.length, 1)
    assert.deepEqual(renamed.commits[0].fileNames, ['renamed.txt'])
    assert.equal(renamed.commits[0].stats.files, 1)

    git(directory, ['commit', '--allow-empty', '-m', 'chore: empty marker'])
    const empty = await scanGitIncrementally(directory, renamed.headSha)
    assert.equal(empty.commits.length, 1)
    assert.deepEqual(empty.commits[0].fileNames, [])
    assert.deepEqual(empty.commits[0].stats, { added: 0, deleted: 0, files: 0 })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('README summaries prefer prose and remove banners, HTML, badges, and navigation links', () => {
  const summary = extractReadmeSummary(`# VoiceOps (AI Voice Service Demo) 🎙️

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**一个面向桌面端的多厂商 TTS 音色测试、语气控制与语音生成工作台。**

[🇺🇸 English Version](README_en.md) | **🇨🇳 简体中文**

</div>

---

## 项目定位

VoiceOps 是一个基于 **.NET 8 + WPF + BlazorWebView** 构建的本地桌面端 TTS 工具。它帮助开发者在同一个界面完成多厂商配置与语音生成验证。
`)
  assert.match(summary, /^一个面向桌面端的多厂商 TTS/)
  assert.match(summary, /VoiceOps 是一个基于 \.NET 8 \+ WPF \+ BlazorWebView/)
  assert.doesNotMatch(summary, /<div|img\.shields|https?:|English Version|简体中文/)
  assert.ok(summary.length <= 700)
})

test('launch discovery recommends structured commands for common non-Node project types', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-launch-candidates-'))
  const fastApiDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-fastapi-candidate-'))
  try {
    fs.writeFileSync(path.join(directory, 'manage.py'), '# Django entry\n')
    fs.writeFileSync(path.join(directory, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n')
    fs.writeFileSync(path.join(directory, 'go.mod'), 'module example.com/fixture\n\ngo 1.23\n')
    fs.writeFileSync(path.join(directory, 'Fixture.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n')
    fs.writeFileSync(path.join(directory, 'Package.swift'), '// swift-tools-version: 6.0\n')

    const inspection = await inspectProjectDirectory(directory)
    assert.ok(inspection.techStack.includes('Python'))
    assert.ok(inspection.techStack.includes('Rust'))
    assert.ok(inspection.techStack.includes('Go'))
    assert.ok(inspection.techStack.includes('.NET'))
    assert.ok(inspection.techStack.includes('Swift'))

    const commands = inspection.launchCandidates.map(item => [item.executable, ...item.args].join(' '))
    assert.ok(commands.includes('python manage.py runserver'))
    assert.ok(commands.includes('cargo run'))
    assert.ok(commands.includes('go run .'))
    assert.ok(commands.includes('dotnet run --project Fixture.csproj'))
    assert.ok(commands.includes('swift run'))
    assert.ok(inspection.launchCandidates.every(item => Array.isArray(item.args) && item.cwd === inspection.canonicalPath))
    assert.ok(inspection.launchCandidates.every(item => /仅推荐，不会自动执行/.test(item.reason)))

    fs.writeFileSync(path.join(fastApiDirectory, 'main.py'), 'from fastapi import FastAPI\napi = FastAPI()\n')
    const fastApi = await discoverLaunchCandidates(fastApiDirectory, null)
    assert.deepEqual(fastApi[0], {
      name: 'FastAPI 开发服务器',
      executable: 'python',
      args: ['-m', 'uvicorn', 'main:api', '--reload'],
      cwd: fastApiDirectory,
      env: {},
      readyUrl: 'http://127.0.0.1:8000',
      readyPort: 8000,
      reason: '检测到 main.py 中的 FastAPI 应用（仅推荐，不会自动执行）',
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
    fs.rmSync(fastApiDirectory, { recursive: true, force: true })
  }
})

test('project inspection distinguishes non-Git directories from Git execution failures', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-inspect-errors-'))
  try {
    const nonGit = await inspectProjectDirectory(directory, async () => {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    })
    assert.equal(nonGit.isGitRepository, false)
    assert.equal(nonGit.gitAvailable, true)
    assert.match(nonGit.warnings.join('\n'), /不是 Git 仓库/)

    const unavailable = await inspectProjectDirectory(directory, async () => {
      throw new Error('Git 命令不可用，请安装 Git 并确保其在 PATH 中')
    })
    assert.equal(unavailable.isGitRepository, false)
    assert.equal(unavailable.gitAvailable, false)
    assert.match(unavailable.warnings.join('\n'), /Git 命令不可用/)

    await assert.rejects(
      () => inspectProjectDirectory(directory, async () => {
        throw new Error("fatal: detected dubious ownership in repository at 'C:/repo'")
      }),
      /无法检查 Git 仓库.*dubious ownership/,
    )
    await assert.rejects(
      () => inspectProjectDirectory(directory, async () => {
        throw new Error('Git 命令超时（20000ms）')
      }),
      /无法检查 Git 仓库.*超时/,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('NUL framed Git logs preserve control characters and special file names', () => {
  const oldRecordSeparator = '\u001e'
  const oldFieldSeparator = '\u001f'
  const firstSha = 'a'.repeat(40)
  const secondSha = 'b'.repeat(40)
  const thirdSha = 'c'.repeat(40)
  const renamedPath = `src/new${oldRecordSeparator}\tname\ncomponent.ts`
  const output = [
    firstSha, '', `Dev${oldFieldSeparator} Name`, 'dev@example.com', '2026-07-16T00:00:00.000Z',
    `subject${oldRecordSeparator}${oldFieldSeparator}`, `body line 1\nbody${oldRecordSeparator}${oldFieldSeparator}`,
    `\n3\t2\tsrc/file\twith\ncontrols.ts`,
    '1\t0\t', `src/old${oldFieldSeparator}.ts`, renamedPath,
    secondSha, firstSha, 'Next Dev', 'next@example.com', '2026-07-16T00:01:00.000Z',
    'empty change', '',
    thirdSha, secondSha, 'Final Dev', 'final@example.com', '2026-07-16T00:02:00.000Z',
    'after empty commit', '', '\n-\t-\tassets/binary.dat',
    '',
  ].join('\0')

  const commits = parseGitLog(output)
  assert.equal(commits.length, 3)
  assert.equal(commits[0].subject, `subject${oldRecordSeparator}${oldFieldSeparator}`)
  assert.equal(commits[0].body, `body line 1\nbody${oldRecordSeparator}${oldFieldSeparator}`)
  assert.deepEqual(commits[0].fileNames, ['src/file\twith\ncontrols.ts', renamedPath])
  assert.deepEqual(commits[0].stats, { added: 4, deleted: 2, files: 2 })
  assert.equal(commits[1].sha, secondSha)
  assert.deepEqual(commits[1].fileNames, [])
  assert.deepEqual(commits[1].stats, { added: 0, deleted: 0, files: 0 })
  assert.equal(commits[2].sha, thirdSha)
  assert.deepEqual(commits[2].fileNames, ['assets/binary.dat'])
  assert.deepEqual(commits[2].stats, { added: 0, deleted: 0, files: 1 })
})

test('initial Git scans read history in batches without dropping commits past 500', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-batch-'))
  const commits = Array.from({ length: 501 }, (_, index) => {
    const sha = index.toString(16).padStart(40, '0')
    const parent = index ? (index - 1).toString(16).padStart(40, '0') : ''
    const date = new Date(1_700_000_000_000 + index * 1000).toISOString()
    return { sha, parent, date, subject: `commit-${index}` }
  })
  let logCalls = 0
  let simulatedHead = commits.at(-1)!.sha
  const runner = async (_cwd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true'
    if (args[0] === 'rev-parse' && args[1] === '--verify') return simulatedHead
    if (args[0] === 'symbolic-ref') return 'main'
    if (args[0] === 'config') return ''
    if (args[0] === 'rev-list') {
      assert.equal(args.at(-1), commits.at(-1)!.sha)
      return String(commits.length)
    }
    if (args[0] === 'log') {
      logCalls += 1
      // Simulate a branch update after the first page. Every subsequent page must
      // still use the object id captured at scan start, never symbolic HEAD.
      assert.equal(args.at(-1), commits.at(-1)!.sha)
      simulatedHead = 'f'.repeat(40)
      const max = Number(args.find(arg => arg.startsWith('--max-count='))?.split('=')[1] || commits.length)
      const skip = Number(args.find(arg => arg.startsWith('--skip='))?.split('=')[1] || 0)
      return [...commits].reverse().slice(skip, skip + max).flatMap(commit => ([
        commit.sha, commit.parent, 'Dev', 'dev@example.com', commit.date, commit.subject, '',
      ])).concat('').join('\0')
    }
    throw new Error(`unexpected Git args: ${args.join(' ')}`)
  }
  try {
    const result = await scanGitIncrementally(directory, '', runner)
    assert.equal(result.commits.length, 501)
    assert.equal(result.commits[0].subject, 'commit-0')
    assert.equal(result.commits.at(-1)?.subject, 'commit-500')
    assert.equal(result.headSha, commits.at(-1)!.sha)
    assert.equal(result.scanMode, 'full')
    assert.equal(logCalls, 2)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('switching to a divergent branch resets the cursor and returns only the new reachable history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-rewrite-'))
  try {
    git(directory, ['init'])
    git(directory, ['config', 'user.name', 'Vibe Test'])
    git(directory, ['config', 'user.email', 'vibe@example.com'])
    fs.writeFileSync(path.join(directory, 'history.txt'), 'base')
    git(directory, ['add', 'history.txt'])
    git(directory, ['commit', '-m', 'base'])
    const baseSha = git(directory, ['rev-parse', 'HEAD'])
    git(directory, ['checkout', '-b', 'old-line'])
    fs.writeFileSync(path.join(directory, 'history.txt'), 'old')
    git(directory, ['commit', '-am', 'old branch commit'])
    const oldHead = git(directory, ['rev-parse', 'HEAD'])

    git(directory, ['checkout', '-b', 'rewritten-line', baseSha])
    fs.writeFileSync(path.join(directory, 'history.txt'), 'rewritten')
    git(directory, ['commit', '-am', 'replacement commit'])
    const newHead = git(directory, ['rev-parse', 'HEAD'])

    const result = await scanGitIncrementally(directory, oldHead)
    assert.equal(result.cursorWasReset, true)
    assert.equal(result.scanMode, 'full')
    assert.equal(result.headSha, newHead)
    assert.deepEqual(result.commits.map(commit => commit.subject), ['base', 'replacement commit'])
    assert.equal(result.commits.some(commit => commit.sha === oldHead), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
