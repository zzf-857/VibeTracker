import { useCallback, useEffect, useState } from 'react'
import { History, Save, Sparkles } from 'lucide-react'
import type { AiRules } from '../../types'
import { useNotifications } from '../../lib/notifications'

export function AiRulesPanel({ projectId }: { projectId: string }) {
  const [rules, setRules] = useState<AiRules | null>(null)
  const [history, setHistory] = useState<AiRules[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const { notify } = useNotifications()
  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [current, versions] = await Promise.all([window.vibe.ai.getRules(projectId), window.vibe.ai.listRules(projectId)])
      setRules(current)
      setHistory(versions)
      setSelectedVersion(versions[0] ? String(versions[0].version) : '')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      notify({ tone: 'error', title: 'AI 规则加载失败', detail: message })
    }
  }, [projectId, notify])
  useEffect(() => { void load() }, [load])
  if (!rules && loadError) return <div className="rounded-xl border border-accent-red/25 bg-accent-red/[0.06] p-5 text-sm"><p className="text-accent-red">AI 规则加载失败</p><p className="text-xs text-text-tertiary mt-2 break-words">{loadError}</p><button onClick={() => void load()} className="mt-3 h-8 px-3 rounded-lg border border-border-subtle text-xs">重试加载</button></div>
  if (!rules) return <div className="rounded-xl border border-border-subtle p-5 text-sm text-text-tertiary">正在加载 AI 规则…</div>
  const save = async () => {
    setSaving(true)
    try {
      const result = await window.vibe.ai.saveRules(projectId, rules)
      setRules(current => current ? { ...current, version: result.version, suggestedFromHistory: false } : current)
      setHistory(await window.vibe.ai.listRules(projectId))
      setSelectedVersion(String(result.version))
      notify({ tone: 'success', title: `AI 规则 v${result.version} 已保存` })
    } catch (error) { notify({ tone: 'error', title: 'AI 规则保存失败', detail: error instanceof Error ? error.message : String(error) }) }
    finally { setSaving(false) }
  }
  const loadVersion = () => {
    const selected = history.find(item => String(item.version) === selectedVersion)
    if (!selected) return
    setRules({ ...selected, suggestedFromHistory: false })
    notify({ tone: 'info', title: `已载入 AI 规则 v${selected.version}`, detail: '点击“保存新版本”后才会成为当前规则。' })
  }
  return <section className="rounded-xl border border-border-subtle bg-bg-secondary/55 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold flex items-center gap-2"><Sparkles size={16} />项目 AI 规则</h2><p className="text-xs text-text-tertiary mt-1">结构化、可编辑、可版本化。{rules.suggestedFromHistory ? '当前是根据历史记录给出的初始建议。' : `当前版本 v${rules.version}。`}</p></div><div className="flex flex-wrap gap-2">{history.length > 0 && <div className="flex items-center gap-1"><History size={13} className="text-text-tertiary" /><select aria-label="AI 规则历史版本" value={selectedVersion} onChange={event => setSelectedVersion(event.target.value)} className="h-9 px-2 rounded-lg bg-bg-primary border border-border-subtle text-xs">{history.map(item => <option key={item.version} value={item.version}>v{item.version}{item.version === history[0]?.version ? ' · 当前' : ''}</option>)}</select><button onClick={loadVersion} className="h-9 px-2.5 rounded-lg border border-border-subtle text-xs">载入</button></div>}<button onClick={save} disabled={saving} className="h-9 px-3 rounded-lg bg-text-primary text-primary text-xs font-semibold flex items-center gap-2 disabled:opacity-50"><Save size={13} />保存新版本</button></div></div><div className="grid md:grid-cols-2 gap-3 mt-4"><label className="text-xs text-text-secondary space-y-1.5">语言<input value={rules.language} onChange={event => setRules({ ...rules, language: event.target.value })} className="w-full h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm" /></label><label className="text-xs text-text-secondary space-y-1.5">风格<select value={rules.toneMode} onChange={event => setRules({ ...rules, toneMode: event.target.value as AiRules['toneMode'] })} className="w-full h-9 px-3 rounded-lg bg-bg-primary border border-border-subtle text-sm"><option value="historical">保持历史基调</option><option value="standardized">统一规范风格</option></select></label><label className="text-xs text-text-secondary space-y-1.5">项目简介规则<textarea value={rules.summaryGuidance} onChange={event => setRules({ ...rules, summaryGuidance: event.target.value })} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-sm resize-y" /></label><label className="text-xs text-text-secondary space-y-1.5">开发记录规则<textarea value={rules.recordGuidance} onChange={event => setRules({ ...rules, recordGuidance: event.target.value })} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-sm resize-y" /></label><label className="text-xs text-text-secondary space-y-1.5">排除路径<textarea value={rules.exclusions.join('\n')} onChange={event => setRules({ ...rules, exclusions: event.target.value.split('\n').filter(Boolean) })} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-xs font-mono resize-y" /></label><label className="text-xs text-text-secondary space-y-1.5">自定义规则<textarea value={rules.customRules.join('\n')} onChange={event => setRules({ ...rules, customRules: event.target.value.split('\n').filter(Boolean) })} className="w-full h-24 p-3 rounded-lg bg-bg-primary border border-border-subtle text-sm resize-y" /></label></div></section>
}
