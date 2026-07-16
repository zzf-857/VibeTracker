import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toImageSrc, type ImageThumbnailSize } from '../lib/projectView'
import { useImagePreview } from './ImagePreview'

export function SafeImage({ 
  src, 
  alt, 
  className,
  previewable = false,
  thumbnailSize,
}: { 
  src: string; 
  alt: string; 
  className?: string;
  previewable?: boolean
  thumbnailSize?: ImageThumbnailSize
}) {
  const [failed, setFailed] = useState(false)
  const [resolvedSrc, setResolvedSrc] = useState('')
  const { showPreview } = useImagePreview()

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

      // Local images stream through a controlled protocol instead of permanent Base64 copies.
      if (!cancelled) setResolvedSrc(toImageSrc(src, thumbnailSize))
    }

    resolveImage()
    return () => {
      cancelled = true
    }
  }, [src, thumbnailSize])

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

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (previewable) {
      e.stopPropagation()
      showPreview(toImageSrc(src))
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLImageElement>) => {
    if (!previewable || !['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    showPreview(toImageSrc(src))
  }

  return (
    <img 
      src={resolvedSrc} 
      alt={alt} 
      role={previewable ? 'button' : undefined}
      tabIndex={previewable ? 0 : undefined}
      aria-label={previewable ? `预览图片：${alt}` : undefined}
      decoding="async"
      loading={thumbnailSize ? 'lazy' : 'eager'}
      className={`${className || ''} ${previewable ? 'cursor-zoom-in transition-all duration-200 hover:brightness-105' : ''}`} 
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onError={() => setFailed(true)} 
    />
  )
}
