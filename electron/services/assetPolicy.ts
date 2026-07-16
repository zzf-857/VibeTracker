import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const previewAssetPaths = new Map<string, number>()
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MAX_ASSET_BYTES = 40 * 1024 * 1024

function resolvedPath(filePath: string) {
  return path.resolve(filePath)
}

function existingImagePath(candidatePath: string) {
  try {
    const canonical = fs.realpathSync.native(resolvedPath(candidatePath))
    const stat = fs.statSync(canonical)
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return null
    if (!IMAGE_EXTENSIONS.has(path.extname(canonical).toLowerCase())) return null
    return canonical
  } catch {
    return null
  }
}

function existingDirectoryPath(candidatePath: string) {
  try {
    const canonical = fs.realpathSync.native(resolvedPath(candidatePath))
    return fs.statSync(canonical).isDirectory() ? canonical : null
  } catch {
    return null
  }
}

function pathKeys(candidatePath: string, canonicalPath: string) {
  return [...new Set([resolvedPath(candidatePath), canonicalPath])]
}

function isWithin(root: string, filePath: string) {
  const relative = path.relative(root, filePath)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isPreviewAuthorized(keys: string[]) {
  const now = Date.now()
  for (const key of keys) {
    const previewExpiry = previewAssetPaths.get(key)
    if (previewExpiry && previewExpiry > now) return true
    if (previewExpiry) previewAssetPaths.delete(key)
  }
  return false
}

function persistedReferencePath(db: Database.Database, keys: string[]) {
  for (const filePath of keys) {
    const referenced = db.prepare(`
      SELECT path FROM managed_assets WHERE path = ?
      UNION ALL SELECT coverImagePath AS path FROM projects WHERE coverImagePath = ?
      UNION ALL SELECT imagePath AS path FROM development_record_images WHERE imagePath = ?
      LIMIT 1
    `).get(filePath, filePath, filePath) as { path?: string } | undefined
    if (referenced?.path) return referenced.path
  }
  return ''
}

function hasPersistedReference(db: Database.Database, keys: string[]) {
  return Boolean(persistedReferencePath(db, keys))
}

function projectRoots(db: Database.Database, projectId?: string) {
  const rows = projectId
    ? db.prepare(`
        SELECT canonicalPath, path FROM projects WHERE id = ?
      `).all(projectId) as Array<{ canonicalPath: string | null; path: string | null }>
    : db.prepare(`
        SELECT canonicalPath, path FROM projects
        WHERE COALESCE(canonicalPath, '') <> '' OR COALESCE(path, '') <> ''
      `).all() as Array<{ canonicalPath: string | null; path: string | null }>
  return rows.flatMap(project => [project.canonicalPath, project.path])
    .filter((root): root is string => Boolean(root))
}

function isWithinRoots(filePath: string, roots: string[]) {
  return roots.some(root => {
    const canonicalRoot = existingDirectoryPath(root)
    return Boolean(canonicalRoot && isWithin(canonicalRoot, filePath))
  })
}

export function authorizeAssetPaths(paths: string[], lifetimeMs = 10 * 60_000) {
  const expiresAt = Date.now() + lifetimeMs
  paths.slice(0, 200).forEach(filePath => {
    const canonical = existingImagePath(filePath)
    if (!canonical) return
    pathKeys(filePath, canonical).forEach(key => previewAssetPaths.set(key, expiresAt))
  })
}

export function isAssetPathAllowed(db: Database.Database, candidatePath: string) {
  const canonical = existingImagePath(candidatePath)
  if (!canonical) return false
  const keys = pathKeys(candidatePath, canonical)
  if (isPreviewAuthorized(keys) || hasPersistedReference(db, keys)) return true
  return isWithinRoots(canonical, projectRoots(db))
}

export function authorizeAssetPathForPersistence(
  db: Database.Database,
  candidatePath: string,
  options: { projectId?: string; roots?: string[] } = {},
) {
  if (!candidatePath) return ''
  const canonical = existingImagePath(candidatePath)
  if (!canonical) throw new Error('图片路径不存在、不是受支持的图片，或文件超过 40 MB')
  const keys = pathKeys(candidatePath, canonical)
  const persistedPath = persistedReferencePath(db, keys)
  if (persistedPath) return persistedPath
  if (
    isPreviewAuthorized(keys)
    || isWithinRoots(canonical, [...projectRoots(db, options.projectId), ...(options.roots || [])])
  ) return canonical
  throw new Error('图片路径未通过授权；请使用图片选择器，或选择项目仓库内的图片')
}
