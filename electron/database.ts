import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'devtracker.db')

// Ensure directory exists
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}

const db = new Database(dbPath)

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    path TEXT,
    status TEXT DEFAULT 'developing',
    progress REAL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_tags (
    projectId TEXT,
    tagId TEXT,
    PRIMARY KEY (projectId, tagId),
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS noteblocks (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    content TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
  );
`)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function columnExists(table: string, column: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row: any) => row.name === column)
}

if (!columnExists('projects', 'coverImagePath')) {
  db.prepare('ALTER TABLE projects ADD COLUMN coverImagePath TEXT DEFAULT ""').run()
}

if (!columnExists('projects', 'repoUrl')) {
  db.prepare('ALTER TABLE projects ADD COLUMN repoUrl TEXT DEFAULT ""').run()
}

db.exec(`
  CREATE TABLE IF NOT EXISTS project_statuses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sortIndex INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_commits (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    progressDelta REAL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS commit_images (
    id TEXT PRIMARY KEY,
    commitId TEXT NOT NULL,
    imagePath TEXT NOT NULL,
    caption TEXT DEFAULT '',
    sortIndex INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY(commitId) REFERENCES project_commits(id) ON DELETE CASCADE
  );
`)

const defaultStatuses = [
  { id: 'status-idea', name: '构思中', color: '#A8B0BD' },
  { id: 'status-prototype', name: '原型中', color: '#74A9FF' },
  { id: 'status-developing', name: '开发中', color: '#74A9FF' },
  { id: 'status-demo', name: '可演示', color: '#63D693' },
  { id: 'status-polish', name: '打磨中', color: '#B8A6FF' },
  { id: 'status-paused', name: '暂停', color: '#F3BB6C' },
  { id: 'status-completed', name: '完成', color: '#63D693' },
  { id: 'status-archived', name: '归档', color: '#707A8A' },
]

const existingStatusCount = db.prepare('SELECT COUNT(*) AS count FROM project_statuses').get() as { count: number }
if (existingStatusCount.count === 0) {
  const now = Date.now()
  const insertStatus = db.prepare(`
    INSERT INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const seedStatuses = db.transaction(() => {
    defaultStatuses.forEach((status, index) => {
      insertStatus.run(status.id, status.name, status.color, index, now, now)
    })
  })
  seedStatuses()
}

const legacyStatusMap: Record<string, string> = {
  developing: 'status-developing',
  completed: 'status-completed',
  paused: 'status-paused',
}

const statusIds = new Set((db.prepare('SELECT id FROM project_statuses').all() as any[]).map(row => row.id))
const projects = db.prepare('SELECT id, status FROM projects').all() as any[]
const migrateStatuses = db.transaction(() => {
  for (const project of projects) {
    const nextStatus = legacyStatusMap[project.status] || (statusIds.has(project.status) ? project.status : 'status-developing')
    if (nextStatus !== project.status) {
      db.prepare('UPDATE projects SET status = ?, updatedAt = ? WHERE id = ?').run(nextStatus, Date.now(), project.id)
    }
  }
})
migrateStatuses()

export default db
