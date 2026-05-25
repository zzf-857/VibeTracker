import { ipcMain } from 'electron'
import db from './database'

export function setupIpcHandlers() {
  // --- Projects ---
  ipcMain.handle('get-projects', () => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC').all()
    for (const p of projects as any[]) {
      const tags = db.prepare(`
        SELECT t.* FROM tags t 
        JOIN project_tags pt ON t.id = pt.tagId 
        WHERE pt.projectId = ?
      `).all(p.id)
      p.tags = tags
    }
    return projects
  })

  ipcMain.handle('get-project', (_, id: string) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    if (!project) return null
    project.tags = db.prepare(`SELECT t.* FROM tags t JOIN project_tags pt ON t.id = pt.tagId WHERE pt.projectId = ?`).all(id)
    project.noteblocks = db.prepare('SELECT * FROM noteblocks WHERE projectId = ? ORDER BY updatedAt DESC').all(id)
    project.todos = db.prepare('SELECT * FROM todos WHERE projectId = ? ORDER BY createdAt ASC').all(id)
    return project
  })

  ipcMain.handle('create-project', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const stmnt = db.prepare(`
      INSERT INTO projects (id, name, description, path, status, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmnt.run(id, data.name, data.description || '', data.path || '', data.status || 'developing', data.progress || 0, now, now)
    
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
    
    const allowedFields = ['name', 'description', 'path', 'status', 'progress']
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
