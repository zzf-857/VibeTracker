import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'
import {
  beginGitBackfill,
  completeGitBackfill,
  GIT_SYNC_RETRY_BASE_MS,
  markGitSyncFailure,
  persistGitBackfillBatch,
  persistGitSync,
  persistProjectRelink,
  ProjectGitOperationLock,
} from '../electron/services/gitRepository.ts'
import type { GitScanPlan, GitSyncResult, ProjectInspection } from '../electron/services/gitService.ts'

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-git-db-'))
  const dbPath = path.join(directory, 'test.db')
  const db = new DatabaseSync(dbPath)
  migrateDatabase(db, { dbPath })
  db.prepare(`INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`).run('project-1', 'Test', 1, 1)
  return { directory, db }
}

function syncFixture(): GitSyncResult {
  return {
    headSha: 'b'.repeat(40), branch: 'main', detached: false, remoteUrl: 'https://example.com/repo.git',
    commitCount: 1, cursorWasReset: false, scanMode: 'full',
    commits: [{
      sha: 'b'.repeat(40), parentShas: [], authorName: 'Dev', authorEmail: 'dev@example.com',
      authoredAt: 1000, subject: 'first', body: '', fileNames: ['src/main.ts'],
      stats: { added: 10, deleted: 0, files: 1 },
    }],
  }
}

test('persisting the same Git scan twice is idempotent and advances one cursor', () => {
  const { directory, db } = setup()
  try {
    const first = persistGitSync(db, 'project-1', syncFixture(), 2000)
    const second = persistGitSync(db, 'project-1', {
      ...syncFixture(), commits: [], scanMode: 'unchanged',
    }, 3000)
    assert.equal(first.inserted, 1)
    assert.equal(second.inserted, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commits').get() as { count: number }).count, 1)
    const state = db.prepare('SELECT headSha, lastSyncedSha, status, scanGeneration FROM git_sync_state WHERE projectId = ?').get('project-1') as Record<string, unknown>
    assert.equal(state.headSha, 'b'.repeat(40))
    assert.equal(state.lastSyncedSha, 'b'.repeat(40))
    assert.equal(state.status, 'synced')
    assert.equal(state.scanGeneration, second.scanGeneration)
    const commit = db.prepare('SELECT reachable, lastSeenGeneration FROM git_commits WHERE projectId = ?').get('project-1') as Record<string, unknown>
    assert.equal(commit.reachable, 1)
    assert.equal(commit.lastSeenGeneration, second.scanGeneration)
    assert.equal((db.prepare('SELECT updatedAt FROM projects WHERE id = ?').get('project-1') as { updatedAt: number }).updatedAt, 2000)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Git history backfill persists each batch, resumes its cursor, and publishes reachability only when complete', () => {
  const { directory, db } = setup()
  try {
    const plan: GitScanPlan = {
      repositoryPath: directory,
      headSha: 'd'.repeat(40),
      baseSha: '',
      branch: 'main',
      detached: false,
      remoteUrl: '',
      commitCount: 3,
      cursorWasReset: false,
      scanMode: 'full',
      revisionArgs: ['d'.repeat(40)],
      totalToScan: 3,
    }
    const commits = ['d', 'c', 'b'].map((prefix, index) => ({
      sha: prefix.repeat(40),
      parentShas: [],
      authorName: 'Dev',
      authorEmail: 'dev@example.com',
      authoredAt: 3_000 - index,
      subject: `commit-${prefix}`,
      body: '',
      fileNames: [`${prefix}.txt`],
      stats: { added: 1, deleted: 0, files: 1 },
    }))

    let session = beginGitBackfill(db, 'project-1', plan, 1_000)
    session = persistGitBackfillBatch(db, 'project-1', session, commits.slice(0, 2), 1_100)
    assert.equal(session.offset, 2)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE reachable = 1').get() as { count: number }).count, 0)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, backfillOffset, backfillTotal, backfillGeneration
      FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, {
      status: 'syncing', backfillOffset: 2, backfillTotal: 3, backfillGeneration: session.generation,
    })

    const resumed = beginGitBackfill(db, 'project-1', plan, 1_200)
    assert.equal(resumed.resumed, true)
    assert.equal(resumed.offset, 2)
    session = persistGitBackfillBatch(db, 'project-1', resumed, commits.slice(2), 1_300)
    const result = completeGitBackfill(db, 'project-1', plan, session, 1_400)
    assert.equal(result.inserted, 3)
    assert.equal(result.scanned, 3)
    assert.equal(result.resumed, true)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commits WHERE reachable = 1').get() as { count: number }).count, 3)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, lastSyncedSha, scanGeneration, backfillGeneration, backfillOffset, backfillTotal
      FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as object) }, {
      status: 'synced', lastSyncedSha: plan.headSha, scanGeneration: session.generation,
      backfillGeneration: '', backfillOffset: 0, backfillTotal: 0,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Git sync failures persist exponential backoff and a successful sync clears it', () => {
  const { directory, db } = setup()
  try {
    const first = markGitSyncFailure(db, 'project-1', 'offline', 1_000)
    const second = markGitSyncFailure(db, 'project-1', 'still offline', 2_000)
    assert.deepEqual(first, { failureCount: 1, nextRetryAt: 1_000 + GIT_SYNC_RETRY_BASE_MS })
    assert.deepEqual(second, { failureCount: 2, nextRetryAt: 2_000 + (GIT_SYNC_RETRY_BASE_MS * 2) })
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, error, failureCount, nextRetryAt FROM git_sync_state WHERE projectId = ?
    `).get('project-1') as object) }, {
      status: 'failed', error: 'still offline', failureCount: 2,
      nextRetryAt: 2_000 + (GIT_SYNC_RETRY_BASE_MS * 2),
    })

    persistGitSync(db, 'project-1', syncFixture(), 3_000)
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, error, failureCount, nextRetryAt FROM git_sync_state WHERE projectId = ?
    `).get('project-1') as object) }, {
      status: 'synced', error: '', failureCount: 0, nextRetryAt: null,
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a rewritten full scan archives unreachable commits while preserving their immutable facts', () => {
  const { directory, db } = setup()
  try {
    const old = syncFixture()
    const first = persistGitSync(db, 'project-1', old, 2000)
    const replacementSha = 'c'.repeat(40)
    const rewritten: GitSyncResult = {
      ...old,
      headSha: replacementSha,
      commitCount: 1,
      cursorWasReset: true,
      scanMode: 'full',
      commits: [{
        ...old.commits[0],
        sha: replacementSha,
        subject: 'replacement',
      }],
    }
    const result = persistGitSync(db, 'project-1', rewritten, 3000)
    assert.equal(result.inserted, 1)
    assert.deepEqual(db.prepare(`
      SELECT sha, subject, reachable, lastSeenGeneration
      FROM git_commits WHERE projectId = ? ORDER BY sha
    `).all('project-1').map(row => ({ ...row })), [
      { sha: 'b'.repeat(40), subject: 'first', reachable: 0, lastSeenGeneration: first.scanGeneration },
      { sha: replacementSha, subject: 'replacement', reachable: 1, lastSeenGeneration: result.scanGeneration },
    ])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('project Git operation lock serializes sync and relink work for the same project only', async () => {
  const lock = new ProjectGitOperationLock()
  const events: string[] = []
  let releaseFirst = () => {}
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const first = lock.run('project-1', async () => {
    events.push('sync:start')
    await firstGate
    events.push('sync:end')
    return 'sync'
  })
  const relink = lock.run('project-1', async () => {
    events.push('relink:start')
    events.push('relink:end')
    return 'relink'
  })
  const otherProject = lock.run('project-2', async () => {
    events.push('other:start')
    return 'other'
  })

  await otherProject
  assert.deepEqual(events, ['sync:start', 'other:start'])
  releaseFirst()
  assert.deepEqual(await Promise.all([first, relink]), ['sync', 'relink'])
  assert.deepEqual(events, ['sync:start', 'other:start', 'sync:end', 'relink:start', 'relink:end'])
})

test('relinking a project atomically updates its canonical repository and Git state', () => {
  const { directory, db } = setup()
  try {
    const repositoryRoot = path.join(directory, 'moved-repository')
    db.prepare('UPDATE projects SET path = ?, canonicalPath = ? WHERE id = ?')
      .run(directory, directory, 'project-1')
    db.prepare(`
      INSERT INTO launch_profiles (
        id, projectId, name, executable, argsJson, cwd, envJson, readyUrl, enabled,
        validated, confirmedHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, '[]', ?, '{}', '', 1, 1, ?, ?, ?)
    `).run('launch-1', 'project-1', '旧仓库启动', process.execPath, directory, 'confirmed-hash', 1, 1)
    const inspection: ProjectInspection = {
      selectedPath: repositoryRoot,
      canonicalPath: repositoryRoot,
      repositoryRoot,
      isGitRepository: true,
      gitAvailable: true,
      projectName: 'moved-repository',
      branch: 'main',
      headSha: 'b'.repeat(40),
      detached: false,
      emptyRepository: false,
      commitCount: 1,
      recentCommits: syncFixture().commits,
      remoteUrl: 'https://example.com/repo.git',
      techStack: [],
      readmeSummary: '',
      launchCandidates: [],
      assetCandidates: [],
      warnings: [],
    }
    const result = persistProjectRelink(db, 'project-1', inspection, syncFixture(), 4000)
    assert.equal(result.inserted, 1)
    assert.equal(result.invalidatedLaunchProfiles, 1)
    const project = db.prepare('SELECT path, canonicalPath, repoUrl, importedAt, updatedAt FROM projects WHERE id = ?')
      .get('project-1') as Record<string, unknown>
    assert.equal(project.path, repositoryRoot)
    assert.equal(project.canonicalPath, repositoryRoot)
    assert.equal(project.repoUrl, inspection.remoteUrl)
    assert.equal(project.importedAt, 4000)
    assert.equal(project.updatedAt, 4000)
    const state = db.prepare('SELECT headSha, lastSyncedSha, branch, status FROM git_sync_state WHERE projectId = ?')
      .get('project-1') as Record<string, unknown>
    assert.equal(state.headSha, inspection.headSha)
    assert.equal(state.lastSyncedSha, inspection.headSha)
    assert.equal(state.branch, 'main')
    assert.equal(state.status, 'synced')
    const launch = db.prepare('SELECT validated, confirmedHash, updatedAt FROM launch_profiles WHERE id = ?')
      .get('launch-1') as Record<string, unknown>
    assert.deepEqual({ ...launch }, { validated: 0, confirmedHash: '', updatedAt: 4000 })
    assert.deepEqual({ ...(db.prepare(`
      SELECT rootPath, createdAt FROM project_relink_roots WHERE projectId = ?
    `).get('project-1') as object) }, { rootPath: directory, createdAt: 4000 })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
