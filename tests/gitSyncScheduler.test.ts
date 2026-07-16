import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'
import type { GitCommitBatch, GitScanPlan, GitSyncResult } from '../electron/services/gitService.ts'
import {
  GitSyncCoordinator,
  GitSyncScheduler,
  listDueGitSyncProjects,
  recoverInterruptedGitSyncs,
} from '../electron/services/gitSyncScheduler.ts'

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-scheduler-'))
  const dbPath = path.join(directory, 'test.db')
  const db = new DatabaseSync(dbPath)
  migrateDatabase(db, { dbPath })
  return { directory, db }
}

function git(directory: string, args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}

function insertProject(db: DatabaseSync, id: string, status = 'never', options: {
  path?: string
  canonicalPath?: string | null
  lastScannedAt?: number | null
  failureCount?: number
  nextRetryAt?: number | null
  error?: string
  historyLimit?: number
} = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, path, canonicalPath, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 1, 1)
  `).run(id, id, options.path ?? `/repos/${id}`, options.canonicalPath ?? null)
  db.prepare(`
    INSERT INTO git_sync_state (
      projectId, status, error, lastScannedAt, failureCount, nextRetryAt, historyLimit
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, status, options.error || '', options.lastScannedAt ?? null,
    options.failureCount || 0, options.nextRetryAt ?? null, options.historyLimit || 0,
  )
}

function syncFixture(): GitSyncResult {
  return {
    headSha: 'a'.repeat(40), branch: 'main', detached: false, remoteUrl: '', commitCount: 1,
    cursorWasReset: false, scanMode: 'full',
    commits: [{
      sha: 'a'.repeat(40), parentShas: [], authorName: 'Dev', authorEmail: '', authoredAt: 1,
      subject: 'scheduled', body: '', fileNames: ['README.md'], stats: { added: 1, deleted: 0, files: 1 },
    }],
  }
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error('condition was not reached')
}

test('due Git scheduling selects never, stale, and retryable projects only', () => {
  const { directory, db } = setup()
  const now = 1_000_000
  try {
    insertProject(db, 'never', 'never', { canonicalPath: '', path: '/legacy/never' })
    insertProject(db, 'stale', 'synced', { lastScannedAt: now - 300_000 })
    insertProject(db, 'fresh', 'synced', { lastScannedAt: now - 1_000 })
    insertProject(db, 'retry-due', 'failed', { nextRetryAt: now })
    insertProject(db, 'retry-later', 'failed', { nextRetryAt: now + 1 })
    insertProject(db, 'unavailable', 'unavailable')
    insertProject(db, 'syncing', 'syncing')

    const due = listDueGitSyncProjects(db, now, 300_000).map(project => project.projectId)
    assert.deepEqual(new Set(due), new Set(['never', 'stale', 'retry-due']))
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduled and manual requests share one scan and observer failures cannot corrupt success', async () => {
  const { directory, db } = setup()
  try {
    insertProject(db, 'project-1')
    let scans = 0
    let release = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const coordinator = new GitSyncCoordinator(db, {
      scan: async () => {
        scans += 1
        await gate
        return syncFixture()
      },
      onState: () => { throw new Error('renderer is unavailable') },
    })
    const scheduled = coordinator.sync('project-1', { reason: 'scheduled' })
    const manual = coordinator.sync('project-1', { reason: 'manual' })
    assert.equal(scheduled, manual)
    await waitFor(() => scans === 1)
    release()
    const result = await manual
    assert.equal(result.inserted, 1)
    assert.equal(scans, 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, failureCount, nextRetryAt FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, { status: 'synced', failureCount: 0, nextRetryAt: null })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('cancelling a Git sync restores its previous state without adding a failure', async () => {
  const { directory, db } = setup()
  try {
    insertProject(db, 'project-1', 'failed', {
      lastScannedAt: 100, failureCount: 3, nextRetryAt: 999, error: 'previous failure',
    })
    const controller = new AbortController()
    const coordinator = new GitSyncCoordinator(db, {
      run: (_cwd, _args, _timeout, signal) => new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
      scan: async (_path, _cursor, runner) => {
        await runner('/repo', ['status'])
        return syncFixture()
      },
    })
    const operation = coordinator.sync('project-1', { signal: controller.signal })
    await waitFor(() => (db.prepare(`
      SELECT status FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as { status: string }).status === 'syncing')
    controller.abort()
    await assert.rejects(operation, /操作已取消/)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, error, lastScannedAt, failureCount, nextRetryAt
      FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, {
      status: 'failed', error: 'previous failure', lastScannedAt: 100, failureCount: 3, nextRetryAt: 999,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('cancelled Git history backfill resumes from its persisted batch and reports real progress', async () => {
  const { directory, db } = setup()
  try {
    insertProject(db, 'project-1')
    const plan: GitScanPlan = {
      repositoryPath: '/repos/project-1',
      headSha: 'c'.repeat(40),
      baseSha: '',
      branch: 'main',
      detached: false,
      remoteUrl: '',
      commitCount: 3,
      cursorWasReset: false,
      scanMode: 'full',
      revisionArgs: ['c'.repeat(40)],
      totalToScan: 3,
    }
    const commits = ['c', 'b', 'a'].map((prefix, index) => ({
      ...syncFixture().commits[0],
      sha: prefix.repeat(40),
      authoredAt: 3 - index,
      subject: prefix,
    }))
    const readBatch = async (_plan: GitScanPlan, offset: number): Promise<GitCommitBatch> => {
      const items = offset === 0 ? commits.slice(0, 2) : commits.slice(2)
      return {
        commits: items,
        offset,
        nextOffset: offset + items.length,
        total: 3,
        complete: offset + items.length >= 3,
      }
    }
    const controller = new AbortController()
    const firstProgress: number[] = []
    const firstCoordinator = new GitSyncCoordinator(db, {
      prepare: async () => plan,
      readBatch,
      batchSize: 2,
    })
    const first = firstCoordinator.sync('project-1', {
      signal: controller.signal,
      onProgress: state => {
        if (state.status === 'syncing' && state.processed !== undefined) firstProgress.push(state.processed)
        if (state.processed === 2) controller.abort()
      },
    })
    await assert.rejects(first, /操作已取消/)
    assert.equal(firstProgress.includes(2), true)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, failureCount, backfillOffset, backfillTotal,
        CASE WHEN backfillGeneration = '' THEN 0 ELSE 1 END AS resumable
      FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, {
      status: 'never', failureCount: 0, backfillOffset: 2, backfillTotal: 3, resumable: 1,
    })
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE reachable = 1').get() as { count: number }).count, 0)

    const resumedProgress: Array<{ processed?: number; progress?: number; resumed?: boolean }> = []
    const resumedCoordinator = new GitSyncCoordinator(db, {
      prepare: async () => plan,
      readBatch,
      batchSize: 2,
    })
    const result = await resumedCoordinator.sync('project-1', {
      onProgress: state => {
        if (state.status === 'syncing') resumedProgress.push(state)
      },
    })
    assert.equal(result.inserted, 3)
    assert.equal(result.scanned, 3)
    assert.equal(resumedProgress.some(state => state.processed === 2 && state.progress === 66 && state.resumed), true)
    assert.equal(resumedProgress.some(state => state.processed === 3 && state.progress === 100), true)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE reachable = 1').get() as { count: number }).count, 3)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('default Git coordinator persists a real repository in bounded batches', async () => {
  const { directory, db } = setup()
  const repository = path.join(directory, 'repository')
  fs.mkdirSync(repository)
  try {
    git(repository, ['init'])
    git(repository, ['config', 'user.name', 'Vibe Test'])
    git(repository, ['config', 'user.email', 'vibe@example.com'])
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(repository, 'history.txt'), String(index))
      git(repository, ['add', 'history.txt'])
      git(repository, ['commit', '-m', `commit-${index}`])
    }
    insertProject(db, 'project-1', 'never', { path: repository, canonicalPath: repository })
    const progress: number[] = []
    const coordinator = new GitSyncCoordinator(db, { batchSize: 2 })
    const result = await coordinator.sync('project-1', {
      onProgress: state => {
        if (state.status === 'syncing' && state.processed) progress.push(state.processed)
      },
    })
    assert.equal(result.inserted, 5)
    assert.equal(result.scanned, 5)
    assert.deepEqual(progress.filter(value => value > 0), [2, 4, 5])
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM git_commits WHERE projectId = 'project-1' AND reachable = 1
    `).get() as { count: number }).count, 5)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('initial Git history baseline caps full backfill but keeps every later incremental commit', async () => {
  const { directory, db } = setup()
  const repository = path.join(directory, 'baseline-repository')
  fs.mkdirSync(repository)
  try {
    git(repository, ['init'])
    git(repository, ['config', 'user.name', 'Vibe Test'])
    git(repository, ['config', 'user.email', 'vibe@example.com'])
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(repository, 'history.txt'), String(index))
      git(repository, ['add', 'history.txt'])
      git(repository, ['commit', '-m', `baseline-${index}`])
    }
    insertProject(db, 'project-baseline', 'never', {
      path: repository, canonicalPath: repository, historyLimit: 2,
    })
    const coordinator = new GitSyncCoordinator(db, { batchSize: 1 })
    const initial = await coordinator.sync('project-baseline')
    assert.equal(initial.scanned, 2)
    assert.equal(initial.inserted, 2)
    assert.deepEqual({ ...(db.prepare(`
      SELECT commitCount, historyLimit, historyTruncated, lastSyncedSha
      FROM git_sync_state WHERE projectId = 'project-baseline'
    `).get() as object) }, {
      commitCount: 5, historyLimit: 2, historyTruncated: 1,
      lastSyncedSha: git(repository, ['rev-parse', 'HEAD']),
    })
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM git_commits WHERE projectId = 'project-baseline' AND reachable = 1
    `).get() as { count: number }).count, 2)

    fs.writeFileSync(path.join(repository, 'history.txt'), 'incremental')
    git(repository, ['add', 'history.txt'])
    git(repository, ['commit', '-m', 'after-baseline'])
    const incremental = await coordinator.sync('project-baseline')
    assert.equal(incremental.scanned, 1)
    assert.equal(incremental.inserted, 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT commitCount, historyLimit, historyTruncated
      FROM git_sync_state WHERE projectId = 'project-baseline'
    `).get() as object) }, { commitCount: 6, historyLimit: 2, historyTruncated: 1 })
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM git_commits WHERE projectId = 'project-baseline' AND reachable = 1
    `).get() as { count: number }).count, 3)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduler limits concurrency and overlapping runOnce calls share one round', async () => {
  const { directory, db } = setup()
  try {
    for (const id of ['project-1', 'project-2', 'project-3', 'project-4']) insertProject(db, id)
    let active = 0
    let peak = 0
    let scans = 0
    const releases: Array<() => void> = []
    const coordinator = new GitSyncCoordinator(db, {
      scan: () => new Promise<GitSyncResult>(resolve => {
        scans += 1
        active += 1
        peak = Math.max(peak, active)
        releases.push(() => {
          active -= 1
          resolve(syncFixture())
        })
      }),
    })
    const scheduler = new GitSyncScheduler(db, coordinator, { concurrency: 2, syncIntervalMs: 1 })
    const first = scheduler.runOnce()
    const second = scheduler.runOnce()
    assert.equal(first, second)
    await waitFor(() => scans === 2)
    assert.equal(peak, 2)
    releases.splice(0).forEach(release => release())
    await waitFor(() => scans === 4)
    releases.splice(0).forEach(release => release())
    assert.deepEqual(await first, { attempted: 4, succeeded: 4, failed: 0 })
    assert.equal(peak, 2)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduler stop aborts active work and does not start queued projects', async () => {
  const { directory, db } = setup()
  try {
    for (const id of ['project-1', 'project-2', 'project-3']) insertProject(db, id)
    let scans = 0
    const coordinator = new GitSyncCoordinator(db, {
      run: (_cwd, _args, _timeout, signal) => new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
      scan: async (_path, _cursor, runner) => {
        scans += 1
        await runner('/repo', ['status'])
        return syncFixture()
      },
    })
    const scheduler = new GitSyncScheduler(db, coordinator, { concurrency: 1, syncIntervalMs: 1 })
    const run = scheduler.runOnce()
    await waitFor(() => scans === 1)
    await scheduler.stop()
    await run
    assert.equal(scans, 1)
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM git_sync_state WHERE status = 'syncing'").get() as { count: number }).count, 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduler can cancel one visible automatic project task', async () => {
  const { directory, db } = setup()
  try {
    insertProject(db, 'project-1')
    let scans = 0
    const states: string[] = []
    const coordinator = new GitSyncCoordinator(db, {
      onState: state => states.push(state.status),
      run: (_cwd, _args, _timeout, signal) => new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
      scan: async (_path, _cursor, runner) => {
        scans += 1
        await runner('/repo', ['status'])
        return syncFixture()
      },
    })
    const scheduler = new GitSyncScheduler(db, coordinator, { concurrency: 1, syncIntervalMs: 1 })
    const run = scheduler.runOnce()
    await waitFor(() => scans === 1)
    assert.equal(scheduler.cancelProject('missing'), false)
    assert.equal(scheduler.cancelProject('project-1'), true)
    await run
    assert.deepEqual(states, ['syncing', 'cancelled'])
    assert.equal((db.prepare("SELECT status FROM git_sync_state WHERE projectId = 'project-1'").get() as { status: string }).status, 'never')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('startup recovery makes every interrupted sync immediately retryable', () => {
  const { directory, db } = setup()
  try {
    insertProject(db, 'project-1', 'syncing', { failureCount: 2, nextRetryAt: 999 })
    db.prepare(`
      UPDATE git_sync_state SET
        backfillGeneration = 'generation-a', backfillOffset = 500, backfillTotal = 1200
      WHERE projectId = 'project-1'
    `).run()
    assert.equal(recoverInterruptedGitSyncs(db, 1234), 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, failureCount, nextRetryAt, error,
        backfillGeneration, backfillOffset, backfillTotal
      FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, {
      status: 'failed', failureCount: 3, nextRetryAt: 1234,
      error: '应用上次退出时 Git 同步仍在执行，已安排重新同步',
      backfillGeneration: 'generation-a', backfillOffset: 500, backfillTotal: 1200,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
