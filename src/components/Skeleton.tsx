import { cn } from '../lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'text' | 'title' | 'circle' | 'rect'
}

export function Skeleton({ className, variant = 'rect', ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-white/[0.03] border border-white/[0.02]",
        variant === 'circle' && "rounded-full",
        variant === 'text' && "h-4 rounded-[6px] w-3/4",
        variant === 'title' && "h-7 rounded-[8px] w-1/3",
        variant === 'card' && "rounded-[24px] h-[210px]",
        variant === 'rect' && "rounded-2xl",
        className
      )}
      {...props}
    />
  )
}
