import { useEffect, useState } from 'react'
import { FolderKanban, Home, Settings } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'

export function Sidebar() {
  const location = useLocation()
  const [appVersion, setAppVersion] = useState('0.1.0')
  useEffect(() => { void window.vibe.app.getVersion().then(info => setAppVersion(info.version)).catch(() => undefined) }, [])
  const items = [
    { icon: Home, label: '首页', path: '/', active: (pathname: string) => pathname === '/' },
    { icon: FolderKanban, label: '项目', path: '/projects', active: (pathname: string) => pathname.startsWith('/project') },
    { icon: Settings, label: '设置', path: '/settings', active: (pathname: string) => pathname.startsWith('/settings') || pathname.startsWith('/tags') },
  ]
  return (
    <aside className="w-[84px] h-full bg-sidebar/90 flex flex-col py-5 px-3 flex-shrink-0 border-r border-border-subtle">
      <div className="w-10 h-10 mx-auto rounded-xl bg-text-primary text-primary grid place-items-center"><FolderKanban size={18} strokeWidth={2.4} /></div>
      <nav aria-label="主导航" className="mt-8 flex flex-col gap-2">
        {items.map(item => { const Icon = item.icon; const active = item.active(location.pathname); return <NavLink key={item.path} to={item.path} aria-label={item.label} title={item.label} className={cn('h-12 rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue', active ? 'bg-bg-tertiary text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-secondary')}><Icon size={17} /><span>{item.label}</span></NavLink> })}
      </nav>
      <div className="mt-auto text-center text-[10px] text-text-tertiary font-mono">v{appVersion}</div>
    </aside>
  )
}
