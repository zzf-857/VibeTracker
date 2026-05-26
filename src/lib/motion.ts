import type { CSSProperties } from 'react'

export type MotionPhase = 'confirm' | 'timeline' | 'sync' | 'settle'

export function getStaggerStyle(index: number): CSSProperties {
  return { '--stagger': index } as CSSProperties
}

export function getMotionPhaseClass(phase: MotionPhase) {
  return `ritual-${phase}`
}

export function makeRitualKey(entityId: string, timestamp: number) {
  return `${entityId}:${timestamp}`
}

export function shouldAnimateCountChange(previous: number | undefined, next: number) {
  return typeof previous === 'number' && previous !== next
}
