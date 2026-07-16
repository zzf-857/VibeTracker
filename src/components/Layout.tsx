import React, { useEffect, useState, useRef } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ParticleEmitterProvider } from './ParticleEmitter'
import { TooltipProvider } from './CustomTooltip'
import { cn } from '../lib/utils'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

interface RenderedPage {
  key: string
  element: React.ReactNode
  phase: 'enter' | 'exit'
}

export function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const [renderedPages, setRenderedPages] = useState<RenderedPage[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const lastAnimatedKeyRef = useRef<string | null>(null)

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
      }, 450) // Aligned with the 450ms transition duration
      return () => clearTimeout(timer)
    }
  }, [renderedPages])

  useGSAP(() => {
    const media = gsap.matchMedia()
    let reduceMotion = false
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      reduceMotion = Boolean(context.conditions?.reduceMotion)
    })
    // 1. Ensure the new page is actually mounted and in the 'enter' phase in the DOM
    const hasEnteringPage = renderedPages.some(p => p.key === location.pathname && p.phase === 'enter')
    if (!hasEnteringPage) return

    // 2. Animate Entering Page
    const enteringEl = containerRef.current?.querySelector('.page-route-enter')
    const exitingEl = containerRef.current?.querySelector('.page-route-exit')
    if (reduceMotion) {
      if (enteringEl) gsap.set(enteringEl, { autoAlpha: 1, x: 0, y: 0, scale: 1, clearProps: 'filter' })
      if (exitingEl) gsap.set(exitingEl, { autoAlpha: 0 })
      return () => media.revert()
    }
    let revealTimer: number | null = null
    const revealEnteringPage = () => {
      if (!enteringEl) return
      gsap.set(enteringEl, { autoAlpha: 1, x: 0, y: 0, scale: 1, clearProps: 'opacity,transform,filter,visibility' })
    }
    if (enteringEl && lastAnimatedKeyRef.current !== location.pathname) {
      lastAnimatedKeyRef.current = location.pathname
      gsap.killTweensOf(enteringEl)
      try {
        gsap.fromTo(enteringEl,
          {
            opacity: 0,
            y: 22,
            scale: 0.982,
          },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.45,
            ease: 'power3.out',
            onComplete: revealEnteringPage,
            onInterrupt: revealEnteringPage,
          }
        )
        // A suspended or interrupted animation must never leave the active
        // route transparent after the static boot state has been removed.
        revealTimer = window.setTimeout(revealEnteringPage, 750)
      } catch (error) {
        console.error('[RouteTransition] Unable to animate entering page:', error)
        revealEnteringPage()
      }
    }

    // 3. Animate Exiting Page
    if (exitingEl) {
      gsap.killTweensOf(exitingEl)
      gsap.fromTo(exitingEl,
        {
          opacity: 1,
          y: 0,
          scale: 1,
        },
        {
          opacity: 0,
          y: -10,
          scale: 0.99,
          duration: 0.22, // Decisive exit: vanishes quickly to free up GPU composición layers
          ease: 'power2.out',
        }
      )
    }
    return () => {
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealEnteringPage()
      media.revert()
    }
  }, { dependencies: [renderedPages, location.pathname], scope: containerRef })

  return (
    <ParticleEmitterProvider>
      <TooltipProvider>
        <div className="flex h-screen w-full overflow-hidden text-text-primary">
          <Sidebar />
          <main className="flex-1 h-full overflow-hidden flex flex-col relative z-[1]">
            <div className="flex-1 w-full relative overflow-hidden" ref={containerRef}>
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



