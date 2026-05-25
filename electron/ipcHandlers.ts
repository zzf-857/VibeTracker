import { dialog, ipcMain } from 'electron'
import db from './database'
import fs from 'node:fs/promises'
import path from 'node:path'

const imageMimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function hydrateCommit(commit: any) {
  commit.images = db.prepare('SELECT * FROM commit_images WHERE commitId = ? ORDER BY sortIndex ASC, createdAt ASC').all(commit.id)
  return commit
}

function getRecentCommit(projectId: string) {
  const commit = db.prepare('SELECT * FROM project_commits WHERE projectId = ? ORDER BY createdAt DESC LIMIT 1').get(projectId) as any
  return commit ? hydrateCommit(commit) : null
}

function getResolvedCoverImage(project: any) {
  if (project.coverImagePath) return project.coverImagePath
  const image = db.prepare(`
    SELECT ci.imagePath FROM commit_images ci
    JOIN project_commits pc ON ci.commitId = pc.id
    WHERE pc.projectId = ?
    ORDER BY pc.createdAt DESC, ci.sortIndex ASC
    LIMIT 1
  `).get(project.id) as any
  return image?.imagePath || ''
}

function hydrateProject(project: any, includeDetail = false) {
  project.statusInfo = db.prepare('SELECT * FROM project_statuses WHERE id = ?').get(project.status) || null
  project.tags = db.prepare(`
    SELECT t.* FROM tags t 
    JOIN project_tags pt ON t.id = pt.tagId 
    WHERE pt.projectId = ?
  `).all(project.id)
  project.recentCommit = getRecentCommit(project.id)
  project.commitCount = (db.prepare('SELECT COUNT(*) AS count FROM project_commits WHERE projectId = ?').get(project.id) as any).count
  project.resolvedCoverImagePath = getResolvedCoverImage(project)
  if (includeDetail) {
    project.noteblocks = db.prepare('SELECT * FROM noteblocks WHERE projectId = ? ORDER BY updatedAt DESC').all(project.id)
    project.todos = db.prepare('SELECT * FROM todos WHERE projectId = ? ORDER BY createdAt ASC').all(project.id)
    project.commits = db.prepare('SELECT * FROM project_commits WHERE projectId = ? ORDER BY createdAt DESC').all(project.id).map(hydrateCommit)
  }
  return project
}

export function setupIpcHandlers() {
  // --- Projects ---
  ipcMain.handle('get-projects', () => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC').all()
    return (projects as any[]).map(p => hydrateProject(p))
  })

  ipcMain.handle('get-project', (_, id: string) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    if (!project) return null
    return hydrateProject(project, true)
  })

  ipcMain.handle('create-project', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const stmnt = db.prepare(`
      INSERT INTO projects (id, name, description, path, status, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const defaultStatus = (db.prepare('SELECT id FROM project_statuses ORDER BY sortIndex ASC LIMIT 1').get() as any)?.id || 'status-developing'
    stmnt.run(id, data.name, data.description || '', data.path || '', data.status || defaultStatus, data.progress || 0, now, now)
    
    if (data.tagIds && Array.isArray(data.tagIds)) {
      const tagStmnt = db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)')
      const insertTags = db.transaction(() => {
        for (const tagId of data.tagIds) tagStmnt.run(id, tagId)
      })
      insertTags()
    }
    return id
  })

  ipcMain.handle('update-project', (_, id: string, data: any) => {
    const now = Date.now()
    const fields = []
    const values = []
    
    const allowedFields = ['name', 'description', 'path', 'status', 'progress', 'coverImagePath']
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    
    if (fields.length > 0) {
      fields.push('updatedAt = ?')
      values.push(now, id)
      db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    if (data.tagIds !== undefined) {
      db.prepare('DELETE FROM project_tags WHERE projectId = ?').run(id)
      const tagStmnt = db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)')
      const insertTags = db.transaction(() => {
        for (const tagId of data.tagIds) tagStmnt.run(id, tagId)
      })
      insertTags()
    }
    return true
  })

  ipcMain.handle('delete-project', (_, id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return true
  })

  // --- Statuses ---
  ipcMain.handle('get-statuses', () => {
    const statuses = db.prepare('SELECT * FROM project_statuses ORDER BY sortIndex ASC, createdAt ASC').all() as any[]
    return statuses.map(status => ({
      ...status,
      projectCount: (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE status = ?').get(status.id) as any).count
    }))
  })

  ipcMain.handle('create-status', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const maxSort = db.prepare('SELECT COALESCE(MAX(sortIndex), -1) AS maxSort FROM project_statuses').get() as any
    db.prepare('INSERT INTO project_statuses (id, name, color, sortIndex, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.color, maxSort.maxSort + 1, now, now)
    return id
  })

  ipcMain.handle('update-status', (_, id: string, data: any) => {
    const now = Date.now()
    const fields: string[] = []
    const values: any[] = []
    for (const key of ['name', 'color', 'sortIndex']) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    if (fields.length > 0) {
      fields.push('updatedAt = ?')
      values.push(now, id)
      db.prepare(`UPDATE project_statuses SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
    return true
  })

  ipcMain.handle('delete-status', (_, id: string) => {
    const statusCount = (db.prepare('SELECT COUNT(*) AS count FROM project_statuses').get() as any).count
    if (statusCount <= 1) return { ok: false, reason: '至少需要保留一个状态' }
    const projectCount = (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE status = ?').get(id) as any).count
    if (projectCount > 0) return { ok: false, reason: '仍有项目正在使用该状态' }
    db.prepare('DELETE FROM project_statuses WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('reorder-statuses', (_, orderedIds: string[]) => {
    const update = db.prepare('UPDATE project_statuses SET sortIndex = ?, updatedAt = ? WHERE id = ?')
    const now = Date.now()
    const reorder = db.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, now, id))
    })
    reorder()
    return true
  })

  ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('read-image-data-url', async (_, imagePath: string) => {
    if (!imagePath || /^(data|https?):/i.test(imagePath)) return imagePath || null
    const ext = path.extname(imagePath).toLowerCase()
    const mime = imageMimeTypes[ext]
    if (!mime) return null
    try {
      const data = await fs.readFile(imagePath)
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  // --- Project Commits ---
  ipcMain.handle('get-commits', (_, projectId: string) => {
    return (db.prepare('SELECT * FROM project_commits WHERE projectId = ? ORDER BY createdAt DESC').all(projectId) as any[]).map(hydrateCommit)
  })

  ipcMain.handle('create-commit', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare(`
      INSERT INTO project_commits (id, projectId, title, description, progressDelta, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.projectId, data.title, data.description || '', data.progressDelta || 0, now, now)
    if (data.imagePath) {
      db.prepare('INSERT INTO commit_images (id, commitId, imagePath, caption, sortIndex, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), id, data.imagePath, '', 0, now)
    }
    db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, data.projectId)
    return id
  })

  ipcMain.handle('update-commit', (_, id: string, data: any) => {
    const now = Date.now()
    const fields: string[] = []
    const values: any[] = []
    for (const key of ['title', 'description', 'progressDelta']) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    if (fields.length > 0) {
      fields.push('updatedAt = ?')
      values.push(now, id)
      db.prepare(`UPDATE project_commits SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      const commit = db.prepare('SELECT projectId FROM project_commits WHERE id = ?').get(id) as any
      if (commit) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, commit.projectId)
    }
    return true
  })

  ipcMain.handle('delete-commit', (_, id: string) => {
    const commit = db.prepare('SELECT projectId FROM project_commits WHERE id = ?').get(id) as any
    db.prepare('DELETE FROM project_commits WHERE id = ?').run(id)
    if (commit) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(Date.now(), commit.projectId)
    return true
  })

  ipcMain.handle('add-commit-image', (_, commitId: string, imagePath: string, caption = '') => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const maxSort = db.prepare('SELECT COALESCE(MAX(sortIndex), -1) AS maxSort FROM commit_images WHERE commitId = ?').get(commitId) as any
    db.prepare('INSERT INTO commit_images (id, commitId, imagePath, caption, sortIndex, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, commitId, imagePath, caption, maxSort.maxSort + 1, now)
    const commit = db.prepare('SELECT projectId FROM project_commits WHERE id = ?').get(commitId) as any
    if (commit) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(now, commit.projectId)
    return id
  })

  ipcMain.handle('delete-commit-image', (_, id: string) => {
    const image = db.prepare(`
      SELECT pc.projectId FROM commit_images ci
      JOIN project_commits pc ON ci.commitId = pc.id
      WHERE ci.id = ?
    `).get(id) as any
    db.prepare('DELETE FROM commit_images WHERE id = ?').run(id)
    if (image) db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(Date.now(), image.projectId)
    return true
  })

  // --- Tags ---
  ipcMain.handle('get-tags', () => {
    return db.prepare('SELECT * FROM tags ORDER BY createdAt DESC').all()
  })

  ipcMain.handle('create-tag', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      .run(id, data.name, data.color, now)
    return id
  })

  ipcMain.handle('update-tag', (_, id: string, data: any) => {
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(data.name, data.color, id)
    return true
  })

  ipcMain.handle('delete-tag', (_, id: string) => {
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
    return true
  })

  // --- NoteBlocks ---
  ipcMain.handle('create-noteblock', (_, projectId: string, content: string) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO noteblocks (id, projectId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, projectId, content, now, now)
    return id
  })

  ipcMain.handle('update-noteblock', (_, id: string, content: string) => {
    const now = Date.now()
    db.prepare('UPDATE noteblocks SET content = ?, updatedAt = ? WHERE id = ?').run(content, now, id)
    return true
  })

  ipcMain.handle('delete-noteblock', (_, id: string) => {
    db.prepare('DELETE FROM noteblocks WHERE id = ?').run(id)
    return true
  })

  // --- Todos ---
  ipcMain.handle('create-todo', (_, projectId: string, content: string) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO todos (id, projectId, content, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, content, 0, now, now)
    return id
  })

  ipcMain.handle('update-todo', (_, id: string, data: any) => {
    const now = Date.now()
    if (data.content !== undefined && data.completed !== undefined) {
      db.prepare('UPDATE todos SET content = ?, completed = ?, updatedAt = ? WHERE id = ?').run(data.content, data.completed ? 1 : 0, now, id)
    } else if (data.content !== undefined) {
      db.prepare('UPDATE todos SET content = ?, updatedAt = ? WHERE id = ?').run(data.content, now, id)
    } else if (data.completed !== undefined) {
      db.prepare('UPDATE todos SET completed = ?, updatedAt = ? WHERE id = ?').run(data.completed ? 1 : 0, now, id)
    }
    return true
  })

  ipcMain.handle('delete-todo', (_, id: string) => {
    db.prepare('DELETE FROM todos WHERE id = ?').run(id)
    return true
  })
}
