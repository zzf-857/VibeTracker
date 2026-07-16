import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) {
        onCancel()
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    cancelButtonRef.current?.focus()
    // Prevent background scrolling if applicable, though it's an Electron app
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [isOpen, onConfirm, onCancel, pending])

  if (!isOpen) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300"
      onClick={(e) => {
        if (e.target === overlayRef.current && !pending) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="modal-panel w-full max-w-[420px] rounded-2xl bg-bg-secondary p-6 shadow-2xl border border-border-primary animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="flex gap-4 items-start">
          <div className="w-12 h-12 rounded-2xl bg-status-paused/10 text-status-paused flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={22} className="breathing-dot" />
          </div>
          <div className="space-y-2 flex-1">
            <h3 id={titleId} className="text-lg font-semibold text-text-primary tracking-wide">{title}</h3>
            <p id={messageId} className="text-sm text-text-secondary leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            ref={cancelButtonRef}
            disabled={pending}
            onClick={onCancel}
            className="px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.08] transition-all duration-[180ms] motion-press disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            disabled={pending}
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-full bg-status-paused text-white text-sm font-semibold hover:opacity-90 transition-all duration-[180ms] motion-press shadow-lg shadow-status-paused/20 disabled:opacity-60 inline-flex items-center gap-2"
          >
            {pending && <Loader2 size={14} className="animate-spin" />}{pending ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
