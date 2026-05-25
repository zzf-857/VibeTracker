import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen w-full bg-primary overflow-hidden">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col relative z-0">
        <div className="flex-1 overflow-x-hidden overflow-y-auto w-full">
          <div className="h-full w-full max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
