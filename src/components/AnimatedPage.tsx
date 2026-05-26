import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

type AnimatedPageProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  tone?: 'standard' | 'gallery' | 'detail' | 'system'
}

export function AnimatedPage({ children, className, tone = 'standard', ...props }: AnimatedPageProps) {
  return (
    <div className={cn('page-enter motion-page-shell', `motion-page-${tone}`, className)} {...props}>
      {children}
    </div>
  )
}
