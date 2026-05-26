import { cn } from '../lib/utils'

type RitualFeedbackProps = {
  active: boolean
  tone?: 'commit' | 'cover' | 'status'
  className?: string
}

export function RitualFeedback({ active, tone = 'commit', className }: RitualFeedbackProps) {
  if (!active) return null
  return <span aria-hidden="true" className={cn('ritual-feedback', `ritual-feedback-${tone}`, className)} />
}
