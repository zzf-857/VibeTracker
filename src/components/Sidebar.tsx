import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FolderKanban, Tags, Settings } from 'lucide-react'
import { cn } from '../lib/utils'

export function Sidebar() {
  const navItems = [
    { icon: LayoutDashboard, label: '仪表板', path: '/' },
    { icon: FolderKanban, label: '项目列表', path: '/projects' },
    { icon: Tags, label: '标签管理', path: '/tags' },
    { icon: Settings, label: '设置', path: '/settings' },
  ]

  return (
    <aside className="w-[260px] h-full bg-sidebar flex flex-col py-6 px-5 flex-shrink-0 relative z-10 border-r border-border-primary">
      {/* Logo Area */}
      <div className="flex items-center gap-3 mb-10 px-2 cursor-pointer">
        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent-blue text-primary shadow-lg shadow-accent-blue/20">
          <FolderKanban size={18} strokeWidth={2.5} className="text-sidebar" />
        </div>
        <span className="text-[17px] font-bold tracking-wide text-text-primary">DevTracker</span>
      </div>

      {/* Nav Menu */}
      <nav className="flex flex-col gap-2">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-200 group',
                  isActive
                    ? 'bg-border-subtle text-text-primary'
                    : 'text-text-secondary hover:bg-border-subtle/50 hover:text-text-primary'
                )
              }
            >
              <Icon size={18} className="opacity-80 group-hover:opacity-100 transition-opacity" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
      
      <div className="mt-auto opacity-50 px-2 text-xs text-text-tertiary">
        v0.1.0-alpha
      </div>
    </aside>
  )
}
