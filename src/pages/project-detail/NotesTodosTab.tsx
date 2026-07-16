import { useRef, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import type { NoteBlock, Project, Todo } from '../../types'
import { useNotifications } from '../../lib/notifications'

export function NotesTodosTab({ project, onReload }: { project: Project; onReload: () => Promise<void> }) {
  const [note, setNote] = useState('')
  const [todo, setTodo] = useState('')
  const [creatingNote, setCreatingNote] = useState(false)
  const [creatingTodo, setCreatingTodo] = useState(false)
  const creatingNoteRef = useRef(false)
  const creatingTodoRef = useRef(false)
  const { notify } = useNotifications()
  const act = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action()
      await onReload()
      if (success) notify({ tone: 'success', title: success })
      return true
    } catch (error) {
      notify({ tone: 'error', title: '操作失败', detail: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
  const createNote = async () => {
    const content = note.trim()
    if (!content || creatingNoteRef.current) return
    creatingNoteRef.current = true
    setCreatingNote(true)
    try {
      await window.vibe.notes.create(project.id, content)
      setNote('')
      await onReload()
      notify({ tone: 'success', title: '备注已添加' })
    } catch (error) {
      notify({ tone: 'error', title: '备注添加失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      creatingNoteRef.current = false
      setCreatingNote(false)
    }
  }
  const createTodo = async () => {
    const content = todo.trim()
    if (!content || creatingTodoRef.current) return
    creatingTodoRef.current = true
    setCreatingTodo(true)
    try {
      await window.vibe.todos.create(project.id, content)
      setTodo('')
      await onReload()
      notify({ tone: 'success', title: '待办已添加' })
    } catch (error) {
      notify({ tone: 'error', title: '待办添加失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      creatingTodoRef.current = false
      setCreatingTodo(false)
    }
  }

  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
        <h2 className="font-semibold">备注</h2>
        <p className="text-xs text-text-tertiary mt-1">记录上下文、决策和稍后要查的资料。</p>
        <div className="flex gap-2 mt-4">
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            disabled={creatingNote}
            onKeyDown={event => { if (event.key === 'Enter') void createNote() }}
            aria-label="新备注内容"
            placeholder="添加备注"
            className="min-w-0 flex-1 h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue"
          />
          <button aria-label="添加备注" disabled={creatingNote || !note.trim()} onClick={() => void createNote()} className="w-10 h-10 rounded-lg bg-text-primary text-primary grid place-items-center disabled:opacity-40">{creatingNote ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}</button>
        </div>
        <div className="space-y-2 mt-4">
          {project.noteblocks?.map(item => (
            <NoteRow
              key={item.id}
              note={item}
              onSave={content => act(() => window.vibe.notes.update(item.id, content), '备注已更新')}
              onDelete={() => act(() => window.vibe.notes.delete(item.id), '备注已删除')}
            />
          ))}
          {!project.noteblocks?.length && <p className="text-sm text-text-tertiary py-10 text-center">暂无备注</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5">
        <h2 className="font-semibold">待办</h2>
        <p className="text-xs text-text-tertiary mt-1">只保留真正的下一步，不用伪精确百分比。</p>
        <div className="flex gap-2 mt-4">
          <input
            value={todo}
            onChange={event => setTodo(event.target.value)}
            disabled={creatingTodo}
            onKeyDown={event => { if (event.key === 'Enter') void createTodo() }}
            aria-label="新待办内容"
            placeholder="添加下一项行动"
            className="min-w-0 flex-1 h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue"
          />
          <button aria-label="添加待办" disabled={creatingTodo || !todo.trim()} onClick={() => void createTodo()} className="w-10 h-10 rounded-lg bg-text-primary text-primary grid place-items-center disabled:opacity-40">{creatingTodo ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}</button>
        </div>
        <div className="space-y-1 mt-4">
          {project.todos?.map(item => (
            <TodoRow
              key={item.id}
              todo={item}
              onToggle={() => act(() => window.vibe.todos.update(item.id, { completed: !item.completed }))}
              onSave={content => act(() => window.vibe.todos.update(item.id, { content }), '待办已更新')}
              onDelete={() => act(() => window.vibe.todos.delete(item.id), '待办已删除')}
            />
          ))}
          {!project.todos?.length && <p className="text-sm text-text-tertiary py-10 text-center">暂无待办</p>}
        </div>
      </section>
    </div>
  )
}

function NoteRow({
  note,
  onSave,
  onDelete,
}: {
  note: NoteBlock
  onSave: (content: string) => Promise<boolean>
  onDelete: () => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(note.content)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const next = content.trim()
    if (!next) return
    setBusy(true)
    if (await onSave(next)) setEditing(false)
    setBusy(false)
  }
  const cancel = () => {
    setContent(note.content)
    setEditing(false)
  }
  const remove = async () => {
    if (busy) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }
  if (editing) {
    return (
      <div className="rounded-lg bg-bg-primary/60 p-3">
        <textarea
          autoFocus
          aria-label="编辑备注内容"
          value={content}
          onChange={event => setContent(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') cancel()
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save()
          }}
          className="w-full min-h-20 p-2 rounded-lg bg-bg-secondary border border-border-subtle text-sm text-text-secondary resize-y outline-none focus:border-accent-blue"
        />
        <div className="mt-2 flex justify-end gap-1">
          <button aria-label="取消编辑备注" disabled={busy} onClick={cancel} className="w-8 h-8 grid place-items-center text-text-tertiary"><X size={14} /></button>
          <button aria-label="保存备注" disabled={busy || !content.trim()} onClick={() => void save()} className="w-8 h-8 grid place-items-center text-accent-blue disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-lg bg-bg-primary/60 p-3 flex gap-2">
      <p className="text-sm text-text-secondary leading-6 flex-1 whitespace-pre-wrap">{note.content}</p>
      <button aria-label="编辑备注" disabled={busy} onClick={() => { setContent(note.content); setEditing(true) }} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><Pencil size={13} /></button>
      <button aria-label="删除备注" disabled={busy} onClick={() => void remove()} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-accent-red disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
    </div>
  )
}

function TodoRow({
  todo,
  onToggle,
  onSave,
  onDelete,
}: {
  todo: Todo
  onToggle: () => Promise<boolean>
  onSave: (content: string) => Promise<boolean>
  onDelete: () => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(todo.content)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const next = content.trim()
    if (!next) return
    setBusy(true)
    if (await onSave(next)) setEditing(false)
    setBusy(false)
  }
  const cancel = () => {
    setContent(todo.content)
    setEditing(false)
  }
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    await onToggle()
    setBusy(false)
  }
  const remove = async () => {
    if (busy) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }
  return (
    <div className="min-h-11 px-2 rounded-lg flex items-center gap-2 hover:bg-bg-primary/50">
      <button disabled={busy} onClick={() => void toggle()} aria-label={todo.completed ? '标记为未完成' : '标记为完成'} className={`w-5 h-5 rounded-md border grid place-items-center flex-shrink-0 disabled:opacity-40 ${todo.completed ? 'bg-status-completed border-status-completed text-primary' : 'border-border-primary'}`}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : Boolean(todo.completed) && <Check size={13} />}
      </button>
      {editing ? (
        <input
          autoFocus
          aria-label="编辑待办内容"
          value={content}
          onChange={event => setContent(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') cancel()
            if (event.key === 'Enter') void save()
          }}
          className="min-w-0 flex-1 h-8 px-2 rounded-md bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue"
        />
      ) : (
        <span className={`text-sm flex-1 ${todo.completed ? 'line-through text-text-tertiary' : 'text-text-secondary'}`}>{todo.content}</span>
      )}
      {editing ? <>
        <button aria-label="取消编辑待办" disabled={busy} onClick={cancel} className="w-7 h-7 grid place-items-center text-text-tertiary"><X size={13} /></button>
        <button aria-label="保存待办" disabled={busy || !content.trim()} onClick={() => void save()} className="w-7 h-7 grid place-items-center text-accent-blue disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}</button>
      </> : <>
        <button aria-label="编辑待办" disabled={busy} onClick={() => { setContent(todo.content); setEditing(true) }} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><Pencil size={13} /></button>
        <button disabled={busy} onClick={() => void remove()} aria-label="删除待办" className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-accent-red disabled:opacity-40"><Trash2 size={13} /></button>
      </>}
    </div>
  )
}
