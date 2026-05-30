import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      } else if (e.key === 'Enter') {
        onConfirm()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    // Prevent background scrolling if applicable, though it's an Electron app
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onConfirm, onCancel])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel()
      }}
    >
      <div
        className="glass-panel modal-panel w-full max-w-[420px] rounded-[32px] p-6 shadow-2xl border border-white/[0.08] animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex gap-4 items-start">
          <div className="w-12 h-12 rounded-2xl bg-status-paused/10 text-status-paused flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={22} className="breathing-dot" />
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-semibold text-text-primary tracking-wide">{title}</h3>
            <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.08] transition-all duration-[180ms] motion-press"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-full bg-status-paused text-white text-sm font-semibold hover:opacity-90 transition-all duration-[180ms] motion-press shadow-lg shadow-status-paused/20"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
