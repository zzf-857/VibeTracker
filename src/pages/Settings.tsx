import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Download, Folder, GripVertical, Palette, Plus, Power, RefreshCcw, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { AnimatedPage } from '../components/AnimatedPage'
import { AppVersionInfo, ProjectStatus, UpdateMessagePayload, UpdateStatus } from '../types'
import { validateStatusName } from '../lib/statusValidation'
import { Skeleton } from '../components/Skeleton'
import { useStore } from '../lib/store'
import { HubSettingsPanel } from '../components/HubSettingsPanel'


const COLORS = ['#74A9FF', '#63D693', '#F3BB6C', '#B8A6FF', '#A8B0BD', '#FF6B6B']
type SettingsSection = 'ai' | 'taxonomy' | 'app'
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'ai', label: 'AI 与生成', description: '配置模型连接和全局生成规则；项目级规则仍在各项目设置中维护。' },
  { id: 'taxonomy', label: '状态与标签', description: '维护画廊与详情页共同使用的项目分类。' },
  { id: 'app', label: '存储与更新', description: '管理托管截图目录、版本信息和应用更新。' },
]

function formatStatusError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return detail.trim() ? `${fallback}：${detail.trim()}` : fallback
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col min-h-full w-full py-8 px-10 gap-8 animate-pulse">
      {/* 头部 */}
      <div>
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-9 w-32 rounded-lg mt-2" />
        <Skeleton className="h-4.5 w-64 rounded mt-2" />
      </div>

      <div className="grid xl:grid-cols-[1fr_360px] gap-6">
        {/* 左侧状态列表骨架 */}
        <div className="glass-panel rounded-[32px] p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <Skeleton className="h-6 w-24 rounded" />
              <Skeleton className="h-4 w-64 rounded" />
            </div>
            <Skeleton className="w-5 h-5 rounded-full" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-bg-secondary border border-border-subtle rounded-[24px] p-4 flex items-center gap-4">
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="w-3 h-3 rounded-full" />
                <Skeleton className="h-5 w-32 rounded flex-1" />
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="w-8 h-8 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        {/* 右侧创建状态骨架 */}
        <div className="glass-panel rounded-[32px] p-6 space-y-6">
          <Skeleton className="h-6 w-32 rounded" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-full rounded-2xl" />
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} className="w-6 h-6 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-10 w-full rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { statuses: storeStatuses, isLoaded, refresh } = useStore()
  const [statuses, setStatuses] = useState<ProjectStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [notice, setNotice] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [draggedStatusId, setDraggedStatusId] = useState<string | null>(null)
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const statusesRef = useRef<ProjectStatus[]>([])
  const dragStartOrderRef = useRef<ProjectStatus[]>([])
  const requestedSection = searchParams.get('section')
  const activeSection = SETTINGS_SECTIONS.some(section => section.id === requestedSection)
    ? requestedSection as SettingsSection
    : 'ai'
  const sectionDescription = SETTINGS_SECTIONS.find(section => section.id === activeSection)?.description || ''

  const selectSection = (section: SettingsSection) => {
    setPendingDeleteId(null)
    setSearchParams(section === 'ai' ? {} : { section })
  }

  const handleSectionKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tablist = event.currentTarget
    const currentIndex = SETTINGS_SECTIONS.findIndex(section => section.id === activeSection)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? SETTINGS_SECTIONS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    const next = SETTINGS_SECTIONS[nextIndex]
    selectSection(next.id)
    window.requestAnimationFrame(() => {
      tablist.querySelector<HTMLButtonElement>(`[data-settings-section="${next.id}"]`)?.focus()
    })
  }

  const [screenshotsDir, setScreenshotsDir] = useState('')
  const [screenshotsMigrating, setScreenshotsMigrating] = useState(false)
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | 'idle'>('idle')
  const [updateMessage, setUpdateMessage] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)

  useEffect(() => {
    if (isLoaded) {
      setStatuses(storeStatuses)
      setIsLoading(false)
    } else {
      refresh()
    }
  }, [isLoaded, storeStatuses, refresh])

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await window.vibe.settings.get()
      setScreenshotsDir(settings.screenshotsDirectory)
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  const applyUpdateMessage = useCallback((payload: UpdateMessagePayload) => {
    const { status, version, percent, error, isPortable } = payload
    setUpdateStatus(status)
    setUpdateError('')

    if (isPortable || status === 'portable') {
      setUpdateMessage('当前为便携版，VibeTracker 需要前往 GitHub Release 手动下载安装包。')
      return
    }

    switch (status) {
      case 'checking':
        setUpdateMessage('正在连接 GitHub 检查 VibeTracker 更新...')
        break
      case 'available':
        setUpdateMessage(`发现 VibeTracker v${version || ''}，可手动下载更新包。`)
        setDownloadPercent(0)
        break
      case 'not-available':
        setUpdateMessage('当前已是 VibeTracker 最新版本。')
        break
      case 'downloading':
        setDownloadPercent(Math.round(percent || 0))
        setUpdateMessage('正在下载 VibeTracker 更新包...')
        break
      case 'downloaded':
        setDownloadPercent(100)
        setUpdateMessage(`VibeTracker v${version || ''} 已下载完成，重启后安装。`)
        break
      case 'dev':
        setUpdateMessage('开发环境已跳过更新流程，避免覆盖本地文件。')
        break
      case 'error':
        {
          const errStr = String(error || '').toLowerCase()
          let friendlyError = error || '检查更新失败，请检查网络连接或稍后再试。'
          if (errStr.includes('404') || errStr.includes('not found') || errStr.includes('latest.yml')) {
            friendlyError = '未检测到 GitHub 上的 VibeTracker 正式发布版本。'
          }
          setUpdateError(friendlyError)
          setUpdateMessage('')
        }
        break
      default:
        break
    }
  }, [])

  useEffect(() => {
    let active = true
    window.vibe.app.getVersion()
      .then(info => {
        if (!active) return
        setAppVersionInfo(info)
        if (info.isPortable) {
          setUpdateStatus('portable')
          setUpdateMessage('当前为便携版，VibeTracker 需要前往 GitHub Release 手动下载安装包。')
        } else if (!info.isPackaged) {
          setUpdateStatus('dev')
          setUpdateMessage('开发环境不会检查或安装更新，避免覆盖本地文件。')
        }
      })
      .catch(err => {
        console.error('Failed to load app version:', err)
        if (active) {
          setUpdateError('无法读取 VibeTracker 当前版本。')
        }
      })

    const unsubscribe = window.vibe.app.onUpdateMessage(applyUpdateMessage)
    return () => {
      active = false
      unsubscribe()
    }
  }, [applyUpdateMessage])

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateMessage('正在连接 GitHub 检查 VibeTracker 更新...')
    setUpdateError('')
    try {
      const result = await window.vibe.app.checkForUpdates()
      if (!result.success && result.status !== 'dev' && result.status !== 'portable') {
        applyUpdateMessage({ status: 'error', error: result.error })
      } else if (result.status === 'dev' || result.status === 'portable') {
        applyUpdateMessage({
          status: result.status,
          error: result.error,
          isPortable: result.isPortable,
        })
      }
    } catch (error) {
      applyUpdateMessage({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const downloadUpdate = async () => {
    setUpdateStatus('downloading')
    setUpdateMessage('正在下载 VibeTracker 更新包...')
    setUpdateError('')
    setDownloadPercent(0)
    try {
      const result = await window.vibe.app.downloadUpdate()
      if (!result.success) {
        applyUpdateMessage({
          status: result.status || 'error',
          error: result.error || '下载更新失败，请稍后再试。',
          isPortable: result.isPortable,
        })
      }
    } catch (error) {
      applyUpdateMessage({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const quitAndInstallUpdate = async () => {
    try {
      const result = await window.vibe.app.quitAndInstallUpdate()
      if (!result.success) {
        setUpdateError(result.error || '当前环境不支持重启安装更新。')
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
    }
  }

  const selectScreenshotsDirectory = async () => {
    setScreenshotsMigrating(true)
    try {
      const result = await window.vibe.settings.chooseScreenshotsDirectory()
      if (!result) return
      setScreenshotsDir(result.screenshotsDirectory)
      setNotice(result.cleanupFailures.length
        ? `保存位置已更新并迁移 ${result.moved} 个托管文件；${result.cleanupFailures.length} 个旧副本将在下次启动继续清理`
        : `保存位置已更新，安全迁移了 ${result.moved} 个 VibeTracker 托管文件`)
    } catch (err) {
      console.error('Failed to select directory:', err)
      setNotice(formatStatusError(err, '更新保存位置失败'))
    } finally {
      setScreenshotsMigrating(false)
    }
  }

  const resetScreenshotsDirectory = async () => {
    setScreenshotsMigrating(true)
    try {
      const result = await window.vibe.settings.resetScreenshotsDirectory()
      setScreenshotsDir(result.screenshotsDirectory)
      setNotice(result.cleanupFailures.length
        ? `已恢复默认位置并迁移 ${result.moved} 个托管文件；${result.cleanupFailures.length} 个旧副本将在下次启动继续清理`
        : `已恢复默认位置，安全迁移了 ${result.moved} 个 VibeTracker 托管文件`)
    } catch (err) {
      console.error('Failed to reset directory:', err)
      setNotice(formatStatusError(err, '恢复默认保存位置失败'))
    } finally {
      setScreenshotsMigrating(false)
    }
  }

  useEffect(() => {
    statusesRef.current = statuses
  }, [statuses])

  const createStatus = async () => {
    const validation = validateStatusName(newName, statuses)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    try {
      await window.vibe.taxonomy.createStatus({ name: validation.value, color: newColor })
      setNewName('')
      setNotice('状态已创建')
      await refresh()
    } catch (error) {
      console.error('Failed to create status:', error)
      setNotice(formatStatusError(error, '创建状态失败'))
    }
  }

  const saveProjectStatus = async (id: string, data: Partial<ProjectStatus>) => {
    const validation = validateStatusName(data.name || '', statuses, id)
    if (!validation.ok) {
      setNotice(validation.message)
      return
    }
    try {
      await window.vibe.taxonomy.updateStatus(id, { ...data, name: validation.value })
      setNotice('状态已保存')
      await refresh()
    } catch (error) {
      console.error('Failed to update status:', error)
      setNotice(formatStatusError(error, '保存状态失败'))
    }
  }

  const requestDeleteStatus = (status: ProjectStatus) => {
    if (statuses.length <= 1) {
      setNotice('至少需要保留一个状态')
      return
    }
    if ((status.projectCount || 0) > 0) {
      setNotice(`「${status.name}」仍有项目正在使用，先把这些项目切换到其他状态。`)
      return
    }
    setNotice('')
    setPendingDeleteId(status.id)
  }

  const deleteStatus = async (status: ProjectStatus) => {
    try {
      const result = await window.vibe.taxonomy.deleteStatus(status.id)
      if (!result.ok) {
        setNotice(result.reason || '无法删除状态')
        return
      }
      setPendingDeleteId(null)
      setNotice('状态已删除')
      await refresh()
    } catch (error) {
      console.error('Failed to delete status:', error)
      setNotice(formatStatusError(error, '删除状态失败'))
    }
  }

  const moveStatus = async (id: string, direction: -1 | 1) => {
    const index = statuses.findIndex(status => status.id === id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= statuses.length) return
    const next = [...statuses]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    setIsSavingOrder(true)
    try {
      await window.vibe.taxonomy.reorderStatuses(next.map(status => status.id))
      setNotice('状态顺序已更新')
      await refresh()
    } catch (error) {
      console.error('Failed to reorder statuses:', error)
      setNotice(formatStatusError(error, '状态顺序保存失败'))
    } finally {
      setIsSavingOrder(false)
    }
  }

  const previewDraggedStatus = (dragId: string, targetId: string) => {
    if (dragId === targetId) return
    setStatuses(prev => {
      const from = prev.findIndex(status => status.id === dragId)
      const to = prev.findIndex(status => status.id === targetId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const finishDragSort = async (dragId = draggedStatusId) => {
    if (!dragId) return
    const previous = dragStartOrderRef.current
    const next = statusesRef.current
    const previousIds = previous.map(status => status.id).join(',')
    const nextIds = next.map(status => status.id).join(',')

    setDraggedStatusId(null)
    setDragOverStatusId(null)

    if (!previous.length || previousIds === nextIds) return

    setIsSavingOrder(true)
    try {
      await window.vibe.taxonomy.reorderStatuses(next.map(status => status.id))
      setNotice('状态顺序已更新')
      await refresh()
    } catch (error) {
      console.error('Failed to reorder statuses:', error)
      setStatuses(previous)
      setNotice(formatStatusError(error, '状态顺序保存失败，已恢复原顺序'))
    } finally {
      setIsSavingOrder(false)
      dragStartOrderRef.current = []
    }
  }

  const isUpdateEnvironmentBlocked = updateStatus === 'portable' || updateStatus === 'dev' || appVersionInfo?.isPortable || appVersionInfo?.isPackaged === false
  const canCheckUpdate = Boolean(appVersionInfo) && !isUpdateEnvironmentBlocked && updateStatus !== 'checking' && updateStatus !== 'downloading'
  const canDownloadUpdate = updateStatus === 'available'
  const canQuitAndInstallUpdate = updateStatus === 'downloaded'
  const versionLabel = appVersionInfo?.version ? `v${appVersionInfo.version}` : '读取中'

  if (isLoading) {
    return <SettingsSkeleton />
  }

  return (
    <AnimatedPage tone="system" className="flex flex-col min-h-full w-full px-6 py-6 lg:px-8 xl:px-10 gap-6">
      <div className="stagger-item" style={{ '--stagger': 0 } as CSSProperties}>
        <p className="text-text-tertiary text-xs mb-1.5">本地中枢偏好</p>
        <h1 className="text-3xl font-semibold tracking-normal">设置</h1>
        <p className="text-text-secondary text-sm mt-2">{sectionDescription}</p>
      </div>

      <nav role="tablist" aria-label="设置分类" onKeyDown={handleSectionKeys} className="stagger-item flex items-center gap-1 border-b border-border-subtle overflow-x-auto" style={{ '--stagger': 1 } as CSSProperties}>
        {SETTINGS_SECTIONS.map(section => (
          <button
            key={section.id}
            type="button"
            role="tab"
            data-settings-section={section.id}
            aria-selected={activeSection === section.id}
            tabIndex={activeSection === section.id ? 0 : -1}
            onClick={() => selectSection(section.id)}
            className={`h-11 px-4 border-b-2 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${activeSection === section.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className={activeSection === 'ai' ? 'block' : 'hidden'} role="tabpanel" aria-label="AI 与生成">
        <HubSettingsPanel mode="ai" />
      </div>

      <div className={activeSection === 'ai' ? 'hidden' : activeSection === 'app' ? 'grid grid-cols-1 gap-4' : 'grid xl:grid-cols-[minmax(0,1fr)_320px] gap-4'}>
        <div className="flex flex-col gap-6">
          <section className={activeSection === 'taxonomy' ? 'rounded-xl border border-border-subtle bg-bg-secondary/60 p-5 stagger-item' : 'hidden'} style={{ '--stagger': 2 } as CSSProperties}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">项目状态</h2>
              <p className="text-sm text-text-tertiary mt-1">状态名称、颜色和顺序会同步显示在项目卡片与详情页。</p>
            </div>
            <Palette size={20} className="text-text-tertiary" />
          </div>

          {notice && (
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-text-secondary">
              {notice}
            </div>
          )}

          <div className="space-y-3">
            {statuses.map((status, index) => (
              <div
                key={status.id}
                onDragOver={e => {
                  if (!draggedStatusId || draggedStatusId === status.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverStatusId(status.id)
                  previewDraggedStatus(draggedStatusId, status.id)
                }}
                onDrop={e => {
                  e.preventDefault()
                  finishDragSort()
                }}
                className={`status-row motion-card bg-bg-primary/35 border border-border-subtle rounded-xl p-3 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-3 items-center ${draggedStatusId === status.id ? 'status-row-dragging' : ''} ${dragOverStatusId === status.id ? 'status-row-drag-over' : ''}`}
              >
                <button
                  type="button"
                  draggable={!isSavingOrder}
                  title="拖动排序"
                  aria-label={`拖动排序 ${status.name}`}
                  onDragStart={e => {
                    if (isSavingOrder) return
                    dragStartOrderRef.current = statuses
                    setDraggedStatusId(status.id)
                    setPendingDeleteId(null)
                    setNotice('')
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', status.id)
                  }}
                  onDragEnd={() => finishDragSort(status.id)}
                  className="status-drag-handle motion-action h-9 w-8 rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/10 flex items-center justify-center cursor-grab active:cursor-grabbing"
                >
                  <GripVertical size={16} />
                </button>
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0 breathing-dot" style={{ backgroundColor: status.color }} />
                  <input
                    aria-label={`状态名称 ${status.name}`}
                    value={status.name}
                    onChange={e => {
                      setNotice('')
                      setPendingDeleteId(null)
                      setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, name: e.target.value } : item))
                    }}
                    className="motion-focus bg-transparent text-sm outline-none w-full min-w-0"
                  />
                  <span className="text-xs text-text-tertiary whitespace-nowrap">{status.projectCount || 0} 项目</span>
                </div>
                <label className="motion-action relative h-8 w-8 rounded-lg border border-border-subtle cursor-pointer overflow-hidden hover:border-border-primary" title="修改状态颜色">
                  <span className="absolute inset-1 rounded-md" style={{ backgroundColor: status.color }} />
                  <input
                    type="color"
                    aria-label={`修改状态颜色 ${status.name}`}
                    value={status.color}
                    onChange={e => {
                      setNotice('')
                      setPendingDeleteId(null)
                      setStatuses(prev => prev.map(item => item.id === status.id ? { ...item, color: e.target.value } : item))
                    }}
                    className="motion-focus absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0"
                  />
                </label>
                <div className="flex items-center justify-end gap-1">
                  <button type="button" title="上移" onClick={() => moveStatus(status.id, -1)} disabled={index === 0 || isSavingOrder} className="motion-action h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowUp size={15} /></button>
                  <button type="button" title="下移" onClick={() => moveStatus(status.id, 1)} disabled={index === statuses.length - 1 || isSavingOrder} className="motion-action h-8 w-8 rounded-full text-text-tertiary disabled:opacity-30 hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><ArrowDown size={15} /></button>
                  <button type="button" title="保存" onClick={() => saveProjectStatus(status.id, { name: status.name, color: status.color })} className="motion-action h-8 w-8 rounded-full text-text-tertiary hover:bg-white/10 hover:text-text-primary flex items-center justify-center"><Save size={14} /></button>
                  <button type="button" title="删除" onClick={() => requestDeleteStatus(status)} className="motion-action h-8 w-8 rounded-full text-text-tertiary hover:bg-accent-red/10 hover:text-accent-red flex items-center justify-center"><Trash2 size={14} /></button>
                </div>
                {pendingDeleteId === status.id && (
                  <div className="col-span-4 rounded-2xl border border-accent-red/25 bg-accent-red/10 px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-text-secondary">确认删除「{status.name}」？这个操作不会影响其他状态。</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => deleteStatus(status)} className="motion-action h-8 px-3 rounded-full bg-accent-red text-white text-xs font-medium flex items-center gap-1.5"><Check size={13} /> 确认</button>
                      <button type="button" onClick={() => setPendingDeleteId(null)} className="motion-action h-8 px-3 rounded-full bg-white/10 text-text-secondary text-xs font-medium flex items-center gap-1.5"><X size={13} /> 取消</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={activeSection === 'app' ? 'rounded-xl border border-border-subtle bg-bg-secondary/60 p-5 stagger-item' : 'hidden'} style={{ '--stagger': 2 } as CSSProperties}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">软件本身设置</h2>
              <p className="text-sm text-text-tertiary mt-1">配置软件的存储路径等基本偏好。</p>
            </div>
            <Folder size={20} className="text-text-tertiary" />
          </div>

            <div className="space-y-4">
              <div className="bg-bg-secondary border border-border-subtle rounded-[24px] p-5 flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold">截图保存位置</h3>
                  <p className="text-xs text-text-tertiary mt-1">新建截图会保存在这里。更改目录时只迁移 VibeTracker 创建并登记的托管文件，不移动外部原图。</p>
              </div>
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  readOnly
                  value={screenshotsDir}
                  className="flex-1 bg-bg-tertiary border border-border-subtle rounded-full px-4 py-2.5 text-xs font-mono outline-none text-text-secondary truncate"
                />
                <button
                  type="button"
                  onClick={selectScreenshotsDirectory}
                  disabled={screenshotsMigrating}
                  className="motion-action bg-bg-tertiary hover:bg-bg-secondary border border-border-subtle text-xs text-text-primary px-4 py-2.5 rounded-full whitespace-nowrap"
                >
                  {screenshotsMigrating ? '迁移中…' : '更改文件夹'}
                </button>
                <button
                  type="button"
                  onClick={resetScreenshotsDirectory}
                  disabled={screenshotsMigrating}
                  title="恢复默认路径"
                  className="motion-action bg-bg-tertiary hover:bg-bg-secondary border border-border-subtle text-xs text-text-tertiary hover:text-text-primary p-2.5 rounded-full flex items-center justify-center"
                >
                  <RotateCcw size={14} />
                  </button>
                </div>
              </div>

              <div className="bg-bg-secondary border border-border-subtle rounded-[24px] p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">版本与更新</h3>
                    <p className="text-xs text-text-tertiary mt-1">检查、下载并安装 VibeTracker 的正式发布版本。</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-bg-tertiary border border-border-subtle px-3 py-1 text-xs font-mono text-text-secondary">
                    {versionLabel}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={checkForUpdates}
                    disabled={!canCheckUpdate}
                    className="motion-action bg-bg-tertiary hover:bg-bg-secondary border border-border-subtle text-xs text-text-primary px-4 py-2.5 rounded-full whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <RefreshCcw size={14} />
                    {updateStatus === 'checking' ? '检查中' : '检查新版本'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadUpdate}
                    disabled={!canDownloadUpdate}
                    className="motion-action bg-bg-tertiary hover:bg-bg-secondary border border-border-subtle text-xs text-text-primary px-4 py-2.5 rounded-full whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Download size={14} />
                    下载更新包
                  </button>
                  <button
                    type="button"
                    onClick={quitAndInstallUpdate}
                    disabled={!canQuitAndInstallUpdate}
                    className="motion-action bg-text-primary text-primary text-xs font-medium px-4 py-2.5 rounded-full whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Power size={14} />
                    重启安装
                  </button>
                </div>

                {updateStatus === 'downloading' && (
                  <div className="space-y-2">
                    <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden border border-border-subtle">
                      <div
                        className="h-full bg-text-primary transition-all duration-200"
                        style={{ width: `${downloadPercent}%` }}
                      />
                    </div>
                    <p className="text-xs text-text-tertiary">{downloadPercent}%</p>
                  </div>
                )}

                {(updateMessage || updateError) && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                    updateError
                      ? 'border-accent-red/25 bg-accent-red/10 text-accent-red'
                      : 'border-white/10 bg-white/[0.06] text-text-secondary'
                  }`}>
                    {updateError || updateMessage}
                  </div>
                )}
              </div>
            </div>
          </section>
      </div>

      <aside className={activeSection === 'taxonomy' ? 'flex flex-col gap-4' : 'hidden'} role="tabpanel" aria-label="状态与标签">
        <HubSettingsPanel mode="tags" />
        <section className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-5 stagger-item" style={{ '--stagger': 3 } as CSSProperties}>
          <h2 className="text-lg font-semibold mb-4">新增状态</h2>
          <div className="space-y-3">
            <input value={newName} onChange={e => setNewName(e.target.value)} className="motion-focus w-full bg-bg-secondary border border-border-subtle rounded-2xl px-4 py-3 text-sm outline-none" placeholder="状态名称" />
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(color => (
                <button key={color} type="button" aria-label={`选择状态色 ${color}`} onClick={() => setNewColor(color)} className={`motion-action w-8 h-8 rounded-full border transition-transform ${newColor === color ? 'border-white scale-110' : 'border-white/10'}`} style={{ backgroundColor: color }} />
              ))}
              <label className="motion-action relative h-8 w-8 rounded-full border border-white/10 bg-bg-tertiary cursor-pointer overflow-hidden hover:border-white/45" title="自定义颜色">
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="motion-focus absolute inset-0 h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
                <Palette size={14} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary" />
              </label>
            </div>
            <button onClick={createStatus} className="motion-action w-full bg-text-primary text-primary rounded-full px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2">
              <Plus size={15} /> 创建状态
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-accent-orange/30 bg-bg-secondary/60 p-5 stagger-item" style={{ '--stagger': 4 } as CSSProperties}>
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-accent-orange flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold mb-2">删除保护</h2>
              <p className="text-sm text-text-secondary leading-6">至少保留一个状态。正在被项目使用的状态不能直接删除，先把项目切换到其他状态。</p>
            </div>
          </div>
        </section>
      </aside>
      </div>
    </AnimatedPage>
  )
}
