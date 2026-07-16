import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'
import { TaskService } from '../electron/services/taskService.ts'
import { mergeTaskHistory } from '../src/lib/notifications.tsx'

test('background task history persists progress and recovers running tasks as retryable interruptions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-task-history-'))
  const dbPath = path.join(directory, 'tasks.db')
  const db = new DatabaseSync(dbPath)
  try {
    migrateDatabase(db, { dbPath })
    const tasks = new TaskService(db)
    tasks.upsert({
      id: 'task-running', kind: 'assets-migrate', projectId: '', status: 'running', detail: '复制中',
      progress: 35, canRetry: false, createdAt: 10, updatedAt: 20,
    }, { targetDirectory: 'C:/shots' })
    tasks.upsert({
      id: 'task-completed', kind: 'git-sync', projectId: 'project-1', status: 'completed', detail: '完成',
      progress: 100, canRetry: false, createdAt: 11, updatedAt: 21,
    })

    assert.equal(tasks.recoverInterrupted(30), 1)
    const recovered = tasks.get('task-running')
    assert.equal(recovered?.task.status, 'interrupted')
    assert.equal(recovered?.task.canRetry, true)
    assert.equal(recovered?.task.progress, 35)
    assert.equal(recovered?.task.createdAt, 10)
    assert.equal(recovered?.context.targetDirectory, 'C:/shots')
    assert.match(recovered?.task.detail || '', /已标记为中断/)
    assert.deepEqual(tasks.list().map(task => task.id), ['task-running', 'task-completed'])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('renderer task hydration merges persisted history with newer live events without duplicates', () => {
  const persisted = { id: 'task-1', kind: 'git-sync', projectId: 'project-1', status: 'interrupted' as const, detail: '旧状态', canRetry: true, createdAt: 1, updatedAt: 2 }
  const live = { ...persisted, status: 'completed' as const, detail: '完成', canRetry: false, updatedAt: 3 }
  const other = { id: 'task-2', kind: 'ai-generate', projectId: 'project-1', status: 'failed' as const, detail: '失败', canRetry: true, createdAt: 1, updatedAt: 4 }
  assert.deepEqual(mergeTaskHistory([live], [persisted, other]).map(task => [task.id, task.status]), [
    ['task-2', 'failed'],
    ['task-1', 'completed'],
  ])
  assert.deepEqual(mergeTaskHistory([persisted], [live]).map(task => task.status), ['completed'])
})
