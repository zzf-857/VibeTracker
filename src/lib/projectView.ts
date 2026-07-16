import type { DevelopmentRecord, Project } from '../types.ts'

export function getActivityLevel(count: number) {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

export function getRecentRecord(project: Pick<Project, 'records' | 'recentRecord' | 'commits' | 'recentCommit'>) {
  return project.recentRecord || project.records?.[0] || project.recentCommit || project.commits?.[0] || null
}

/** @deprecated Use getRecentRecord. */
export const getRecentCommit = getRecentRecord

export function getProjectCover(project: Pick<Project, 'coverImagePath' | 'records' | 'recentRecord' | 'commits' | 'recentCommit' | 'resolvedCoverImagePath'>) {
  if (project.coverImagePath) return project.coverImagePath
  if (project.resolvedCoverImagePath) return project.resolvedCoverImagePath
  const recentImage = getRecentRecord(project)?.images?.[0]?.imagePath
  if (recentImage) return recentImage
  for (const record of project.records || project.commits || [] as DevelopmentRecord[]) {
    const image = record.images?.[0]?.imagePath
    if (image) return image
  }
  return ''
}

export function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateKey(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type ImageThumbnailSize = 96 | 160 | 240 | 320 | 480 | 640 | 960 | 1280

export function toImageSrc(imagePath: string, thumbnailSize?: ImageThumbnailSize) {
  if (!imagePath) return ''
  if (/^(https?|data):/i.test(imagePath)) return imagePath
  if (/^vibe-asset:/i.test(imagePath)) {
    try {
      const url = new URL(imagePath)
      if (thumbnailSize) url.searchParams.set('size', String(thumbnailSize))
      else url.searchParams.delete('size')
      return url.toString()
    } catch {
      return imagePath
    }
  }
  const query = thumbnailSize ? `?size=${thumbnailSize}` : ''
  return `vibe-asset://local/${encodeURIComponent(imagePath)}${query}`
}

export function groupRecordsByDay(records: Pick<DevelopmentRecord, 'createdAt'>[]) {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = formatDateKey(record.createdAt)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/** @deprecated Use groupRecordsByDay. */
export const groupCommitsByDay = groupRecordsByDay
