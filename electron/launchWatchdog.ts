import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_CONFIGURATION_BYTES = 4 * 1024 * 1024

interface WatchdogConfiguration {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

function parseConfiguration(value: string): WatchdogConfiguration {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('启动守护进程收到的配置不是有效 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('启动守护进程配置必须是对象')
  const input = parsed as Record<string, unknown>
  if (typeof input.executable !== 'string' || !input.executable || input.executable.includes('\0')) {
    throw new Error('启动守护进程缺少有效 executable')
  }
  if (!Array.isArray(input.args) || input.args.length > 1_000 || input.args.some(item => typeof item !== 'string' || item.includes('\0'))) {
    throw new Error('启动守护进程参数数组无效')
  }
  if (typeof input.cwd !== 'string' || !input.cwd || input.cwd.includes('\0')) throw new Error('启动守护进程工作目录无效')
  if (!input.env || typeof input.env !== 'object' || Array.isArray(input.env)) throw new Error('启动守护进程环境变量无效')
  const env: Record<string, string> = {}
  for (const [key, item] of Object.entries(input.env)) {
    if (typeof item !== 'string' || key.includes('\0') || item.includes('\0')) throw new Error('启动守护进程环境变量无效')
    env[key] = item
  }
  return { executable: input.executable, args: input.args as string[], cwd: input.cwd, env }
}

function processHasExited(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null
}

async function terminateTargetTree(child: ChildProcessWithoutNullStreams) {
  if (processHasExited(child) || !child.pid) return
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        timeout: 5_000,
      })
    } catch (error) {
      if (processHasExited(child)) return
      throw new Error(`启动守护进程无法清理目标进程树：${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (processHasExited(child)) return
    throw new Error(`启动守护进程无法清理目标进程组：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The watchdog owns the real launch process. Its stdin is a lifetime pipe held
 * only by VibeTracker. A hard application crash closes that pipe, allowing the
 * watchdog to terminate the exact child tree it still owns before exiting.
 */
export function runLaunchWatchdog() {
  let configurationBuffer = ''
  let configured = false
  let target: ChildProcessWithoutNullStreams | null = null
  let cleanupPromise: Promise<void> | null = null

  const finish = (code: number) => {
    process.exitCode = code
    setImmediate(() => process.exit(code))
  }

  const cleanupAfterParentExit = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      if (target) await terminateTargetTree(target)
    })().catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }).finally(() => finish(typeof process.exitCode === 'number' ? process.exitCode : 0))
    return cleanupPromise
  }

  const startTarget = (configuration: WatchdogConfiguration) => {
    if (configured) return
    configured = true
    try {
      const child = spawn(configuration.executable, configuration.args, {
        cwd: configuration.cwd,
        env: configuration.env,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: 'pipe',
      })
      // The target must not inherit the watchdog lifetime pipe. It receives a
      // separate stdin that is closed immediately, while stdout/stderr remain
      // available for Process Manager logs.
      child.stdin.end()
      target = child
    } catch (error) {
      process.stderr.write(`启动目标进程失败：${error instanceof Error ? error.message : String(error)}\n`)
      finish(127)
      return
    }
    if (!target) return
    const child = target
    child.stdout.pipe(process.stdout, { end: false })
    child.stderr.pipe(process.stderr, { end: false })
    child.once('error', error => {
      process.stderr.write(`启动目标进程失败：${error.message}\n`)
    })
    child.once('close', (code, signal) => {
      if (cleanupPromise) return
      if (signal) process.stderr.write(`目标进程被信号 ${signal} 终止\n`)
      finish(code === null ? 1 : code)
    })
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    if (configured) return
    configurationBuffer += chunk
    if (Buffer.byteLength(configurationBuffer, 'utf8') > MAX_CONFIGURATION_BYTES) {
      process.stderr.write('启动守护进程配置超过大小限制\n')
      finish(1)
      return
    }
    const newline = configurationBuffer.indexOf('\n')
    if (newline < 0) return
    const line = configurationBuffer.slice(0, newline)
    configurationBuffer = ''
    try { startTarget(parseConfiguration(line)) }
    catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      finish(1)
    }
  })
  process.stdin.once('end', () => { void cleanupAfterParentExit() })
  process.stdin.once('error', () => { void cleanupAfterParentExit() })
  process.stdin.resume()
}

if (require.main === module) runLaunchWatchdog()
