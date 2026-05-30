import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toImageSrc } from '../lib/projectView'

const imageCache = new Map<string, string>()
const MAX_CACHE_SIZE = 100

function writeCache(key: string, value: string) {
  if (imageCache.size >= MAX_CACHE_SIZE) {
    const firstKey = imageCache.keys().next().value
    if (firstKey !== undefined) {
      imageCache.delete(firstKey)
    }
  }
  imageCache.set(key, value)
}

export function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const [resolvedSrc, setResolvedSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    setFailed(false)

    async function resolveImage() {
      if (!src) {
        setResolvedSrc('')
        return
      }

      if (/^(data|https?):/i.test(src)) {
        setResolvedSrc(src)
        return
      }

      // Check Cache First
      if (imageCache.has(src)) {
        setResolvedSrc(imageCache.get(src)!)
        return
      }

      try {
        const dataUrl = await window.ipcRenderer.invoke('read-image-data-url', src)
        if (!cancelled) {
          const finalSrc = dataUrl || toImageSrc(src)
          setResolvedSrc(finalSrc)
          if (dataUrl) {
            writeCache(src, dataUrl)
          }
        }
      } catch {
        if (!cancelled) {
          setResolvedSrc(toImageSrc(src))
        }
      }
    }

    resolveImage()
    return () => {
      cancelled = true
    }
  }, [src])

  if (failed || !src || !resolvedSrc) {
    return (
      <div className="w-full h-full grid place-items-center bg-bg-tertiary text-text-tertiary">
        <div className="flex flex-col items-center gap-2 text-[11px]">
          <ImageOff size={18} />
          图片不可用
        </div>
      </div>
    )
  }

  return <img src={resolvedSrc} alt={alt} className={className} onError={() => setFailed(true)} />
}
