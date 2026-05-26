import type { CSSProperties, ReactNode } from 'react'
import { getStaggerStyle } from '../lib/motion'
import { cn } from '../lib/utils'

type PresenceListProps<T> = {
  items: T[]
  getKey: (item: T) => string
  className?: string
  itemClassName?: string
  renderItem: (item: T, index: number) => ReactNode
}

export function PresenceList<T>({ items, getKey, className, itemClassName, renderItem }: PresenceListProps<T>) {
  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={getKey(item)} className={cn('presence-item', itemClassName)} style={getStaggerStyle(index) as CSSProperties}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  )
}
