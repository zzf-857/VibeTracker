export const THUMBNAIL_SIZES = [96, 160, 240, 320, 480, 640, 960, 1280] as const

export function parseThumbnailSize(value: string | null) {
  if (value === null) return null
  if (!/^\d+$/.test(value)) throw new Error('缩略图尺寸无效')
  const size = Number(value)
  if (!(THUMBNAIL_SIZES as readonly number[]).includes(size)) {
    throw new Error('缩略图尺寸不在允许范围内')
  }
  return size
}

export type ThumbnailGenerator = (filePath: string, size: number) => Promise<Buffer>

interface ThumbnailServiceOptions {
  maxEntries?: number
  maxBytes?: number
}

export class ThumbnailService {
  private readonly cache = new Map<string, Buffer>()
  private readonly pending = new Map<string, Promise<Buffer>>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private cachedBytes = 0

  constructor(
    private readonly generate: ThumbnailGenerator,
    options: ThumbnailServiceOptions = {},
  ) {
    this.maxEntries = Math.max(1, Math.min(512, Math.trunc(options.maxEntries || 96)))
    this.maxBytes = Math.max(1024, Math.min(256 * 1024 * 1024, Math.trunc(options.maxBytes || 64 * 1024 * 1024)))
  }

  async get(filePath: string, version: string, size: number) {
    if (!(THUMBNAIL_SIZES as readonly number[]).includes(size)) throw new Error('缩略图尺寸无效')
    const key = `${filePath}\0${version}\0${size}`
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const active = this.pending.get(key)
    if (active) return active

    const work = this.generate(filePath, size).then(buffer => {
      if (!buffer.length) throw new Error('缩略图生成结果为空')
      this.remember(key, buffer)
      return buffer
    }).finally(() => {
      this.pending.delete(key)
    })
    this.pending.set(key, work)
    return work
  }

  private remember(key: string, buffer: Buffer) {
    if (buffer.length > this.maxBytes) return
    const previous = this.cache.get(key)
    if (previous) {
      this.cachedBytes -= previous.length
      this.cache.delete(key)
    }
    this.cache.set(key, buffer)
    this.cachedBytes += buffer.length
    while (this.cache.size > this.maxEntries || this.cachedBytes > this.maxBytes) {
      const oldest = this.cache.entries().next().value as [string, Buffer] | undefined
      if (!oldest) break
      this.cache.delete(oldest[0])
      this.cachedBytes -= oldest[1].length
    }
  }
}
