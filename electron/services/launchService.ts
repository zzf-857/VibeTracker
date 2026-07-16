import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { validateLaunchProfile, type LaunchProfileInput } from './validation'

const execFileAsync = promisify(execFile)

export type LaunchStateName = 'starting' | 'running' | 'ready' | 'failed' | 'stopped'

export interface LaunchProfile extends LaunchProfileInput {
  id: string
  validated: boolean
  confirmedHash: string
  createdAt: number
  updatedAt: number
}

export interface LaunchRuntimeState {
  profileId: string
  projectId: string
  state: LaunchStateName
  pid: number | null
  startedAt: number | null
  stoppedAt: number | null
  error: string
  logs: Array<{ stream: 'stdout' | 'stderr' | 'system'; text: string; timestamp: number }>
}

export type PersistedLaunchStateName = LaunchStateName | 'interrupted'

export interface LaunchRunHistoryStore {
  begin(profile: LaunchProfile, state: LaunchRuntimeState): string
  update(runId: string, state: LaunchRuntimeState): void
}

export interface LaunchRunServiceOptions {
  sessionId?: string
  now?: () => number
  processExists?: (pid: number) => boolean
}

function parseJson<T>(value: unknown, fallback: T) {
  try { return JSON.parse(String(value || '')) as T } catch { return fallback }
}

export function launchProfileHash(profile: Pick<LaunchProfileInput, 'executable' | 'args' | 'cwd' | 'env' | 'readyUrl' | 'readyPort'>) {
  return createHash('sha256').update(JSON.stringify({
    executable: profile.executable,
    args: profile.args,
    cwd: profile.cwd,
    env: Object.fromEntries(Object.entries(profile.env).sort(([a], [b]) => a.localeCompare(b))),
    readyUrl: profile.readyUrl,
    readyPort: profile.readyPort,
  })).digest('hex')
}

export class LaunchProfileService {
  constructor(private readonly db: Database.Database) {}

  private hydrate(row: Record<string, unknown>): LaunchProfile {
    return {
      id: String(row.id), projectId: String(row.projectId), name: String(row.name),
      executable: String(row.executable), args: parseJson<string[]>(row.argsJson, []), cwd: String(row.cwd),
      env: parseJson<Record<string, string>>(row.envJson, {}), readyUrl: String(row.readyUrl || ''),
      readyPort: row.readyPort === null || row.readyPort === undefined ? null : Number(row.readyPort),
      enabled: Number(row.enabled) === 1, validated: Number(row.validated) === 1,
      confirmedHash: String(row.confirmedHash || ''), createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt),
    }
  }

  list(projectId: string) {
    return (this.db.prepare('SELECT * FROM launch_profiles WHERE projectId = ? ORDER BY updatedAt DESC').all(projectId) as Record<string, unknown>[])
      .map(row => this.hydrate(row))
  }

  get(profileId: string) {
    const row = this.db.prepare('SELECT * FROM launch_profiles WHERE id = ?').get(profileId) as Record<string, unknown> | undefined
    return row ? this.hydrate(row) : null
  }

  async save(value: unknown) {
    let input = validateLaunchProfile(value)
    if (process.platform === 'win32' && /(?:^|[\\/])npm\.cmd$/i.test(input.executable)) {
      try {
        const result = await execFileAsync('where.exe', ['npm.cmd'], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
        const npmCommand = result.stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean)
        if (!npmCommand) throw new Error('npm.cmd 不在 PATH 中')
        const directory = path.dirname(npmCommand)
        const nodeExecutable = path.join(directory, 'node.exe')
        const npmCli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        await Promise.all([fs.access(nodeExecutable), fs.access(npmCli)])
        input = { ...input, executable: nodeExecutable, args: [npmCli, ...input.args] }
      } catch (error) {
        throw new Error(`无法将 npm.cmd 解析为安全的无 Shell 启动方式: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(input.executable)) {
      throw new Error('为避免 Shell 注入，Windows .cmd/.bat 不能直接启动；请配置对应的 .exe 与参数数组')
    }
    const stat = await fs.stat(input.cwd).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('启动工作目录不存在')
    const existing = input.id ? this.get(input.id) : null
    if (existing && existing.projectId !== input.projectId) throw new Error('启动配置不属于该项目')
    const id = existing?.id || randomUUID()
    const now = Date.now()
    const nextHash = launchProfileHash(input)
    const remainsValidated = Boolean(existing?.validated && existing.confirmedHash === nextHash)
    this.db.prepare(`
      INSERT INTO launch_profiles (
        id, projectId, name, executable, argsJson, cwd, envJson, readyUrl, readyPort,
        enabled, validated, confirmedHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, executable = excluded.executable, argsJson = excluded.argsJson,
        cwd = excluded.cwd, envJson = excluded.envJson, readyUrl = excluded.readyUrl,
        readyPort = excluded.readyPort, enabled = excluded.enabled, validated = excluded.validated,
        confirmedHash = excluded.confirmedHash, updatedAt = excluded.updatedAt
    `).run(
      id, input.projectId, input.name, input.executable, JSON.stringify(input.args), input.cwd,
      JSON.stringify(input.env), input.readyUrl, input.readyPort, input.enabled ? 1 : 0,
      remainsValidated ? 1 : 0, remainsValidated ? nextHash : '', existing?.createdAt || now, now,
    )
    return this.get(id)!
  }

  confirm(profileId: string) {
    const profile = this.get(profileId)
    if (!profile) throw new Error('启动配置不存在')
    const hash = launchProfileHash(profile)
    this.db.prepare('UPDATE launch_profiles SET validated = 1, confirmedHash = ?, updatedAt = ? WHERE id = ?')
      .run(hash, Date.now(), profileId)
    return this.get(profileId)!
  }

  delete(profileId: string) {
    return this.db.prepare('DELETE FROM launch_profiles WHERE id = ?').run(profileId).changes > 0
  }
}

const MAX_PERSISTED_LAUNCH_LOGS = 100
const MAX_PERSISTED_LAUNCH_LOG_BYTES = 128 * 1024

function boundedLaunchLogs(logs: LaunchRuntimeState['logs']) {
  const bounded = logs.slice(-MAX_PERSISTED_LAUNCH_LOGS).map(log => ({
    stream: log.stream,
    text: String(log.text || '').slice(0, 4_000),
    timestamp: Number(log.timestamp || 0),
  }))
  while (bounded.length > 1 && Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_PERSISTED_LAUNCH_LOG_BYTES) {
    bounded.shift()
  }
  return bounded
}

function defaultProcessExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class LaunchRunService implements LaunchRunHistoryStore {
  private readonly sessionId: string
  private readonly now: () => number
  private readonly processExists: (pid: number) => boolean

  constructor(private readonly db: Database.Database, options: LaunchRunServiceOptions = {}) {
    this.sessionId = options.sessionId || randomUUID()
    this.now = options.now ?? Date.now
    this.processExists = options.processExists ?? defaultProcessExists
  }

  begin(profile: LaunchProfile, state: LaunchRuntimeState) {
    const id = randomUUID()
    const now = this.now()
    this.db.prepare(`
      INSERT INTO launch_runs (
        id, profileId, projectId, sessionId, commandHash, pid, state,
        startedAt, updatedAt, stoppedAt, error, logsJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, profile.id, profile.projectId, this.sessionId, launchProfileHash(profile), state.pid,
      state.state, state.startedAt || now, now, state.stoppedAt, state.error,
      JSON.stringify(boundedLaunchLogs(state.logs)),
    )
    return id
  }

  update(runId: string, state: LaunchRuntimeState) {
    this.db.prepare(`
      UPDATE launch_runs SET
        pid = ?, state = ?, updatedAt = ?, stoppedAt = ?, error = ?, logsJson = ?
      WHERE id = ?
    `).run(
      state.pid, state.state, this.now(), state.stoppedAt, state.error,
      JSON.stringify(boundedLaunchLogs(state.logs)), runId,
    )
  }

  recoverInterrupted() {
    const rows = this.db.prepare(`
      SELECT id, pid, state, logsJson FROM launch_runs
      WHERE state IN ('starting', 'running', 'ready')
        OR (state = 'failed' AND pid IS NOT NULL AND stoppedAt IS NULL)
    `).all() as Array<Record<string, unknown>>
    const now = this.now()
    const update = this.db.prepare(`
      UPDATE launch_runs SET state = 'interrupted', updatedAt = ?, stoppedAt = ?, error = ?, logsJson = ?
      WHERE id = ?
    `)
    const recover = this.db.transaction(() => {
      for (const row of rows) {
        const pid = row.pid === null || row.pid === undefined ? null : Number(row.pid)
        const alive = pid !== null && this.processExists(pid)
        const error = alive
          ? `应用上次异常退出时启动进程仍未结束；检测到 PID ${pid} 当前存在，但可能已被系统复用。请先核对系统进程再重新启动。`
          : '应用上次异常退出时启动任务仍在进行；已确认原 PID 当前不存在，可以重新启动。'
        const logs = boundedLaunchLogs([
          ...parseJson<LaunchRuntimeState['logs']>(row.logsJson, []),
          { stream: 'system', text: error, timestamp: now },
        ])
        update.run(now, now, error, JSON.stringify(logs), row.id)
      }
    })
    recover()
    return rows.length
  }

  private runtimeFromRow(row: Record<string, unknown>): LaunchRuntimeState {
    const persistedState = String(row.state) as PersistedLaunchStateName
    const state: LaunchStateName = persistedState === 'interrupted' ? 'failed' : persistedState
    const logs = parseJson<LaunchRuntimeState['logs']>(row.logsJson, []).filter(log => (
      log && ['stdout', 'stderr', 'system'].includes(log.stream)
        && typeof log.text === 'string' && Number.isFinite(log.timestamp)
    ))
    return {
      profileId: String(row.profileId),
      projectId: String(row.projectId),
      state,
      // A recovered run is diagnostic history, not a process handle owned by
      // this ProcessManager instance. Never expose its PID as stoppable.
      pid: persistedState === 'interrupted' || row.pid === null || row.pid === undefined ? null : Number(row.pid),
      startedAt: row.startedAt === null || row.startedAt === undefined ? null : Number(row.startedAt),
      stoppedAt: row.stoppedAt === null || row.stoppedAt === undefined ? null : Number(row.stoppedAt),
      error: String(row.error || ''),
      logs,
    }
  }

  getLatestRuntime(profileId: string) {
    const row = this.db.prepare(`
      SELECT * FROM launch_runs WHERE profileId = ? ORDER BY startedAt DESC, id DESC LIMIT 1
    `).get(profileId) as Record<string, unknown> | undefined
    return row ? this.runtimeFromRow(row) : null
  }

  listCurrentFailures(limit = 20) {
    const rows = this.db.prepare(`
      SELECT current.* FROM launch_runs current
      WHERE current.id = (
        SELECT latest.id FROM launch_runs latest
        WHERE latest.profileId = current.profileId
        ORDER BY latest.startedAt DESC, latest.id DESC LIMIT 1
      ) AND current.state IN ('failed', 'interrupted')
      ORDER BY current.updatedAt DESC, current.id DESC LIMIT ?
    `).all(Math.min(Math.max(limit, 1), 100)) as Array<Record<string, unknown>>
    return rows.map(row => ({
      runId: String(row.id),
      profileId: String(row.profileId),
      projectId: String(row.projectId),
      state: String(row.state) as 'failed' | 'interrupted',
      error: String(row.error || ''),
      updatedAt: Number(row.updatedAt || 0),
    }))
  }
}

type SpawnImplementation = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

function windowsWatchdogConfiguration(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) {
  const env = Object.fromEntries(Object.entries(options.env || process.env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return JSON.stringify({
    executable: command,
    args: [...args],
    cwd: typeof options.cwd === 'string' ? options.cwd : process.cwd(),
    env,
  })
}

function spawnWithWindowsWatchdog(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) {
  // tsc preserves services/launchService.js while Vite bundles it into
  // dist-electron/main.js. Resolve both layouts without relying on cwd.
  const watchdogDirectory = path.basename(__dirname) === 'services' ? path.dirname(__dirname) : __dirname
  const watchdogPath = path.join(watchdogDirectory, 'launchWatchdog.js')
  const helper = spawn(process.execPath, [watchdogPath], {
    // __dirname lives inside app.asar in packaged builds and is not a valid
    // Windows CreateProcess working directory. The executable directory is a
    // real path in both development and packaged layouts.
    cwd: path.dirname(process.execPath),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    shell: false,
    stdio: 'pipe',
  })
  helper.stdin.on('error', () => undefined)
  try {
    helper.stdin.write(`${windowsWatchdogConfiguration(command, args, options)}\n`)
  } catch (error) {
    helper.kill()
    throw error
  }
  return helper
}

interface RuntimeInternal {
  child: ChildProcessWithoutNullStreams
  state: LaunchRuntimeState
  runId: string
  persistenceTimer: NodeJS.Timeout | null
  stopRequested: boolean
  readinessTimer: NodeJS.Timeout | null
  readinessDeadline: number
  readinessCheckInFlight: boolean
  exited: boolean
  exitPromise: Promise<void>
  resolveExit: () => void
  stopPromise: Promise<LaunchRuntimeState> | null
  exitOutcome: { state: 'stopped' | 'failed'; error: string } | null
  processError: string
}

type TerminateImplementation = (child: ChildProcessWithoutNullStreams, force: boolean) => Promise<void>

export interface ProcessManagerOptions {
  readinessTimeoutMs?: number
  readinessPollIntervalMs?: number
  readinessUrlTimeoutMs?: number
  readinessPortTimeoutMs?: number
  gracefulStopTimeoutMs?: number
  forceStopTimeoutMs?: number
  terminateProcess?: TerminateImplementation
  now?: () => number
  history?: LaunchRunHistoryStore
  windowsWatchdog?: boolean
}

export class ProcessManager {
  private readonly runtimes = new Map<string, RuntimeInternal>()
  private readonly readinessTimeoutMs: number
  private readonly readinessPollIntervalMs: number
  private readonly readinessUrlTimeoutMs: number
  private readonly readinessPortTimeoutMs: number
  private readonly gracefulStopTimeoutMs: number
  private readonly forceStopTimeoutMs: number
  private readonly terminateProcess: TerminateImplementation
  private readonly now: () => number
  private readonly history?: LaunchRunHistoryStore
  private readonly spawnProcess: SpawnImplementation

  constructor(
    private readonly onStateChange: (state: LaunchRuntimeState) => void = () => undefined,
    spawnProcess?: SpawnImplementation,
    options: ProcessManagerOptions = {},
  ) {
    this.spawnProcess = spawnProcess ?? (
      process.platform === 'win32' && options.windowsWatchdog !== false
        ? spawnWithWindowsWatchdog
        : ((command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, stdio: 'pipe' }))
    )
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 30_000
    this.readinessPollIntervalMs = options.readinessPollIntervalMs ?? 500
    this.readinessUrlTimeoutMs = options.readinessUrlTimeoutMs ?? 1_000
    this.readinessPortTimeoutMs = options.readinessPortTimeoutMs ?? 500
    this.gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? 3_000
    this.forceStopTimeoutMs = options.forceStopTimeoutMs ?? 5_000
    this.terminateProcess = options.terminateProcess ?? ((child, force) => this.defaultTerminateProcess(child, force))
    this.now = options.now ?? Date.now
    this.history = options.history
  }

  private snapshot(runtime: RuntimeInternal): LaunchRuntimeState {
    return { ...runtime.state, logs: [...runtime.state.logs] }
  }

  private persist(runtime: RuntimeInternal, immediate = false) {
    if (!runtime.runId || !this.history) return
    const write = () => {
      runtime.persistenceTimer = null
      try { this.history?.update(runtime.runId, this.snapshot(runtime)) }
      catch (error) { console.error('[Launch] Unable to persist run state:', error) }
    }
    if (immediate) {
      if (runtime.persistenceTimer) clearTimeout(runtime.persistenceTimer)
      write()
      return
    }
    if (runtime.persistenceTimer) return
    runtime.persistenceTimer = setTimeout(write, 250)
    runtime.persistenceTimer.unref?.()
  }

  private emit(runtime: RuntimeInternal, persistImmediately = false) {
    this.onStateChange(this.snapshot(runtime))
    this.persist(runtime, persistImmediately)
  }

  private setState(runtime: RuntimeInternal, state: LaunchStateName, error = '') {
    runtime.state.state = state
    runtime.state.error = error
    if ((state === 'stopped' || state === 'failed') && runtime.exited) runtime.state.stoppedAt = this.now()
    this.emit(runtime, true)
  }

  private log(runtime: RuntimeInternal, stream: 'stdout' | 'stderr' | 'system', text: string) {
    const cleaned = text.split('\0').join('').slice(0, 20_000)
    if (!cleaned) return
    runtime.state.logs.push({ stream, text: cleaned, timestamp: this.now() })
    if (runtime.state.logs.length > 500) runtime.state.logs.splice(0, runtime.state.logs.length - 500)
    this.emit(runtime)
  }

  get(profileId: string) {
    const runtime = this.runtimes.get(profileId)
    return runtime ? this.snapshot(runtime) : null
  }

  list() {
    return [...this.runtimes.values()].map(runtime => this.snapshot(runtime))
  }

  start(profile: LaunchProfile) {
    if (!profile.enabled) throw new Error('启动配置已禁用')
    if (!profile.validated || profile.confirmedHash !== launchProfileHash(profile)) {
      throw new Error('启动配置尚未由用户确认，或配置已发生变化')
    }
    const otherProjectRuntime = [...this.runtimes.entries()].find(([profileId, runtime]) => (
      profileId !== profile.id && runtime.state.projectId === profile.projectId && !runtime.exited
    ))
    if (otherProjectRuntime) {
      throw new Error(`该项目已有另一个启动配置正在运行（${otherProjectRuntime[0]}），请先停止`)
    }
    const current = this.runtimes.get(profile.id)
    if (current && !current.exited) {
      if (['starting', 'running', 'ready'].includes(current.state.state)) return this.snapshot(current)
      throw new Error(`上一次启动的进程尚未确认退出，不能重复启动${current.state.error ? `：${current.state.error}` : ''}`)
    }

    const startedAt = this.now()
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnProcess(profile.executable, profile.args, {
        cwd: profile.cwd,
        env: { ...process.env, ...profile.env },
        windowsHide: true,
        shell: false,
        // A separate process group lets POSIX builds stop the complete launch
        // tree, matching taskkill /T on Windows.
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: LaunchRuntimeState = {
        profileId: profile.id, projectId: profile.projectId, state: 'failed', pid: null,
        startedAt, stoppedAt: startedAt, error: message,
        logs: [{ stream: 'system', text: message, timestamp: startedAt }],
      }
      try { this.history?.begin(profile, failed) }
      catch (historyError) { console.error('[Launch] Unable to persist synchronous spawn failure:', historyError) }
      throw error
    }
    let resolveExit: () => void = () => undefined
    const exitPromise = new Promise<void>(resolve => { resolveExit = resolve })
    const runtime: RuntimeInternal = {
      child,
      runId: '',
      persistenceTimer: null,
      stopRequested: false,
      readinessTimer: null,
      readinessDeadline: startedAt + this.readinessTimeoutMs,
      readinessCheckInFlight: false,
      exited: false,
      exitPromise,
      resolveExit,
      stopPromise: null,
      exitOutcome: null,
      processError: '',
      state: {
        profileId: profile.id, projectId: profile.projectId, state: 'starting', pid: child.pid || null,
        startedAt, stoppedAt: null, error: '', logs: [],
      },
    }
    this.runtimes.set(profile.id, runtime)
    try { runtime.runId = this.history?.begin(profile, this.snapshot(runtime)) || '' }
    catch (error) { console.error('[Launch] Unable to persist run start:', error) }
    this.log(runtime, 'system', `启动 ${profile.executable} ${profile.args.join(' ')}`)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => this.log(runtime, 'stdout', String(chunk)))
    child.stderr.on('data', chunk => this.log(runtime, 'stderr', String(chunk)))
    child.once('spawn', () => {
      runtime.state.pid = child.pid || null
      this.setState(runtime, 'running')
      if (!profile.readyUrl && !profile.readyPort) {
        this.log(runtime, 'system', '未配置就绪 URL 或端口；进程保持运行中')
      } else {
        runtime.readinessTimer = setInterval(
          () => void this.checkReadiness(runtime, profile),
          this.readinessPollIntervalMs,
        )
      }
    })
    child.once('error', error => {
      this.clearReadiness(runtime)
      runtime.processError = error.message
      this.log(runtime, 'system', error.message)
      this.setState(runtime, 'failed', error.message)
    })
    const finalizeExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (runtime.exited) return
      this.clearReadiness(runtime)
      runtime.exited = true
      runtime.state.pid = null
      const detail = `进程退出（code=${code ?? 'null'}, signal=${signal || 'none'}）`
      this.log(runtime, 'system', detail)
      if (runtime.exitOutcome) {
        this.setState(runtime, runtime.exitOutcome.state, runtime.exitOutcome.error)
      } else if (runtime.stopRequested || code === 0) {
        this.setState(runtime, 'stopped')
      } else {
        this.setState(runtime, 'failed', runtime.processError || detail)
      }
      runtime.resolveExit()
    }
    // exit is the authoritative child lifecycle signal. close is retained as
    // the fallback for spawn failures, where Node may not emit exit.
    child.once('exit', finalizeExit)
    child.once('close', finalizeExit)
    return this.snapshot(runtime)
  }

  private clearReadiness(runtime: RuntimeInternal) {
    if (runtime.readinessTimer) clearInterval(runtime.readinessTimer)
    runtime.readinessTimer = null
  }

  private async checkReadiness(runtime: RuntimeInternal, profile: LaunchProfile) {
    if (!['running', 'starting'].includes(runtime.state.state)) return this.clearReadiness(runtime)
    if (runtime.readinessCheckInFlight) return
    if (this.now() >= runtime.readinessDeadline) {
      this.clearReadiness(runtime)
      const error = `进程已启动，但在 ${this.readinessTimeoutMs} 毫秒内未达到就绪状态`
      this.log(runtime, 'system', '等待就绪状态超时，正在强制停止进程')
      runtime.exitOutcome = { state: 'failed', error }
      this.setState(runtime, 'failed', error)
      void this.beginTermination(runtime, {
        forceImmediately: true,
        exitState: 'failed',
        exitError: error,
        failurePrefix: '就绪超时后的强制停止失败',
      }).catch(terminationError => {
        console.error('[Launch] Readiness timeout process termination failed:', terminationError)
      })
      return
    }
    runtime.readinessCheckInFlight = true
    try {
      const checks: Promise<boolean>[] = []
      if (profile.readyPort) checks.push(this.isPortReady(profile.readyPort))
      if (profile.readyUrl) checks.push(this.isUrlReady(profile.readyUrl))
      if ((await Promise.all(checks)).some(Boolean)) {
        this.clearReadiness(runtime)
        this.setState(runtime, 'ready')
      }
    } finally {
      runtime.readinessCheckInFlight = false
    }
  }

  private async isUrlReady(url: string) {
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(this.readinessUrlTimeoutMs) })
      if (head.ok) return true
      if (![405, 501].includes(head.status)) return false
      const get = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(this.readinessUrlTimeoutMs),
      })
      return get.ok
    } catch {
      return false
    }
  }

  private isPortReady(port: number) {
    return new Promise<boolean>(resolve => {
      const socket = net.createConnection({ port, host: '127.0.0.1' })
      const done = (ready: boolean) => { socket.destroy(); resolve(ready) }
      socket.setTimeout(this.readinessPortTimeoutMs)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
    })
  }

  async stop(profileId: string) {
    const runtime = this.runtimes.get(profileId)
    if (!runtime) return null
    if (runtime.exited) return this.snapshot(runtime)
    if (runtime.stopPromise) return runtime.stopPromise
    this.log(runtime, 'system', '正在停止进程…')
    return this.beginTermination(runtime, {
      forceImmediately: false,
      exitState: 'stopped',
      exitError: '',
      failurePrefix: '停止进程失败',
    })
  }

  async stopAll() {
    const results = await Promise.allSettled([...this.runtimes.keys()].map(profileId => this.stop(profileId)))
    this.throwStopFailures(results, '部分启动进程无法安全停止')
  }

  async stopProject(projectId: string) {
    const profileIds = [...this.runtimes.entries()]
      .filter(([, runtime]) => runtime.state.projectId === projectId)
      .map(([profileId]) => profileId)
    const results = await Promise.allSettled(profileIds.map(profileId => this.stop(profileId)))
    profileIds.forEach(profileId => {
      if (this.runtimes.get(profileId)?.exited) this.runtimes.delete(profileId)
    })
    this.throwStopFailures(results, '该项目仍有无法安全停止的启动进程')
  }

  async dispose(profileId: string) {
    const runtime = this.runtimes.get(profileId)
    if (!runtime) return null
    const state = await this.stop(profileId)
    if (!runtime.exited) throw new Error('启动进程尚未确认退出，不能删除启动配置')
    this.runtimes.delete(profileId)
    return state
  }

  private beginTermination(runtime: RuntimeInternal, options: {
    forceImmediately: boolean
    exitState: 'stopped' | 'failed'
    exitError: string
    failurePrefix: string
  }) {
    if (runtime.stopPromise) return runtime.stopPromise
    runtime.stopRequested = true
    runtime.exitOutcome = { state: options.exitState, error: options.exitError }
    this.clearReadiness(runtime)
    const operation = this.terminateAndWait(runtime, options)
    runtime.stopPromise = operation
    operation.then(
      () => { if (runtime.stopPromise === operation) runtime.stopPromise = null },
      () => { if (runtime.stopPromise === operation) runtime.stopPromise = null },
    )
    return operation
  }

  private async terminateAndWait(runtime: RuntimeInternal, options: {
    forceImmediately: boolean
    exitState: 'stopped' | 'failed'
    exitError: string
    failurePrefix: string
  }) {
    try {
      if (options.forceImmediately) {
        await this.requestTermination(runtime, true)
        if (!await this.waitForExit(runtime, this.forceStopTimeoutMs)) {
          throw new Error(`强制停止命令已执行，但 ${this.forceStopTimeoutMs} 毫秒内未确认进程退出`)
        }
      } else {
        await this.requestTermination(runtime, false)
        if (!await this.waitForExit(runtime, this.gracefulStopTimeoutMs)) {
          this.log(runtime, 'system', '进程未及时退出，正在强制停止…')
          await this.requestTermination(runtime, true)
          if (!await this.waitForExit(runtime, this.forceStopTimeoutMs)) {
            throw new Error(`强制停止命令已执行，但 ${this.forceStopTimeoutMs} 毫秒内未确认进程退出`)
          }
        }
      }
      return this.snapshot(runtime)
    } catch (error) {
      if (runtime.exited) return this.snapshot(runtime)
      const detail = error instanceof Error ? error.message : String(error)
      const message = `${options.failurePrefix}：${detail}；进程可能仍在运行，可重试停止`
      runtime.exitOutcome = { state: 'failed', error: message }
      this.log(runtime, 'system', message)
      this.setState(runtime, 'failed', message)
      throw new Error(message, { cause: error })
    }
  }

  private async requestTermination(runtime: RuntimeInternal, force: boolean) {
    if (runtime.exited) return
    try {
      await this.terminateProcess(runtime.child, force)
    } catch (error) {
      // A process can exit between issuing a platform command and receiving its
      // failure result. Give the close event one turn before reporting failure.
      if (await this.waitForExit(runtime, 50)) return
      throw error
    }
  }

  private waitForExit(runtime: RuntimeInternal, timeoutMs: number) {
    if (runtime.exited) return Promise.resolve(true)
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      runtime.exitPromise.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  private async defaultTerminateProcess(child: ChildProcessWithoutNullStreams, force: boolean) {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (process.platform === 'win32') {
      if (!child.pid) throw new Error('子进程没有可用于 taskkill 的 PID')
      // taskkill cannot reliably terminate console process trees without /F.
      // It still returns before Node emits close, so callers must keep waiting
      // on runtime.exitPromise after the command succeeds.
      const args = ['/pid', String(child.pid), '/t', '/f']
      try {
        await execFileAsync('taskkill', args, { windowsHide: true, timeout: 5_000 })
      } catch (error) {
        throw new Error(`taskkill 强制停止失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    const signal = force ? 'SIGKILL' : 'SIGTERM'
    if (!child.pid) throw new Error(`子进程没有可用于发送 ${signal} 的 PID`)
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) return
      throw new Error(`无法向子进程组发送 ${signal}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private throwStopFailures(results: PromiseSettledResult<LaunchRuntimeState | null>[], message: string) {
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason)
    if (failures.length) {
      const detail = failures
        .map(error => error instanceof Error ? error.message : String(error))
        .join('；')
      throw new AggregateError(failures, `${message}：${detail}`)
    }
  }
}
