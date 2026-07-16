import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { LATEST_SCHEMA_VERSION, getSchemaVersion, migrateDatabase } from '../electron/services/databaseMigrations.ts'

function tempDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-schema-'))
  const dbPath = path.join(directory, 'vibetracker.db')
  return { directory, dbPath, db: new DatabaseSync(dbPath) }
}

test('schema migration preserves legacy projects, development records, and image paths', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, path TEXT,
        status TEXT, progress REAL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE project_commits (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, progressDelta REAL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE commit_images (
        id TEXT PRIMARY KEY, commitId TEXT NOT NULL, imagePath TEXT NOT NULL,
        caption TEXT, sortIndex INTEGER NOT NULL, createdAt INTEGER NOT NULL
      );
      INSERT INTO projects VALUES ('project-1', '旧项目', '说明', 'C:\\repo', 'developing', 42, 1, 2);
      INSERT INTO project_commits VALUES ('record-1', 'project-1', '手工记录', '保留内容', 5, 3, 4);
      INSERT INTO commit_images VALUES ('image-1', 'record-1', 'C:\\shots\\one.png', '封面', 0, 5);
    `)

    const result = migrateDatabase(db, { dbPath, now: new Date('2026-07-15T08:09:10') })
    assert.equal(result.toVersion, LATEST_SCHEMA_VERSION)
    assert.ok(result.backupPath)
    assert.ok(fs.existsSync(result.backupPath!))

    assert.deepEqual(db.prepare('SELECT id, name, path FROM projects').all().map(row => ({ ...row })), [
      { id: 'project-1', name: '旧项目', path: 'C:\\repo' },
    ])
    assert.deepEqual(db.prepare(`
      SELECT id, projectId, title, description, source, reviewStatus
      FROM development_records
    `).all().map(row => ({ ...row })), [{
      id: 'record-1', projectId: 'project-1', title: '手工记录', description: '保留内容',
      source: 'manual', reviewStatus: 'accepted',
    }])
    assert.deepEqual(db.prepare('SELECT id, recordId, imagePath FROM development_record_images').all().map(row => ({ ...row })), [
      { id: 'image-1', recordId: 'record-1', imagePath: 'C:\\shots\\one.png' },
    ])
    const projectColumns = new Set((db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map(column => column.name))
    const recordColumns = new Set((db.prepare('PRAGMA table_info(development_records)').all() as Array<{ name: string }>).map(column => column.name))
    assert.equal(projectColumns.has('progress'), false)
    assert.equal(recordColumns.has('progressDelta'), false)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('schema migration is idempotent and does not create another backup when current', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    const first = migrateDatabase(db, { dbPath })
    const second = migrateDatabase(db, { dbPath })
    assert.deepEqual(first.appliedVersions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.deepEqual(second.appliedVersions, [])
    assert.equal(second.backupPath, null)
    assert.equal(getSchemaVersion(db), LATEST_SCHEMA_VERSION)
    const gitColumns = new Set((db.prepare('PRAGMA table_info(git_commits)').all() as Array<{ name: string }>).map(column => column.name))
    const stateColumns = new Set((db.prepare('PRAGMA table_info(git_sync_state)').all() as Array<{ name: string }>).map(column => column.name))
    assert.equal(gitColumns.has('reachable'), true)
    assert.equal(gitColumns.has('lastSeenGeneration'), true)
    assert.equal(stateColumns.has('scanGeneration'), true)
    assert.equal(stateColumns.has('failureCount'), true)
    assert.equal(stateColumns.has('nextRetryAt'), true)
    assert.equal(stateColumns.has('backfillGeneration'), true)
    assert.equal(stateColumns.has('backfillOffset'), true)
    assert.equal(stateColumns.has('backfillTotal'), true)
    assert.equal(stateColumns.has('historyLimit'), true)
    assert.equal(stateColumns.has('historyTruncated'), true)
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'git_commit_tracking'").get()), true)
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'launch_runs'").get()), true)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('v13 to v14 removes pseudo percentages without losing projects, records, images, or Git traceability', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    migrateDatabase(db, { dbPath })
    db.exec(`
      ALTER TABLE projects ADD COLUMN progress REAL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100);
      ALTER TABLE development_records ADD COLUMN progressDelta REAL DEFAULT 0;
      DELETE FROM schema_migrations WHERE version >= 14;
    `)

    const insertProject = db.prepare(`
      INSERT INTO projects (
        id, name, description, path, status, phase, milestone, nextStep,
        coverImagePath, progress, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let index = 0; index < 14; index += 1) {
      insertProject.run(
        `project-${index}`, `项目 ${index}`, `说明 ${index}`, `C:\\repo-${index}`,
        'status-developing', `阶段 ${index}`, `里程碑 ${index}`, `下一步 ${index}`,
        index === 0 ? 'C:\\shots\\cover.png' : '', index * 5, 100 + index, 200 + index,
      )
    }

    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, provider, model,
        promptVersion, inputHash, progressDelta, userEditedAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'manual', 'accepted', '', '', '', '', ?, ?, ?, ?)
    `)
    for (let index = 0; index < 19; index += 1) {
      insertRecord.run(
        `record-${index}`, `project-${index % 14}`, `开发记录 ${index}`, `保留正文 ${index}`,
        index - 3, 300 + index, 300 + index, 400 + index,
      )
    }

    const insertImage = db.prepare(`
      INSERT INTO development_record_images (id, recordId, imagePath, caption, sortIndex, createdAt)
      VALUES (?, ?, ?, ?, 0, ?)
    `)
    for (let index = 0; index < 16; index += 1) {
      insertImage.run(`image-${index}`, `record-${index}`, `C:\\shots\\${index}.png`, `说明 ${index}`, 500 + index)
    }

    const tracedSha = 'a'.repeat(40)
    db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, createdAt)
      VALUES ('git-0', 'project-0', ?, '可追溯提交', 600, 600)
    `).run(tracedSha)
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      .run('record-0', tracedSha)

    const result = migrateDatabase(db, { dbPath, now: new Date('2026-07-16T12:34:56') })
    assert.deepEqual(result.appliedVersions, [14, 15, 16, 17])
    assert.ok(result.backupPath && fs.existsSync(result.backupPath))
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count, 14)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM development_records').get() as { count: number }).count, 19)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM development_record_images').get() as { count: number }).count, 16)
    assert.deepEqual({ ...(db.prepare(`
      SELECT phase, milestone, nextStep, coverImagePath FROM projects WHERE id = 'project-0'
    `).get() as object) }, {
      phase: '阶段 0', milestone: '里程碑 0', nextStep: '下一步 0', coverImagePath: 'C:\\shots\\cover.png',
    })
    assert.deepEqual({ ...(db.prepare(`
      SELECT title, description, source, reviewStatus, userEditedAt
      FROM development_records WHERE id = 'record-0'
    `).get() as object) }, {
      title: '开发记录 0', description: '保留正文 0', source: 'manual', reviewStatus: 'accepted', userEditedAt: 300,
    })
    assert.equal((db.prepare(`
      SELECT imagePath FROM development_record_images WHERE id = 'image-15'
    `).get() as { imagePath: string }).imagePath, 'C:\\shots\\15.png')
    assert.deepEqual({ ...(db.prepare(`
      SELECT disposition, handledByRecordId FROM git_commit_tracking
      WHERE projectId = 'project-0' AND gitSha = ?
    `).get(tracedSha) as object) }, { disposition: 'handled', handledByRecordId: 'record-0' })

    const projectColumns = new Set((db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map(column => column.name))
    const recordColumns = new Set((db.prepare('PRAGMA table_info(development_records)').all() as Array<{ name: string }>).map(column => column.name))
    assert.equal(projectColumns.has('progress'), false)
    assert.equal(recordColumns.has('progressDelta'), false)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
    assert.throws(() => db.prepare(`
      UPDATE git_commit_tracking SET disposition = 'ignored', handledByRecordId = NULL
      WHERE projectId = 'project-0' AND gitSha = ?
    `).run(tracedSha), /accepted Git commit must be handled by its active record/)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('core domain invariant triggers reject invalid status, generation, and cross-project Git states', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    migrateDatabase(db, { dbPath })
    db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run('project-a', '项目 A', 1, 1)
    db.prepare('INSERT INTO projects (id, name, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('project-b', '项目 B', 'developing', 1, 1)
    assert.equal((db.prepare("SELECT status FROM projects WHERE id = 'project-a'").get() as { status: string }).status, 'status-developing')
    assert.equal((db.prepare("SELECT status FROM projects WHERE id = 'project-b'").get() as { status: string }).status, 'status-developing')
    assert.throws(() => db.prepare(`
      INSERT INTO projects (id, name, status, createdAt, updatedAt)
      VALUES ('project-invalid', '无效状态', 'missing-status', 1, 1)
    `).run(), /project status must reference/)
    assert.throws(() => db.prepare("DELETE FROM project_statuses WHERE id = 'status-developing'").run(), /still in use/)

    const insertRun = db.prepare(`
      INSERT INTO ai_generation_runs (
        id, projectId, provider, model, promptVersion, inputHash, inputShasJson,
        outputJson, status, createdAt, updatedAt, completedAt
      ) VALUES (?, ?, 'openai-compatible', 'model', 'v1', 'hash', '[]', '{}', ?, ?, ?, ?)
    `)
    assert.throws(() => insertRun.run('run-invalid', 'project-a', 'failed', 10, 10, null), /lifecycle is inconsistent/)
    insertRun.run('run-a', 'project-a', 'running', 10, 10, null)
    assert.throws(() => db.prepare(`
      UPDATE ai_generation_runs SET status = 'succeeded' WHERE id = 'run-a'
    `).run(), /lifecycle is inconsistent/)
    db.prepare(`
      UPDATE ai_generation_runs SET status = 'succeeded', completedAt = 11, updatedAt = 11 WHERE id = 'run-a'
    `).run()

    assert.throws(() => db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES ('manual-draft', 'project-a', '无效手工草稿', 'manual', 'draft', 1, 1)
    `).run(), /manual development records must be accepted/)
    assert.throws(() => db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, generationRunId, createdAt, updatedAt
      ) VALUES ('wrong-run', 'project-b', '跨项目生成', 'ai', 'draft', 'run-a', 1, 1)
    `).run(), /generation run from the same project/)

    const sha = 'a'.repeat(40)
    db.prepare(`
      INSERT INTO git_commits (id, projectId, sha, subject, authoredAt, createdAt)
      VALUES ('git-a', 'project-a', ?, '项目 A 提交', 20, 20)
    `).run(sha)
    const insertRecord = db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, 'ai', ?, 30, 30)
    `)
    insertRecord.run('record-a', 'project-a', '正式记录', 'accepted')
    insertRecord.run('draft-a', 'project-a', '竞争草稿', 'draft')
    insertRecord.run('draft-b', 'project-b', '跨项目草稿', 'draft')
    const insertLink = db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
    assert.throws(() => insertLink.run('draft-b', sha), /belongs to another project/)
    assert.throws(() => insertLink.run('draft-a', 'short'), /Git SHA is invalid/)
    insertLink.run('record-a', sha)
    assert.throws(() => insertLink.run('draft-a', sha), /already belongs to an active development record/)
    db.prepare("UPDATE development_records SET reviewStatus = 'rejected' WHERE id = 'record-a'").run()
    insertLink.run('draft-a', sha)
    assert.throws(() => db.prepare(`
      UPDATE development_record_git_commits SET gitSha = ? WHERE recordId = 'draft-a'
    `).run('b'.repeat(40)), /links are immutable/)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('migration failure rolls schema changes back and leaves a readable pre-migration backup', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    db.exec(`
      CREATE TABLE sentinel (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO sentinel VALUES ('keep', 'existing user data');
    `)
    const failingDatabase = {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => {
        if (sql.includes('CREATE TABLE IF NOT EXISTS projects')) {
          db.exec(sql)
          throw new Error('simulated migration failure')
        }
        db.exec(sql)
      },
    }
    assert.throws(
      () => migrateDatabase(failingDatabase, { dbPath, now: new Date('2026-07-16T00:00:00') }),
      /transaction was rolled back.*backup:/,
    )
    assert.deepEqual({ ...(db.prepare("SELECT * FROM sentinel WHERE id = 'keep'").get() as object) }, {
      id: 'keep', value: 'existing user data',
    })
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get(), undefined)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 0)
    assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')

    const backups = fs.readdirSync(directory).filter(name => name.startsWith('vibetracker-pre-schema-'))
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(path.join(directory, backups[0]))
    try {
      assert.deepEqual({ ...(backup.prepare("SELECT * FROM sentinel WHERE id = 'keep'").get() as object) }, {
        id: 'keep', value: 'existing user data',
      })
      assert.equal((backup.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
    } finally {
      backup.close()
    }
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('reachability migration preserves existing Git facts and schedules a compatibility rescan', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt INTEGER NOT NULL
      );
      INSERT INTO schema_migrations VALUES (4, 'traceable-ai-generation-runs', 1);
      CREATE TABLE git_commits (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL, sha TEXT NOT NULL,
        subject TEXT NOT NULL, authoredAt INTEGER NOT NULL,
        UNIQUE(projectId, sha)
      );
      CREATE TABLE git_sync_state (
        projectId TEXT PRIMARY KEY, headSha TEXT DEFAULT '', lastSyncedSha TEXT DEFAULT ''
      );
      INSERT INTO git_commits VALUES ('git-1', 'project-1', '${'a'.repeat(40)}', 'existing fact', 1000);
      INSERT INTO git_sync_state VALUES ('project-1', '${'a'.repeat(40)}', '${'a'.repeat(40)}');
    `)

    const result = migrateDatabase(db, { dbPath })
    assert.deepEqual(result.appliedVersions, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.deepEqual({ ...(db.prepare(`
      SELECT id, sha, subject, reachable, lastSeenGeneration FROM git_commits WHERE id = 'git-1'
    `).get() as object) }, {
      id: 'git-1', sha: 'a'.repeat(40), subject: 'existing fact', reachable: 1, lastSeenGeneration: '',
    })
    assert.equal((db.prepare(`
      SELECT scanGeneration FROM git_sync_state WHERE projectId = 'project-1'
    `).get() as { scanGeneration: string }).scanGeneration, '')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('active-record invariant migration repairs contradictory Git tracking and installs database guards', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    migrateDatabase(db, { dbPath })
    db.exec(`
      DROP TRIGGER IF EXISTS trg_git_tracking_active_insert_guard;
      DROP TRIGGER IF EXISTS trg_git_tracking_active_update_guard;
      DROP TRIGGER IF EXISTS trg_git_tracking_active_delete_guard;
      DROP TRIGGER IF EXISTS trg_git_record_link_sync_tracking;
      DROP TRIGGER IF EXISTS trg_git_record_link_release_tracking;
      DROP TRIGGER IF EXISTS trg_development_record_status_sync_tracking;
      DELETE FROM schema_migrations WHERE version >= 7;

      INSERT INTO projects (id, name, createdAt, updatedAt)
        VALUES ('project-1', '迁移修复', 1, 1);
      INSERT INTO git_commits (
        id, projectId, sha, subject, authoredAt, reachable, createdAt
      ) VALUES
        ('git-draft', 'project-1', '${'d'.repeat(40)}', 'draft fact', 10, 1, 10),
        ('git-accepted', 'project-1', '${'a'.repeat(40)}', 'accepted fact', 20, 1, 20);
      INSERT INTO development_records (
        id, projectId, title, source, reviewStatus, createdAt, updatedAt
      ) VALUES
        ('draft-1', 'project-1', '待审核记录', 'ai', 'draft', 30, 30),
        ('accepted-1', 'project-1', '正式记录', 'manual', 'accepted', 40, 40);
      INSERT INTO development_record_git_commits (recordId, gitSha) VALUES
        ('draft-1', '${'d'.repeat(40)}'),
        ('accepted-1', '${'a'.repeat(40)}');
      INSERT INTO git_commit_tracking (
        projectId, gitSha, disposition, seenAt, handledByRecordId, updatedAt
      ) VALUES
        ('project-1', '${'d'.repeat(40)}', 'ignored', 111, NULL, 111),
        ('project-1', '${'a'.repeat(40)}', 'pending', 222, NULL, 222);
    `)

    const result = migrateDatabase(db, { dbPath })
    assert.deepEqual(result.appliedVersions, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.deepEqual(db.prepare(`
      SELECT gitSha, disposition, seenAt, handledByRecordId
      FROM git_commit_tracking ORDER BY gitSha
    `).all().map(row => ({ ...row })), [{
      gitSha: 'a'.repeat(40), disposition: 'handled', seenAt: 222, handledByRecordId: 'accepted-1',
    }, {
      gitSha: 'd'.repeat(40), disposition: 'pending', seenAt: 111, handledByRecordId: null,
    }])

    assert.throws(() => db.prepare(`
      UPDATE git_commit_tracking SET disposition = 'ignored'
      WHERE projectId = 'project-1' AND gitSha = ?
    `).run('d'.repeat(40)), /draft Git commit must remain pending/)
    assert.throws(() => db.prepare(`
      UPDATE git_commit_tracking SET disposition = 'pending', handledByRecordId = NULL
      WHERE projectId = 'project-1' AND gitSha = ?
    `).run('a'.repeat(40)), /accepted Git commit must be handled by its active record/)
    assert.throws(() => db.prepare(`
      DELETE FROM git_commit_tracking
      WHERE projectId = 'project-1' AND gitSha = ?
    `).run('a'.repeat(40)), /accepted Git commit tracking cannot be deleted/)
    db.prepare(`
      DELETE FROM development_record_git_commits
      WHERE recordId = 'accepted-1' AND gitSha = ?
    `).run('a'.repeat(40))
    assert.deepEqual({ ...(db.prepare(`
      SELECT disposition, handledByRecordId FROM git_commit_tracking
      WHERE projectId = 'project-1' AND gitSha = ?
    `).get('a'.repeat(40)) as object) }, { disposition: 'pending', handledByRecordId: null })
    db.prepare('INSERT INTO development_record_git_commits (recordId, gitSha) VALUES (?, ?)')
      .run('accepted-1', 'a'.repeat(40))
    assert.deepEqual({ ...(db.prepare(`
      SELECT disposition, handledByRecordId FROM git_commit_tracking
      WHERE projectId = 'project-1' AND gitSha = ?
    `).get('a'.repeat(40)) as object) }, { disposition: 'handled', handledByRecordId: 'accepted-1' })
    assert.doesNotThrow(() => db.prepare('DELETE FROM projects WHERE id = ?').run('project-1'))
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM git_commit_tracking').get() as { count: number }).count, 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI generation run migration preserves successful output and adds recovery metadata', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt INTEGER NOT NULL
      );
      INSERT INTO schema_migrations VALUES (7, 'git-commit-active-record-invariants', 1);
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE ai_generation_runs (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        promptVersion TEXT NOT NULL, inputHash TEXT NOT NULL, inputShasJson TEXT NOT NULL,
        outputJson TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
      INSERT INTO projects VALUES ('project-1', 'AI 历史', 1, 1);
      INSERT INTO ai_generation_runs VALUES (
        'run-1', 'project-1', 'openai-compatible', 'model-a', 'prompt-v1', 'hash-a',
        '["${'a'.repeat(40)}"]', '{"records":[]}', 1234
      );
    `)

    const result = migrateDatabase(db, { dbPath })
    assert.deepEqual(result.appliedVersions, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.deepEqual({ ...(db.prepare(`
      SELECT status, rulesVersion, rulesSnapshotJson, settingsSnapshotJson,
        inputSnapshotJson, replaceDraftIdsJson, error, updatedAt, completedAt, outputJson
      FROM ai_generation_runs WHERE id = 'run-1'
    `).get() as object) }, {
      status: 'succeeded',
      rulesVersion: 0,
      rulesSnapshotJson: '{}',
      settingsSnapshotJson: '{}',
      inputSnapshotJson: '{}',
      replaceDraftIdsJson: '[]',
      error: '',
      updatedAt: 1234,
      completedAt: 1234,
      outputJson: '{"records":[]}',
    })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('persistent Git scheduling migration preserves cursors and recovers only interrupted syncs', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    migrateDatabase(db, { dbPath })
    db.exec(`
      DELETE FROM schema_migrations WHERE version IN (9, 10, 11, 12, 13, 14, 15, 16, 17);
      INSERT INTO projects (id, name, createdAt, updatedAt) VALUES
        ('project-syncing', 'Interrupted', 1, 1),
        ('project-failed', 'Failed', 1, 1),
        ('project-synced', 'Synced', 1, 1);
      INSERT INTO git_sync_state (
        projectId, headSha, lastSyncedSha, branch, lastScannedAt, status, error,
        scanGeneration, failureCount, nextRetryAt
      ) VALUES
        ('project-syncing', '${'a'.repeat(40)}', '${'a'.repeat(40)}', 'main', 100, 'syncing', '', 'generation-a', 2, 999),
        ('project-failed', '${'b'.repeat(40)}', '${'b'.repeat(40)}', 'main', 200, 'failed', 'network', 'generation-b', 4, 12345),
        ('project-synced', '${'c'.repeat(40)}', '${'c'.repeat(40)}', 'main', 300, 'synced', '', 'generation-c', 0, NULL);
    `)

    const result = migrateDatabase(db, { dbPath })
    assert.deepEqual(result.appliedVersions, [9, 10, 11, 12, 13, 14, 15, 16, 17])
    assert.deepEqual(db.prepare(`
      SELECT projectId, lastSyncedSha, lastScannedAt, status, error, scanGeneration,
        failureCount, nextRetryAt
      FROM git_sync_state ORDER BY projectId
    `).all().map(row => ({ ...row })), [{
      projectId: 'project-failed', lastSyncedSha: 'b'.repeat(40), lastScannedAt: 200,
      status: 'failed', error: 'network', scanGeneration: 'generation-b', failureCount: 4, nextRetryAt: 12345,
    }, {
      projectId: 'project-synced', lastSyncedSha: 'c'.repeat(40), lastScannedAt: 300,
      status: 'synced', error: '', scanGeneration: 'generation-c', failureCount: 0, nextRetryAt: null,
    }, {
      projectId: 'project-syncing', lastSyncedSha: 'a'.repeat(40), lastScannedAt: 100,
      status: 'failed', error: '应用上次退出时 Git 同步仍在执行，已安排重新同步', scanGeneration: 'generation-a',
      failureCount: 3, nextRetryAt: 0,
    }])

    const second = migrateDatabase(db, { dbPath })
    assert.deepEqual(second.appliedVersions, [])
    assert.equal((db.prepare(`
      SELECT failureCount FROM git_sync_state WHERE projectId = 'project-syncing'
    `).get() as { failureCount: number }).failureCount, 3)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('v16 to v17 adds relink asset history without changing existing project data', () => {
  const { directory, dbPath, db } = tempDatabase()
  try {
    migrateDatabase(db, { dbPath })
    db.prepare(`
      INSERT INTO projects (id, name, path, canonicalPath, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('project-1', '保留项目', 'C:\\old-repo', 'C:\\old-repo', 1, 2)
    db.prepare(`
      INSERT INTO development_records (
        id, projectId, title, description, source, reviewStatus, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'manual', 'accepted', ?, ?)
    `).run('record-1', 'project-1', '保留记录', '不会丢失', 3, 4)
    db.exec(`
      DROP TABLE project_relink_roots;
      DELETE FROM schema_migrations WHERE version = 17;
    `)

    const result = migrateDatabase(db, { dbPath, now: new Date(2026, 6, 16, 6, 0, 0) })
    assert.deepEqual(result.appliedVersions, [17])
    assert.ok(result.backupPath && fs.existsSync(result.backupPath))
    assert.equal(getSchemaVersion(db), 17)
    assert.equal((db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'project_relink_roots'
    `).get() as { count: number }).count, 1)
    assert.deepEqual({ ...(db.prepare(`
      SELECT name, path, canonicalPath FROM projects WHERE id = 'project-1'
    `).get() as object) }, { name: '保留项目', path: 'C:\\old-repo', canonicalPath: 'C:\\old-repo' })
    assert.deepEqual({ ...(db.prepare(`
      SELECT title, description, reviewStatus FROM development_records WHERE id = 'record-1'
    `).get() as object) }, { title: '保留记录', description: '不会丢失', reviewStatus: 'accepted' })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
