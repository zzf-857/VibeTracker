import { useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, KeyRound, Loader2, Pencil, Plus, Save, Tags, Trash2, X } from 'lucide-react'
import type { PublicAppSettings } from '../types'
import { useStore } from '../lib/store'
import { useNotifications } from '../lib/notifications'

export function HubSettingsPanel({ mode = 'all' }: { mode?: 'all' | 'ai' | 'tags' }) {
  const { tags, refresh } = useStore()
  const { notify } = useNotifications()
  const [settings, setSettings] = useState<PublicAppSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [loadError, setLoadError] = useState('')
  const [editingTagId, setEditingTagId] = useState('')
  const [editingTagName, setEditingTagName] = useState('')
  const [editingTagColor, setEditingTagColor] = useState('#74A9FF')
  const [tagBusy, setTagBusy] = useState('')
  const tagBusyRef = useRef(false)

  useEffect(() => { void window.vibe.settings.get().then(setSettings).catch(error => setLoadError(error instanceof Error ? error.message : String(error))) }, [])
  if (mode !== 'tags' && !settings && loadError) return <div className="h-48 rounded-xl border border-accent-red/25 bg-bg-secondary/50 grid place-items-center text-center p-5"><div><p className="text-sm text-accent-red">LLM 设置加载失败</p><p className="text-xs text-text-tertiary mt-2 break-words">{loadError}</p><button onClick={() => { setLoadError(''); void window.vibe.settings.get().then(setSettings).catch(error => setLoadError(error instanceof Error ? error.message : String(error))) }} className="mt-3 h-8 px-3 rounded-lg border border-border-subtle text-xs">重试</button></div></div>
  if (mode !== 'tags' && !settings) return <div className="h-48 rounded-xl border border-border-subtle bg-bg-secondary/50 grid place-items-center"><Loader2 className="animate-spin text-text-tertiary" /></div>

  const updateLlm = <K extends keyof PublicAppSettings['llm']>(key: K, value: PublicAppSettings['llm'][K]) => {
    setSettings(current => current ? { ...current, llm: { ...current.llm, [key]: value } } : current)
  }
  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const result = await window.vibe.settings.update({
        llm: {
          baseUrl: settings.llm.baseUrl,
          model: settings.llm.model,
          defaultLanguage: settings.llm.defaultLanguage,
          logGranularity: settings.llm.logGranularity,
          toneMode: settings.llm.toneMode,
          excludedPaths: settings.llm.excludedPaths,
          customRules: settings.llm.customRules,
          ...(apiKey ? { apiKey } : {}),
        },
      })
      setSettings(result)
      setApiKey('')
      notify({ tone: 'success', title: 'LLM 设置已保存' })
    } catch (error) {
      notify({ tone: 'error', title: '设置保存失败', detail: error instanceof Error ? error.message : String(error) })
    } finally { setSaving(false) }
  }
  const testConnection = async () => {
    if (!settings) return
    setTesting(true)
    try {
      const result = await window.vibe.settings.testLlm({
        baseUrl: settings.llm.baseUrl,
        model: settings.llm.model,
        ...(apiKey ? { apiKey } : {}),
      })
      const endpoint = result.responseType === 'chat' ? '聊天端点' : result.responseType === 'models' ? '模型列表' : '兼容端点'
      notify({ tone: 'success', title: '连接成功', detail: `${result.model} · ${endpoint}；设置尚未保存` })
    } catch (error) {
      notify({ tone: 'error', title: '连接测试失败', detail: error instanceof Error ? error.message : String(error) })
    } finally { setTesting(false) }
  }
  const clearApiKey = async () => {
    setSaving(true)
    try {
      const next = await window.vibe.settings.update({ llm: { apiKey: '' } })
      setSettings(next)
      setApiKey('')
      notify({ tone: 'success', title: 'API Key 已从系统安全存储中清除' })
    } catch (error) {
      notify({ tone: 'error', title: 'API Key 清除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally { setSaving(false) }
  }
  const createTag = async () => {
    if (!newTag.trim() || tagBusyRef.current) return
    tagBusyRef.current = true
    setTagBusy('create')
    try {
      await window.vibe.taxonomy.createTag({ name: newTag.trim(), color: '#74A9FF' })
      setNewTag('')
      await refresh()
    } catch (error) { notify({ tone: 'error', title: '标签创建失败', detail: error instanceof Error ? error.message : String(error) }) }
    finally { tagBusyRef.current = false; setTagBusy('') }
  }
  const saveTag = async () => {
    if (!editingTagId || !editingTagName.trim() || tagBusyRef.current) return
    tagBusyRef.current = true
    setTagBusy(editingTagId)
    try {
      await window.vibe.taxonomy.updateTag(editingTagId, { name: editingTagName.trim(), color: editingTagColor })
      setEditingTagId('')
      await refresh()
      notify({ tone: 'success', title: '标签已更新' })
    } catch (error) { notify({ tone: 'error', title: '标签更新失败', detail: error instanceof Error ? error.message : String(error) }) }
    finally { tagBusyRef.current = false; setTagBusy('') }
  }
  const deleteTag = async (tagId: string) => {
    if (tagBusyRef.current) return
    tagBusyRef.current = true
    setTagBusy(tagId)
    try {
      await window.vibe.taxonomy.deleteTag(tagId)
      await refresh()
    } catch (error) {
      notify({ tone: 'error', title: '标签删除失败', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      tagBusyRef.current = false
      setTagBusy('')
    }
  }

  return (
    <div className={mode === 'all' ? 'grid xl:grid-cols-[1.4fr_0.6fr] gap-4' : 'block'}>
      {mode !== 'tags' && settings && <section className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold flex items-center gap-2"><Bot size={17} />AI 服务</h2><p className="text-xs text-text-tertiary mt-1">兼容 OpenAI API。API Key 使用系统安全存储，不写入配置或数据库。</p></div>{settings.llm.hasApiKey && <span className="text-[11px] text-status-completed flex items-center gap-1"><CheckCircle2 size={13} />已保存密钥</span>}</div>
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <label className="text-xs text-text-secondary space-y-1.5">Base URL<input value={settings.llm.baseUrl} onChange={event => updateLlm('baseUrl', event.target.value)} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" /></label>
          <label className="text-xs text-text-secondary space-y-1.5">Model<input value={settings.llm.model} onChange={event => updateLlm('model', event.target.value)} placeholder="例如 gpt-5-mini" className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" /></label>
          <label className="text-xs text-text-secondary space-y-1.5">API Key<span className="relative block"><KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" /><input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={settings.llm.hasApiKey ? '留空则保留现有密钥' : '输入 API Key'} className="w-full h-10 pl-9 pr-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue" /></span></label>
          <label className="text-xs text-text-secondary space-y-1.5">默认语言<select value={settings.llm.defaultLanguage} onChange={event => updateLlm('defaultLanguage', event.target.value)} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
        </div>
        <details className="group mt-4 rounded-lg border border-border-subtle bg-bg-primary/35">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs text-text-secondary flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue">
            <span>生成与日志规则</span>
            <span className="text-[10px] text-text-tertiary group-open:hidden">按需展开</span>
            <span className="hidden text-[10px] text-text-tertiary group-open:inline">收起</span>
          </summary>
          <div className="border-t border-border-subtle p-3">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary space-y-1.5">日志粒度<select value={settings.llm.logGranularity} onChange={event => updateLlm('logGranularity', event.target.value as PublicAppSettings['llm']['logGranularity'])} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm"><option value="minimal">最少</option><option value="normal">标准</option><option value="detailed">详细</option></select></label>
              <label className="text-xs text-text-secondary space-y-1.5">风格模式<select value={settings.llm.toneMode} onChange={event => updateLlm('toneMode', event.target.value as PublicAppSettings['llm']['toneMode'])} className="w-full h-10 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm"><option value="historical">保持历史基调</option><option value="standardized">统一规范风格</option></select></label>
              <label className="text-xs text-text-secondary space-y-1.5">排除路径（每行一条）<textarea value={settings.llm.excludedPaths.join('\n')} onChange={event => updateLlm('excludedPaths', event.target.value.split('\n'))} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-xs font-mono resize-y outline-none focus:border-accent-blue" /></label>
              <label className="text-xs text-text-secondary space-y-1.5">全局生成规则（每行一条）<textarea value={settings.llm.customRules.join('\n')} onChange={event => updateLlm('customRules', event.target.value.split('\n'))} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-xs resize-y outline-none focus:border-accent-blue" /></label>
            </div>
          </div>
        </details>
        <div className="flex flex-wrap justify-end gap-2 mt-4">{settings.llm.hasApiKey && <button onClick={clearApiKey} disabled={testing || saving} className="h-9 px-3 rounded-lg border border-accent-red/25 text-sm text-accent-red disabled:opacity-50">清除密钥</button>}<button onClick={testConnection} disabled={testing || saving} className="h-9 px-4 rounded-lg border border-border-subtle text-sm text-text-secondary disabled:opacity-50">{testing ? '测试中…' : '测试连接'}</button><button onClick={save} disabled={saving || testing} className="h-9 px-4 rounded-lg bg-text-primary text-primary text-sm font-semibold disabled:opacity-50">{saving ? '保存中…' : '保存设置'}</button></div>
      </section>}

      {mode !== 'ai' && <section id="taxonomy" className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-5">
        <h2 className="font-semibold flex items-center gap-2"><Tags size={17} />标签</h2><p className="text-xs text-text-tertiary mt-1">状态和标签统一在设置中维护。</p>
        <div className="flex gap-2 mt-4"><input value={newTag} disabled={Boolean(tagBusy)} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createTag() }} placeholder="新标签" className="min-w-0 flex-1 h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm outline-none focus:border-accent-blue disabled:opacity-50" /><button aria-label="创建标签" disabled={Boolean(tagBusy) || !newTag.trim()} onClick={() => void createTag()} className="w-9 h-9 rounded-lg bg-text-primary text-primary grid place-items-center disabled:opacity-40">{tagBusy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}</button></div>
        <div className="mt-3 space-y-1 max-h-72 overflow-auto">{tags.map(tag => <div key={tag.id} className="min-h-10 px-2 py-1.5 flex items-center gap-2 rounded-lg hover:bg-bg-tertiary/50">{editingTagId === tag.id ? <><input type="color" aria-label="标签颜色" disabled={Boolean(tagBusy)} value={editingTagColor} onChange={event => setEditingTagColor(event.target.value)} className="w-7 h-7 rounded bg-transparent disabled:opacity-40" /><input autoFocus disabled={Boolean(tagBusy)} value={editingTagName} onChange={event => setEditingTagName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveTag(); if (event.key === 'Escape' && !tagBusy) setEditingTagId('') }} className="min-w-0 flex-1 h-8 px-2 rounded-md bg-bg-primary border border-border-subtle text-sm disabled:opacity-50" /><button aria-label="取消编辑标签" disabled={Boolean(tagBusy)} onClick={() => setEditingTagId('')} className="w-7 h-7 grid place-items-center text-text-tertiary disabled:opacity-40"><X size={13} /></button><button aria-label="保存标签" disabled={Boolean(tagBusy) || !editingTagName.trim()} onClick={() => void saveTag()} className="w-7 h-7 grid place-items-center text-accent-blue disabled:opacity-40">{tagBusy === tag.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}</button></> : <><span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} /><span className="text-sm flex-1 truncate">{tag.name}</span><button aria-label={`编辑标签 ${tag.name}`} disabled={Boolean(tagBusy)} onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); setEditingTagColor(tag.color) }} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-text-primary disabled:opacity-40"><Pencil size={13} /></button><button aria-label={`删除标签 ${tag.name}`} disabled={Boolean(tagBusy)} onClick={() => void deleteTag(tag.id)} className="w-7 h-7 grid place-items-center text-text-tertiary hover:text-accent-red disabled:opacity-40">{tagBusy === tag.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button></>}</div>)}</div>
      </section>}
    </div>
  )
}
