import React, { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

interface InteractiveCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
}

export function InteractiveCard({ children, className, onClick, disabled = false, style }: InteractiveCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const { contextSafe } = useGSAP({ scope: cardRef })

  const handleMouseMove = contextSafe((e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !cardRef.current) return
    const card = cardRef.current
    const rect = card.getBoundingClientRect()
    const x = e.clientX - rect.left // x position within the element
    const y = e.clientY - rect.top  // y position within the element

    const centerX = rect.width / 2
    const centerY = rect.height / 2

    // Calculate rotation angles (max 6.5 degrees tilt)
    const rotateX = ((centerY - y) / centerY) * 6.5
    const rotateY = ((x - centerX) / centerX) * 6.5

    gsap.to(card, {
      transformPerspective: 1000,
      rotationX: rotateX,
      rotationY: rotateY,
      scale: 1.008,
      force3D: true, // Promotes to hardware-composited layer
      duration: 0.15,
      ease: 'power2.out',
      overwrite: 'auto',
      '--sheen-x': `${(x / rect.width) * 100}%`,
      '--sheen-y': `${(y / rect.height) * 100}%`,
    })
  })

  const handleMouseLeave = contextSafe(() => {
    if (!cardRef.current) return
    gsap.to(cardRef.current, {
      rotationX: 0,
      rotationY: 0,
      scale: 1,
      force3D: true,
      duration: 0.45,
      ease: 'power3.out',
      overwrite: 'auto',
      '--sheen-x': '50%',
      '--sheen-y': '50%',
    })
  })

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className={className}
      style={style}
    >
      {children}
      <span className="card-sheen" aria-hidden="true" />
    </div>
  )
}

