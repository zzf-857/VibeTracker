import { app } from 'electron'
import path from 'node:path'

export const APP_NAME = 'VibeTracker'

app.setName(APP_NAME)

// Explicit opt-in overrides for isolated development/E2E runs. Production never sets these.
if (process.env.VIBETRACKER_APP_DATA_DIR && !app.isPackaged) {
  app.setPath('appData', path.resolve(process.env.VIBETRACKER_APP_DATA_DIR))
}

if (process.env.VIBETRACKER_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.VIBETRACKER_USER_DATA_DIR))
}

export const hasSingleInstanceLock = process.env.VIBETRACKER_ALLOW_MULTIPLE_INSTANCES === '1'
  || app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) app.exit(0)
