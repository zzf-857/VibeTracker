import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

interface TooltipContextType {
  showTooltip: (content: React.ReactNode, e: React.MouseEvent) => void
  hideTooltip: () => void
}

const TooltipContext = createContext<TooltipContextType | undefined>(undefined)

export function useTooltip() {
  const context = useContext(TooltipContext)
  if (!context) {
    throw new Error('useTooltip must be used within a TooltipProvider')
  }
  return context
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [content, setContent] = useState<React.ReactNode>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  const showTooltip = useCallback((newContent: React.ReactNode, e: React.MouseEvent) => {
    setContent(newContent)
    setVisible(true)
    setPosition({ x: e.clientX, y: e.clientY })
  }, [])

  const hideTooltip = useCallback(() => {
    setVisible(false)
  }, [])

  useEffect(() => {
    if (!visible || !tooltipRef.current) return

    const tooltip = tooltipRef.current
    const rect = tooltip.getBoundingClientRect()
    
    let newX = position.x + 12
    let newY = position.y + 12

    if (newX + rect.width > window.innerWidth) {
      newX = position.x - rect.width - 12
    }
    if (newY + rect.height > window.innerHeight) {
      newY = position.y - rect.height - 12
    }

    tooltip.style.left = `${newX}px`
    tooltip.style.top = `${newY}px`
  }, [position, visible])

  return (
    <TooltipContext.Provider value={{ showTooltip, hideTooltip }}>
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className="fixed pointer-events-none z-[9999] px-3.5 py-2.5 rounded-2xl bg-[#14171b]/92 border border-white/10 shadow-2xl backdrop-blur-xl text-xs text-text-primary flex flex-col gap-1.5 select-none font-sans"
          style={{
            position: 'fixed',
            left: `${position.x + 12}px`,
            top: `${position.y + 12}px`,
            transition: 'left 0.08s cubic-bezier(0.25, 0.46, 0.45, 0.94), top 0.08s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
          }}
        >
          {content}
        </div>
      )}
    </TooltipContext.Provider>
  )
}
