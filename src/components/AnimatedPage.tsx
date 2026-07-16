import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/utils'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

type AnimatedPageProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  tone?: 'standard' | 'gallery' | 'detail' | 'system'
}

export function AnimatedPage({ children, className, tone = 'standard', ...props }: AnimatedPageProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const media = gsap.matchMedia()
    let reduceMotion = false
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      reduceMotion = Boolean(context.conditions?.reduceMotion)
    })
    if (reduceMotion) {
      const items = gsap.utils.toArray('.stagger-item, .stagger-item-fast, .stagger-item-horizontal-left')
      gsap.set(items, { clearProps: 'all', autoAlpha: 1 })
      items.forEach(item => {
        const element = item as HTMLElement
        element.classList.remove('stagger-item', 'stagger-item-fast', 'stagger-item-horizontal-left')
      })
      return () => media.revert()
    }
    // 1. Standard Stagger Items (Cards, commit cards, etc.)
    const staggerItems = gsap.utils.toArray('.stagger-item')
    if (staggerItems.length > 0) {
      gsap.fromTo(staggerItems,
        {
          y: 35,
          opacity: 0,
          scale: 0.975,
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.06,
          delay: 0.35, // Delayed to let the main page finish sliding in, avoiding simultaneous CPU calculation
          clearProps: 'all', // very important: cleans up inline transform and scale styles after completion
          onComplete: () => {
            staggerItems.forEach(el => (el as HTMLElement).classList.remove('stagger-item'))
          }
        }
      )
    }

    // 2. Fast Stagger Items (badges, simple list items)
    const fastItems = gsap.utils.toArray('.stagger-item-fast')
    if (fastItems.length > 0) {
      gsap.fromTo(fastItems,
        {
          y: 20,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 0.45,
          ease: 'power3.out',
          stagger: 0.04,
          delay: 0.22,
          clearProps: 'all',
          onComplete: () => {
            fastItems.forEach(el => (el as HTMLElement).classList.remove('stagger-item-fast'))
          }
        }
      )
    }

    // 3. Horizontal Stagger Items (left slides, timeline details)
    const horizontalLeftItems = gsap.utils.toArray('.stagger-item-horizontal-left')
    if (horizontalLeftItems.length > 0) {
      gsap.fromTo(horizontalLeftItems,
        {
          x: -30,
          opacity: 0,
        },
        {
          x: 0,
          opacity: 1,
          duration: 0.5,
          ease: 'power3.out',
          stagger: 0.05,
          delay: 0.28,
          clearProps: 'all',
          onComplete: () => {
            horizontalLeftItems.forEach(el => (el as HTMLElement).classList.remove('stagger-item-horizontal-left'))
          }
        }
      )
    }
    return () => media.revert()
  }, { scope: containerRef })

  return (
    <div 
      ref={containerRef}
      className={cn('page-enter motion-page-shell', `motion-page-${tone}`, className)} 
      {...props}
    >
      {children}
    </div>
  )
}

