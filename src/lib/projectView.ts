import type { Project, ProjectCommit } from '../types.ts'

export function getActivityLevel(count: number) {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

export function getRecentCommit(project: Pick<Project, 'commits' | 'recentCommit'>) {
  return project.recentCommit || project.commits?.[0] || null
}

export function getProjectCover(project: Pick<Project, 'coverImagePath' | 'commits' | 'recentCommit' | 'resolvedCoverImagePath'>) {
  if (project.coverImagePath) return project.coverImagePath
  if (project.resolvedCoverImagePath) return project.resolvedCoverImagePath
  const recentImage = getRecentCommit(project)?.images?.[0]?.imagePath
  if (recentImage) return recentImage
  for (const commit of project.commits || [] as ProjectCommit[]) {
    const image = commit.images?.[0]?.imagePath
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

export function toImageSrc(imagePath: string) {
  if (!imagePath) return ''
  if (/^(file|https?):\/\//i.test(imagePath)) return imagePath
  return `file:///${imagePath.replace(/\\/g, '/')}`
}

export function groupCommitsByDay(commits: Pick<ProjectCommit, 'createdAt'>[]) {
  const counts = new Map<string, number>()
  for (const commit of commits) {
    const key = formatDateKey(commit.createdAt)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}
