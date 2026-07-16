import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RendererTrustOptions {
  devServerUrl?: string
  rendererFile: string
}

function comparablePath(filePath: string) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

export function isTrustedRendererUrl(candidateUrl: string, options: RendererTrustOptions) {
  let candidate: URL
  try {
    candidate = new URL(candidateUrl)
  } catch {
    return false
  }

  if (options.devServerUrl) {
    try {
      const expected = new URL(options.devServerUrl)
      return ['http:', 'https:'].includes(candidate.protocol) && candidate.origin === expected.origin
    } catch {
      return false
    }
  }

  if (candidate.protocol !== 'file:' || candidate.hostname) return false
  try {
    return comparablePath(fileURLToPath(candidate)) === comparablePath(options.rendererFile)
  } catch {
    return false
  }
}
