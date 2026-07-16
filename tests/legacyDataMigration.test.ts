import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  VIBETRACKER_DB_FILENAME,
  migrateLegacyUserData,
} from '../electron/legacyDataMigration.ts'

const tempRoots = new Set<string>()

function makeTempRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-migration-'))
  tempRoots.add(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempRoots) fs.rmSync(directory, { recursive: true, force: true })
  tempRoots.clear()
})

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf-8')
}

function readJson(filePath: string) {
  return JSON.parse(readFile(filePath))
}

function runPython(code: string, args: string[] = []) {
  const result = spawnSync(process.env.PYTHON || 'python', ['-c', code, ...args], {
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Python command failed')
  }
  return result.stdout.trim()
}

function readSqliteRows(dbPath: string, query: string) {
  const output = runPython(`
import json
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = [dict(row) for row in conn.execute(sys.argv[2]).fetchall()]
conn.close()
print(json.dumps(rows, ensure_ascii=False))
`, [dbPath, query])
  return JSON.parse(output)
}

test('migrateLegacyUserData copies the legacy database and config without moving screenshots', () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const legacyPath = path.join(appDataPath, 'ai-tools-manager')
  const customScreenshotsDirectory = path.join(appDataPath, 'ScreenshotsOutsideApp')

  fs.mkdirSync(legacyPath, { recursive: true })
  fs.writeFileSync(path.join(legacyPath, 'devtracker.db'), 'legacy sqlite bytes')
  fs.writeFileSync(
    path.join(legacyPath, 'config.json'),
    JSON.stringify({ screenshotsDirectory: customScreenshotsDirectory }, null, 2),
    'utf-8'
  )

  const result = migrateLegacyUserData({
    appDataPath,
    userDataPath: newUserDataPath,
    now: new Date('2026-07-02T03:04:05Z'),
  })

  const migratedDbPath = path.join(newUserDataPath, VIBETRACKER_DB_FILENAME)
  assert.equal(result.databaseMigrated, true)
  assert.equal(result.sourceDatabasePath, path.join(legacyPath, 'devtracker.db'))
  assert.equal(readFile(migratedDbPath), 'legacy sqlite bytes')
  assert.equal(readFile(path.join(legacyPath, 'devtracker.db')), 'legacy sqlite bytes')
  assert.equal(readJson(path.join(newUserDataPath, 'config.json')).screenshotsDirectory, customScreenshotsDirectory)
  assert.equal(fs.existsSync(customScreenshotsDirectory), false)

  assert.deepEqual(
    fs.readdirSync(newUserDataPath)
      .filter(fileName => fileName.startsWith('vibetracker-migration-backup-'))
      .sort(),
    [
      'vibetracker-migration-backup-20260702-030405-postcopy.db',
      'vibetracker-migration-backup-20260702-030405.db',
    ]
  )
})

test('migrateLegacyUserData never overwrites an existing VibeTracker database', () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const legacyPath = path.join(appDataPath, 'DevTracker')

  fs.mkdirSync(newUserDataPath, { recursive: true })
  fs.mkdirSync(legacyPath, { recursive: true })
  fs.writeFileSync(path.join(newUserDataPath, VIBETRACKER_DB_FILENAME), 'existing new db')
  fs.writeFileSync(path.join(legacyPath, 'devtracker.db'), 'legacy sqlite bytes')

  const result = migrateLegacyUserData({
    appDataPath,
    userDataPath: newUserDataPath,
    now: new Date('2026-07-02T03:04:05Z'),
  })

  assert.equal(result.databaseMigrated, false)
  assert.equal(result.reason, 'new-database-exists')
  assert.equal(readFile(path.join(newUserDataPath, VIBETRACKER_DB_FILENAME)), 'existing new db')
  assert.equal(readFile(path.join(legacyPath, 'devtracker.db')), 'legacy sqlite bytes')
})

test('migrateLegacyUserData chooses the newest legacy database and colocated config', () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const olderLegacyPath = path.join(appDataPath, 'ai-tools-manager')
  const newerLegacyPath = path.join(appDataPath, 'DevTracker')

  fs.mkdirSync(olderLegacyPath, { recursive: true })
  fs.mkdirSync(newerLegacyPath, { recursive: true })
  const olderDbPath = path.join(olderLegacyPath, 'devtracker.db')
  const newerDbPath = path.join(newerLegacyPath, 'devtracker.db')
  fs.writeFileSync(olderDbPath, 'older legacy sqlite bytes')
  fs.writeFileSync(path.join(olderLegacyPath, 'config.json'), JSON.stringify({ screenshotsDirectory: 'C:/old' }))
  fs.writeFileSync(newerDbPath, 'newer legacy sqlite bytes')
  fs.writeFileSync(path.join(newerLegacyPath, 'config.json'), JSON.stringify({ screenshotsDirectory: 'C:/new' }))

  fs.utimesSync(olderDbPath, new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'))
  fs.utimesSync(newerDbPath, new Date('2026-07-02T00:00:00Z'), new Date('2026-07-02T00:00:00Z'))

  const result = migrateLegacyUserData({
    appDataPath,
    userDataPath: newUserDataPath,
    now: new Date('2026-07-02T03:04:05Z'),
  })

  assert.equal(result.sourceDatabasePath, newerDbPath)
  assert.equal(result.sourceConfigPath, path.join(newerLegacyPath, 'config.json'))
  assert.equal(readFile(path.join(newUserDataPath, VIBETRACKER_DB_FILENAME)), 'newer legacy sqlite bytes')
  assert.equal(readJson(path.join(newUserDataPath, 'config.json')).screenshotsDirectory, 'C:/new')
})

test('migrateLegacyUserData fails clearly if the legacy database changes while copying', () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const legacyPath = path.join(appDataPath, 'ai-tools-manager')
  const legacyDbPath = path.join(legacyPath, 'devtracker.db')

  fs.mkdirSync(legacyPath, { recursive: true })
  fs.writeFileSync(legacyDbPath, 'legacy sqlite bytes')
  fs.writeFileSync(`${legacyDbPath}-wal`, 'wal bytes')

  const originalCopyFileSync = fs.copyFileSync
  let mutated = false
  const patchedCopyFileSync: typeof fs.copyFileSync = ((source: fs.PathLike, destination: fs.PathLike, mode?: number) => {
    const result = originalCopyFileSync(source, destination, mode as never)
    if (!mutated && String(source).endsWith('devtracker.db-wal')) {
      mutated = true
      fs.appendFileSync(`${legacyDbPath}-wal`, ' changed')
    }
    return result
  }) as typeof fs.copyFileSync

  fs.copyFileSync = patchedCopyFileSync
  try {
    assert.throws(
      () => migrateLegacyUserData({
        appDataPath,
        userDataPath: newUserDataPath,
        now: new Date('2026-07-02T03:04:05Z'),
      }),
      /Legacy database changed during migration/
    )
  } finally {
    fs.copyFileSync = originalCopyFileSync
  }

  assert.equal(fs.existsSync(path.join(newUserDataPath, VIBETRACKER_DB_FILENAME)), false)
})

test('migrateLegacyUserData preserves readable project, tag, commit, and screenshot path data', () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const legacyPath = path.join(appDataPath, 'ai-tools-manager')
  const legacyDbPath = path.join(legacyPath, 'devtracker.db')
  const screenshotPath = path.join(appDataPath, 'LegacyScreenshots', 'commit.png')

  fs.mkdirSync(legacyPath, { recursive: true })
  runPython(`
import sqlite3
import sys

db_path, screenshot_path = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
conn.executescript("""
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE project_tags (projectId TEXT, tagId TEXT);
CREATE TABLE project_commits (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE commit_images (id TEXT PRIMARY KEY, commitId TEXT NOT NULL, imagePath TEXT NOT NULL);
""")
conn.execute("INSERT INTO projects (id, name) VALUES (?, ?)", ("project-1", "Legacy Project"))
conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", ("tag-1", "Legacy Tag"))
conn.execute("INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)", ("project-1", "tag-1"))
conn.execute("INSERT INTO project_commits (id, projectId, title) VALUES (?, ?, ?)", ("commit-1", "project-1", "Legacy Commit"))
conn.execute("INSERT INTO commit_images (id, commitId, imagePath) VALUES (?, ?, ?)", ("image-1", "commit-1", screenshot_path))
conn.commit()
conn.close()
`, [legacyDbPath, screenshotPath])

  migrateLegacyUserData({
    appDataPath,
    userDataPath: newUserDataPath,
    now: new Date('2026-07-02T03:04:05Z'),
  })

  const migratedDbPath = path.join(newUserDataPath, VIBETRACKER_DB_FILENAME)
  assert.deepEqual(readSqliteRows(migratedDbPath, 'SELECT id, name FROM projects'), [{ id: 'project-1', name: 'Legacy Project' }])
  assert.deepEqual(readSqliteRows(migratedDbPath, 'SELECT id, name FROM tags'), [{ id: 'tag-1', name: 'Legacy Tag' }])
  assert.deepEqual(readSqliteRows(migratedDbPath, 'SELECT id, projectId, title FROM project_commits'), [{
    id: 'commit-1',
    projectId: 'project-1',
    title: 'Legacy Commit',
  }])
  assert.deepEqual(readSqliteRows(migratedDbPath, 'SELECT id, commitId, imagePath FROM commit_images'), [{
    id: 'image-1',
    commitId: 'commit-1',
    imagePath: screenshotPath,
  }])
})

test('migrateLegacyUserData includes committed data still stored in a legacy WAL file', async () => {
  const appDataPath = makeTempRoot()
  const newUserDataPath = path.join(appDataPath, 'VibeTracker')
  const legacyPath = path.join(appDataPath, 'ai-tools-manager')
  const legacyDbPath = path.join(legacyPath, 'devtracker.db')
  const readyPath = path.join(appDataPath, 'wal-ready.txt')
  const releasePath = path.join(appDataPath, 'wal-release.txt')

  fs.mkdirSync(legacyPath, { recursive: true })
  const child = spawn(process.env.PYTHON || 'python', ['-c', `
import pathlib
import sqlite3
import sys
import time

db_path, ready_path, release_path = sys.argv[1], sys.argv[2], sys.argv[3]
conn = sqlite3.connect(db_path)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
conn.execute("INSERT INTO projects (id, name) VALUES (?, ?)", ("wal-project", "WAL Project"))
conn.commit()
pathlib.Path(ready_path).write_text("ready", encoding="utf-8")
while not pathlib.Path(release_path).exists():
    time.sleep(0.05)
conn.close()
`, legacyDbPath, readyPath, releasePath])

  try {
    const startedAt = Date.now()
    while (!fs.existsSync(readyPath)) {
      if (Date.now() - startedAt > 5000) {
        throw new Error('Timed out waiting for WAL fixture')
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(fs.existsSync(`${legacyDbPath}-wal`), true)

    migrateLegacyUserData({
      appDataPath,
      userDataPath: newUserDataPath,
      now: new Date('2026-07-02T03:04:05Z'),
    })

    assert.deepEqual(readSqliteRows(path.join(newUserDataPath, VIBETRACKER_DB_FILENAME), 'SELECT id, name FROM projects'), [{
      id: 'wal-project',
      name: 'WAL Project',
    }])
  } finally {
    fs.writeFileSync(releasePath, 'release')
    await new Promise<void>((resolve, reject) => {
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`WAL fixture exited with ${code}`)))
      child.once('error', reject)
    })
  }
})
