import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 8_000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer)
        reject(new Error('timed out waiting for watchdog state'))
      }
    }, 25)
  })
}

test('Windows launch watchdog terminates its owned target when the parent lifetime pipe closes', {
  skip: process.platform !== 'win32',
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-watchdog-'))
  const pidPath = path.join(directory, 'target.pid')
  const watchdogPath = path.join(process.cwd(), 'electron', 'launchWatchdog.ts')
  const watchdog = spawn(process.execPath, ['--import', 'tsx', watchdogPath], {
    cwd: process.cwd(),
    windowsHide: true,
    shell: false,
    stdio: 'pipe',
  })
  let stderr = ''
  let targetPid = 0
  watchdog.stderr.setEncoding('utf8')
  watchdog.stderr.on('data', chunk => { stderr += String(chunk) })
  try {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const targetScript = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000)`
    watchdog.stdin.write(`${JSON.stringify({
      executable: process.execPath,
      args: ['-e', targetScript],
      cwd: process.cwd(),
      env,
    })}\n`)
    await waitFor(() => fs.existsSync(pidPath))
    targetPid = Number(fs.readFileSync(pidPath, 'utf8'))
    assert.ok(Number.isInteger(targetPid) && targetPid > 0)
    assert.equal(processExists(targetPid), true)

    watchdog.stdin.end()
    await Promise.race([
      once(watchdog, 'exit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('watchdog did not exit')), 8_000)),
    ])
    await waitFor(() => !processExists(targetPid))
    assert.equal(stderr, '')
  } finally {
    if (targetPid && processExists(targetPid)) {
      try { execFileSync('taskkill.exe', ['/pid', String(targetPid), '/t', '/f'], { windowsHide: true }) } catch { /* best effort */ }
    }
    if (watchdog.exitCode === null && watchdog.signalCode === null) watchdog.kill()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
