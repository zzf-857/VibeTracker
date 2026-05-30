import React, { createContext, useContext, useRef, useCallback } from 'react'

interface ParticleEmitterContextType {
  triggerConfetti: (x: number, y: number) => void
  triggerTodoBurst: (x: number, y: number) => void
}

const ParticleEmitterContext = createContext<ParticleEmitterContextType | undefined>(undefined)

export function useParticleEmitter() {
  const context = useContext(ParticleEmitterContext)
  if (!context) {
    throw new Error('useParticleEmitter must be used within a ParticleEmitterProvider')
  }
  return context
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  alpha: number
  decay: number
  gravity?: number
  drag?: number
}

export function ParticleEmitterProvider({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationFrameRef = useRef<number | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const particles = particlesRef.current
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.x += p.vx
      p.y += p.vy
      if (p.drag !== undefined) {
        p.vx *= p.drag
        p.vy *= p.drag
      }
      if (p.gravity !== undefined) {
        p.vy += p.gravity
      }
      p.alpha -= p.decay

      if (p.alpha <= 0) {
        particles.splice(i, 1)
        continue
      }

      ctx.save()
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    if (particles.length > 0) {
      animationFrameRef.current = requestAnimationFrame(draw)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      animationFrameRef.current = null
    }
  }, [])

  const addParticles = useCallback((newParticles: Particle[]) => {
    particlesRef.current.push(...newParticles)
    
    const canvas = canvasRef.current
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width
        canvas.height = rect.height
      }
    }

    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(draw)
    }
  }, [draw])

  const triggerConfetti = useCallback((x: number, y: number) => {
    const colors = ['#74A9FF', '#BC8CFF', '#F3BB6C', '#FF6B6B', '#63D693']
    const newParticles: Particle[] = []

    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 5.5
      const size = 1.8 + Math.random() * 3.5
      const color = colors[Math.floor(Math.random() * colors.length)]
      
      newParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        size,
        color,
        alpha: 1.0,
        decay: 0.013 + Math.random() * 0.015,
        gravity: 0.1,
        drag: 0.98
      })
    }
    addParticles(newParticles)
  }, [addParticles])

  const triggerTodoBurst = useCallback((x: number, y: number) => {
    const color = '#63D693'
    const newParticles: Particle[] = []

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const speed = 1.8 + Math.random() * 0.4
      
      newParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.0,
        color,
        alpha: 1.0,
        decay: 0.026 + Math.random() * 0.01,
        gravity: 0.01,
        drag: 0.96
      })
    }
    addParticles(newParticles)
  }, [addParticles])

  return (
    <ParticleEmitterContext.Provider value={{ triggerConfetti, triggerTodoBurst }}>
      {children}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[1000] w-full h-full"
        style={{ display: 'block' }}
      />
    </ParticleEmitterContext.Provider>
  )
}
