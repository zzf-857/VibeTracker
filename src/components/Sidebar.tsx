import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, FolderKanban, Tags, Settings } from 'lucide-react'
import { cn } from '../lib/utils'

export function Sidebar() {
  const location = useLocation()
  const navItems = [
    { icon: LayoutDashboard, label: '仪表板', path: '/', match: (pathname: string) => pathname === '/' },
    { icon: FolderKanban, label: '项目列表', path: '/projects', match: (pathname: string) => pathname.startsWith('/projects') || pathname.startsWith('/project/') },
    { icon: Tags, label: '标签管理', path: '/tags', match: (pathname: string) => pathname.startsWith('/tags') },
    { icon: Settings, label: '设置', path: '/settings', match: (pathname: string) => pathname.startsWith('/settings') },
  ]
  const activeIndex = navItems.findIndex(item => item.match(location.pathname))
  const indicatorIndex = Math.max(0, activeIndex)

  return (
    <aside className="w-[92px] h-full bg-sidebar/80 backdrop-blur-2xl flex flex-col py-6 px-4 flex-shrink-0 relative z-10 border-r border-border-primary">
      <div className="flex items-center justify-center mb-9">
        <div className="w-11 h-11 flex items-center justify-center rounded-2xl bg-text-primary text-primary shadow-[0_18px_50px_rgba(255,255,255,0.12)] motion-card hover:scale-[1.04]">
          <FolderKanban size={19} strokeWidth={2.5} className="text-primary" />
        </div>
      </div>

      <nav className="relative flex flex-col gap-3 items-center">
        <span
          aria-hidden="true"
          className="sidebar-active-indicator"
          style={{ opacity: activeIndex >= 0 ? 1 : 0, transform: `translateY(${indicatorIndex * 60}px)` }}
        />
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => {
                const isCurrent = isActive || item.match(location.pathname)
                return cn(
                  'sidebar-nav-item relative z-10 w-12 h-12 flex items-center justify-center rounded-2xl group',
                  isCurrent
                    ? 'bg-bg-tertiary text-text-primary shadow-[0_14px_38px_rgba(0,0,0,0.18)] scale-[1.03]'
                    : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary hover:scale-[1.03]'
                )
              }}
              title={item.label}
            >
              <Icon size={19} className="opacity-85 group-hover:opacity-100 transition-opacity" />
            </NavLink>
          )
        })}
      </nav>
      
      <div className="mt-auto text-center opacity-55 text-[11px] text-text-tertiary font-mono">
        v0.1
      </div>
    </aside>
  )
}
