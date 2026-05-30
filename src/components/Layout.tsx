import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ParticleEmitterProvider } from './ParticleEmitter'
import { TooltipProvider } from './CustomTooltip'

export function Layout() {
  const location = useLocation()

  return (
    <ParticleEmitterProvider>
      <TooltipProvider>
        <div className="flex h-screen w-full overflow-hidden text-text-primary">
          <Sidebar />
          <main className="flex-1 h-full overflow-hidden flex flex-col relative z-[1]">
            <div className="flex-1 overflow-x-hidden overflow-y-auto w-full motion-route-shell" data-route={location.pathname}>
              <div className="min-h-full w-full max-w-[1440px] mx-auto">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </TooltipProvider>
    </ParticleEmitterProvider>
  )
}

