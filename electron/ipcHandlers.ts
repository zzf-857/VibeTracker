import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import db from './database'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseService } from './services/databaseService'
import { AssetService } from './services/assetService'
import { SettingsService } from './services/settingsService'
import type { SqliteDatabase } from './services/databaseMigrations'
import { authorizeAssetPaths, isAssetPathAllowed } from './services/assetPolicy'

const imageMimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

/**
 * 安全包裹 IPC handler，统一捕获异常并返回结构化错误信息。
 * 对于 invoke 类的 handler，异常将以 rejected promise 的形式传到渲染进程。
 */
function safeHandle(channel: string, handler: (...args: any[]) => any) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error('拒绝来自未知窗口的 IPC 请求')
    try {
      return await handler(event, ...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[IPC:${channel}] 错误:`, message)
      throw new Error(`操作失败 (${channel}): ${message}`)
    }
  })
}

export function setupIpcHandlers() {
  const databaseService = new DatabaseService(db)
  const settingsService = new SettingsService()
  const assetService = new AssetService(db as unknown as SqliteDatabase, settingsService)
  // --- Projects ---
  safeHandle('get-projects', () => {
    return databaseService.getProjectSummaries()
  })

  safeHandle('get-project', (_, id: string) => {
    return databaseService.getProject(id)
  })

  safeHandle('create-project', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const defaultStatus = (db.prepare('SELECT id FROM project_statuses ORDER BY sortIndex ASC LIMIT 1').get() as any)?.id || 'status-developing'

    const createProjectTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, description, path, status, progress, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.name, data.description || '', data.path || '', data.status || defaultStatus, data.progress || 0, now, now)
      
      if (data.tagIds && Array.isArray(data.tagIds)) {
        const tagStmnt = db.prepare('INSERT INTO project_tags (projectId, tagId) VALUES (?, ?)')
        for (const tagId of data.tagIds) tagStmnt.run(id, tagId)
      }
    })
    createProjectTx()
    return id
  })

  safeHandle('update-project', (_, id: string, data: any) => {
    const now = Date.now()
    
    const updateProjectTx = db.transaction(() => {
      const fields: string[] = []
      const values: any[] = []
      
      const allowedFields = ['name', 'description', 'path', 'status', 'progress', 'coverImagePath', 'repoUrl', 'phase', 'milestone', 'nextStep']
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
        for (const tagId of data.tagIds) tagStmnt.run(id, tagId)
      }
    })
    updateProjectTx()
    return true
  })

  safeHandle('delete-project', async (_, id: string) => {
    await assetService.deleteProject(id)
    return true
  })

  safeHandle('select-image', async (_, allowMultiple = false) => {
    const result = await dialog.showOpenDialog({
      properties: allowMultiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
      ]
    })
    if (result.canceled) return null
    authorizeAssetPaths(result.filePaths)
    return allowMultiple ? result.filePaths : result.filePaths[0]
  })

  safeHandle('save-image-data', async (_, base64Data: string, fileName: string) => {
    return assetService.saveImageData(base64Data, fileName)
  })

  safeHandle('open-local-path', async (_, localPath: string) => {
    if (!localPath) return { ok: false, reason: '缺少本地路径' }
    const result = await shell.openPath(localPath)
    return result ? { ok: false, reason: result } : { ok: true }
  })

  safeHandle('open-external-url', async (_, url: string) => {
    if (!/^https?:\/\//i.test(url || '')) return { ok: false, reason: '链接必须以 http:// 或 https:// 开头' }
    await shell.openExternal(url)
    return { ok: true }
  })

  safeHandle('read-image-data-url', async (_, imagePath: string) => {
    if (!imagePath || /^(data|https?):/i.test(imagePath)) return imagePath || null
    const ext = path.extname(imagePath).toLowerCase()
    const mime = imageMimeTypes[ext]
    if (!mime) return null
    if (!isAssetPathAllowed(db, imagePath)) return null
    try {
      const data = await fs.readFile(imagePath)
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  // --- Project Commits ---
  safeHandle('get-commits', (_, projectId: string) => {
    return databaseService.getRecordsPage(projectId, { limit: 100 }).items
  })

  safeHandle('create-commit', (_, data: any) => {
    const paths = [data.imagePath, ...(Array.isArray(data.imagePaths) ? data.imagePaths : [])]
      .filter((item, index, values) => typeof item === 'string' && item && values.indexOf(item) === index)
    const id = databaseService.createManualRecord({
      projectId: data.projectId,
      title: data.title,
      description: data.description || '',
      progressDelta: data.progressDelta || 0,
      imagePaths: paths,
      createdAt: data.createdAt ? Number(data.createdAt) : undefined,
    })
    paths.forEach(imagePath => assetService.attachToRecord(imagePath, data.projectId, id))
    return id
  })

  safeHandle('update-commit', (_, id: string, data: any) => {
    databaseService.updateRecord(id, data)
    return true
  })

  safeHandle('delete-commit', async (_, id: string) => {
    await assetService.deleteRecord(id)
    return true
  })

  safeHandle('add-commit-image', (_, commitId: string, imagePath: string, caption = '') => {
    return databaseService.addRecordImage(commitId, imagePath, caption)
  })

  safeHandle('delete-commit-image', async (_, id: string) => {
    await assetService.deleteRecordImage(id)
    return true
  })

  // --- Tags ---
  safeHandle('get-tags', () => {
    return db.prepare('SELECT * FROM tags ORDER BY createdAt DESC').all()
  })

  safeHandle('create-tag', (_, data: any) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)')
      .run(id, data.name, data.color, now)
    return id
  })

  safeHandle('update-tag', (_, id: string, data: any) => {
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(data.name, data.color, id)
    return true
  })

  safeHandle('delete-tag', (_, id: string) => {
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
    return true
  })

  // --- NoteBlocks ---
  safeHandle('create-noteblock', (_, projectId: string, content: string) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO noteblocks (id, projectId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, projectId, content, now, now)
    return id
  })

  safeHandle('update-noteblock', (_, id: string, content: string) => {
    const now = Date.now()
    db.prepare('UPDATE noteblocks SET content = ?, updatedAt = ? WHERE id = ?').run(content, now, id)
    return true
  })

  safeHandle('delete-noteblock', (_, id: string) => {
    db.prepare('DELETE FROM noteblocks WHERE id = ?').run(id)
    return true
  })

  // --- Todos ---
  safeHandle('create-todo', (_, projectId: string, content: string) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO todos (id, projectId, content, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, content, 0, now, now)
    return id
  })

  safeHandle('update-todo', (_, id: string, data: any) => {
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

  safeHandle('delete-todo', (_, id: string) => {
    db.prepare('DELETE FROM todos WHERE id = ?').run(id)
    return true
  })
}
