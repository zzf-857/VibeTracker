import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react'
import { SafeImage } from './SafeImage'

interface ImagePreviewContextType {
  showPreview: (src: string) => void
  hidePreview: () => void
}

const ImagePreviewContext = createContext<ImagePreviewContextType | undefined>(undefined)

export function useImagePreview() {
  const context = useContext(ImagePreviewContext)
  if (!context) {
    throw new Error('useImagePreview must be used within an ImagePreviewProvider')
  }
  return context
}

export function ImagePreviewProvider({ children }: { children: React.ReactNode }) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  const showPreview = (src: string) => {
    setPreviewSrc(src)
  }

  const hidePreview = () => {
    setPreviewSrc(null)
  }

  return (
    <ImagePreviewContext.Provider value={{ showPreview, hidePreview }}>
      {children}
      {previewSrc && <ImagePreviewModal src={previewSrc} onClose={hidePreview} />}
    </ImagePreviewContext.Provider>
  )
}

function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const positionRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imageContainerRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // 同步平移坐标给 Ref 避免在拖动时闭包引用陈旧的 state
  useEffect(() => {
    positionRef.current = position
  }, [position])

  // 原生绑定 wheel 事件以支持非被动模式 (passive: false) 从而 100% 阻止底层页面滚动
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const zoomFactor = 1.15
      setScale(prevScale => {
        let newScale
        if (e.deltaY < 0) {
          // 向上滚，放大
          newScale = Math.min(prevScale * zoomFactor, 6)
        } else {
          // 向下滚，缩小
          newScale = Math.max(prevScale / zoomFactor, 0.25)
        }
        return newScale
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // 键盘关闭、焦点环绕与关闭后的焦点恢复。
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onClose])

  // 双击一键复位
  const handleDoubleClick = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  // 手动控制栏按钮逻辑
  const handleZoomIn = () => {
    setScale(prev => Math.min(prev * 1.3, 6))
  }

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev / 1.3, 0.25))
  }

  const handleReset = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  // Pointer Events 支持无缝鼠标与触控屏拖动
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅允许鼠标左键拖拽
    if (e.button !== 0) return
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y
    }
    // 捕获指针焦点，防止划出屏幕时拖拽中断
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 捕获可能抛出的释放指针异常，静默忽略
    }
  }

  // 点击空白底色区域遮罩退出
  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 仅当用户点击的是最外层背景，或者是图片容器（除了图片本身之外的空白）时才关闭
    if (e.target === e.currentTarget || e.target === containerRef.current) {
      onClose()
    }
  }

  // 缩放百分比显示
  const percentText = `${Math.round(scale * 100)}%`

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={handleBackgroundClick}
      className="fixed inset-0 z-[999] bg-black/75 backdrop-blur-xl flex items-center justify-center animate-fade-in select-none"
      style={{ cursor: 'zoom-out' }}
    >
      {/* 右上角关闭按钮 */}
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="关闭图片预览"
        onClick={onClose}
        className="absolute top-6 right-6 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white flex items-center justify-center transition-all motion-press hover:scale-105 active:scale-95 z-50 shadow-lg"
        title="关闭预览 (Esc)"
        style={{ cursor: 'pointer' }}
      >
        <X size={20} />
      </button>

      {/* 大图显示主容器 */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        <div
          ref={imageContainerRef}
          onDoubleClick={handleDoubleClick}
          className="max-w-[90%] max-h-[85%] flex items-center justify-center select-none will-change-transform shadow-2xl rounded-xl"
          draggable={false}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          }}
        >
          <SafeImage
            src={src}
            alt="图片预览"
            previewable={false}
            className="max-w-full max-h-[80vh] object-contain rounded-xl select-none"
          />
        </div>
      </div>

      {/* 精美玻璃态悬浮控制栏 */}
      <div 
        className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full bg-white/[0.08] hover:bg-white/[0.12] border border-white/10 shadow-2xl backdrop-blur-md flex items-center gap-5 transition-all text-white/90 text-sm z-50"
        style={{ cursor: 'default' }}
      >
        <button
          type="button"
          aria-label="缩小图片"
          onClick={handleZoomOut}
          className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 active:bg-white/25 flex items-center justify-center transition-colors motion-press"
          title="缩小"
          style={{ cursor: 'pointer' }}
        >
          <ZoomOut size={16} />
        </button>

        <span className="min-w-[54px] text-center font-mono font-medium tracking-wide tabular-nums select-none text-xs text-white/95">
          {percentText}
        </span>

        <button
          type="button"
          aria-label="放大图片"
          onClick={handleZoomIn}
          className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 active:bg-white/25 flex items-center justify-center transition-colors motion-press"
          title="放大"
          style={{ cursor: 'pointer' }}
        >
          <ZoomIn size={16} />
        </button>

        <div className="w-[1px] h-4 bg-white/15" />

        <button
          type="button"
          aria-label="重置图片缩放与位置"
          onClick={handleReset}
          className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 active:bg-white/25 flex items-center justify-center transition-colors motion-press"
          title="重置缩放 & 平移 (双击图片)"
          style={{ cursor: 'pointer' }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </div>,
    document.body
  )
}
