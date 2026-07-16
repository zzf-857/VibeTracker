import { nativeImage, net, protocol } from 'electron'
import type Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAssetPathAllowed } from './services/assetPolicy'
import { parseThumbnailSize, ThumbnailService } from './services/thumbnailService'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'vibe-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }])
}

export function setupAssetProtocol(db: Database.Database) {
  const thumbnails = new ThumbnailService(async (filePath, size) => {
    const image = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size })
    if (image.isEmpty()) throw new Error('图片无法生成缩略图')
    return image.toPNG()
  })
  protocol.handle('vibe-asset', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response('Not found', { status: 404 })
      let thumbnailSize: number | null
      try {
        thumbnailSize = parseThumbnailSize(url.searchParams.get('size'))
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Invalid thumbnail size', { status: 400 })
      }
      const filePath = path.resolve(decodeURIComponent(url.pathname.slice(1)))
      if (!path.isAbsolute(filePath) || !IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return new Response('Unsupported asset', { status: 400 })
      }
      if (!isAssetPathAllowed(db, filePath)) return new Response('Asset not authorized', { status: 403 })
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size > 40 * 1024 * 1024) return new Response('Asset unavailable', { status: 404 })
      if (thumbnailSize) {
        try {
          const buffer = await thumbnails.get(filePath, `${stat.size}:${stat.mtimeMs}`, thumbnailSize)
          return new Response(new Uint8Array(buffer), {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Length': String(buffer.length),
              'Content-Type': 'image/png',
              'X-Content-Type-Options': 'nosniff',
              'X-Vibe-Asset-Variant': 'thumbnail',
              'X-Vibe-Thumbnail-Size': String(thumbnailSize),
            },
          })
        } catch (error) {
          console.warn('[Assets] Thumbnail generation failed; falling back to the original image:', error instanceof Error ? error.message : String(error))
        }
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Asset unavailable', { status: 404 })
    }
  })
}
