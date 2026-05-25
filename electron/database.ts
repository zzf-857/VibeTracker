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

export default db
