import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toImageSrc } from '../lib/projectView'

export function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)

  if (failed || !src) {
    return (
      <div className="w-full h-full grid place-items-center bg-bg-tertiary text-text-tertiary">
        <div className="flex flex-col items-center gap-2 text-[11px]">
          <ImageOff size={18} />
          图片不可用
        </div>
      </div>
    )
  }

  return <img src={toImageSrc(src)} alt={alt} className={className} onError={() => setFailed(true)} />
}
