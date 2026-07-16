import fs from 'node:fs'
import path from 'node:path'

const workspace = path.resolve(process.cwd())
const target = path.resolve(workspace, 'dist-electron')

if (path.dirname(target) !== workspace || path.basename(target) !== 'dist-electron') {
  throw new Error(`Refusing to clean unexpected Electron output path: ${target}`)
}

fs.rmSync(target, { recursive: true, force: true })
