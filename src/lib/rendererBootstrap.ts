export const RENDERER_BOOT_ELEMENT_ID = 'vibetracker-boot'
export const EXPECTED_VIBE_API_VERSION = 1

export interface RendererBridgePresence {
  vibe?: unknown
}

export function getMissingRendererBridges(bridges: RendererBridgePresence) {
  const missing: string[] = []
  if (!bridges.vibe) {
    missing.push('window.vibe')
  } else if (
    typeof bridges.vibe !== 'object'
    || bridges.vibe === null
    || (bridges.vibe as { apiVersion?: unknown }).apiVersion !== EXPECTED_VIBE_API_VERSION
  ) {
    missing.push(`window.vibe.apiVersion=${EXPECTED_VIBE_API_VERSION}`)
  }
  return missing
}
