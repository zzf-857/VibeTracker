import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

type MotionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  active?: boolean
}

export function MotionButton({ children, className, active = false, type = 'button', ...props }: MotionButtonProps) {
  return (
    <button
      type={type}
      className={cn('motion-press motion-focus', active && 'motion-update', className)}
      {...props}
    >
      {children}
    </button>
  )
}
