import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen w-full overflow-hidden text-text-primary">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col relative z-[1]">
        <div className="flex-1 overflow-x-hidden overflow-y-auto w-full">
          <div className="min-h-full w-full max-w-[1440px] mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
