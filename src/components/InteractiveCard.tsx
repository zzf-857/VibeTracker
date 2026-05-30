import React, { useRef, useState } from 'react'

interface InteractiveCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
}

export function InteractiveCard({ children, className, onClick, disabled = false, style }: InteractiveCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({})

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
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

    setTiltStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.008, 1.008, 1.008)`,
      transition: 'transform 0.08s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      '--sheen-x': `${(x / rect.width) * 100}%`,
      '--sheen-y': `${(y / rect.height) * 100}%`,
    } as React.CSSProperties)
  }

  const handleMouseLeave = () => {
    setTiltStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      '--sheen-x': '50%',
      '--sheen-y': '50%',
    } as React.CSSProperties)
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className={className}
      style={{ ...style, ...tiltStyle }}
    >
      {children}
      <span className="card-sheen" aria-hidden="true" />
    </div>
  )
}
