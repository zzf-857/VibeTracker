import React, { useEffect, useState } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ParticleEmitterProvider } from './ParticleEmitter'
import { TooltipProvider } from './CustomTooltip'
import { cn } from '../lib/utils'

interface RenderedPage {
  key: string
  element: React.ReactNode
  phase: 'enter' | 'exit'
}

export function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([])

  useEffect(() => {
    if (!outlet) return

    setRenderedPages(prev => {
      const next = prev.map(p => ({ ...p, phase: 'exit' as 'enter' | 'exit' }))
      const existingIndex = next.findIndex(p => p.key === location.pathname)
      if (existingIndex >= 0) {
        next[existingIndex].phase = 'enter'
        return next
      }
      return [...next, { key: location.pathname, element: outlet, phase: 'enter' }]
    })
  }, [location.pathname, outlet])

  useEffect(() => {
    const exiting = renderedPages.filter(p => p.phase === 'exit')
    if (exiting.length > 0) {
      const timer = setTimeout(() => {
        setRenderedPages(prev => prev.filter(p => p.phase !== 'exit'))
      }, 340)
      return () => clearTimeout(timer)
    }
  }, [renderedPages])

  return (
    <ParticleEmitterProvider>
      <TooltipProvider>
        <div className="flex h-screen w-full overflow-hidden text-text-primary">
          <Sidebar />
          <main className="flex-1 h-full overflow-hidden flex flex-col relative z-[1]">
            <div className="flex-1 w-full relative overflow-hidden">
              {renderedPages.map(page => (
                <div
                  key={page.key}
                  className={cn(
                    "absolute inset-0 w-full h-full overflow-x-hidden overflow-y-auto page-transition-wrapper",
                    page.phase === 'enter' ? 'page-route-enter' : 'page-route-exit'
                  )}
                  style={{
                    pointerEvents: page.phase === 'exit' ? 'none' : 'auto'
                  }}
                >
                  <div className="min-h-full w-full max-w-[1440px] mx-auto">
                    {page.element}
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </TooltipProvider>
    </ParticleEmitterProvider>
  )
}


