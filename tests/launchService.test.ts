import assert from 'node:assert/strict'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  LaunchRunService,
  ProcessManager,
  launchProfileHash,
  type LaunchProfile,
  type LaunchStateName,
  type ProcessManagerOptions,
} from '../electron/services/launchService.ts'
import { migrateDatabase } from '../electron/services/databaseMigrations.ts'

function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve() }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error('timed out')) }
    }, 10)
  })
}

function makeProfile(id: string, overrides: Partial<LaunchProfile> = {}): LaunchProfile {
  const profile: LaunchProfile = {
    id,
    projectId: 'project-1',
    name: id,
    executable: process.execPath,
    args: ['-e', "console.log('ready-log'); setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    env: {},
    readyUrl: '',
    readyPort: null,
    enabled: true,
    validated: true,
    confirmedHash: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
  profile.confirmedHash = launchProfileHash(profile)
  return profile
}

async function terminateDirectly(child: ChildProcessWithoutNullStreams, force: boolean) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (!child.kill(force ? 'SIGKILL' : 'SIGTERM')) throw new Error('direct kill failed')
}

function createManager(
  onStateChange: (state: { state: LaunchStateName }) => void = () => undefined,
  options: ProcessManagerOptions = {},
) {
  return new ProcessManager(onStateChange, undefined, {
    gracefulStopTimeoutMs: 500,
    forceStopTimeoutMs: 500,
    terminateProcess: terminateDirectly,
    windowsWatchdog: false,
    ...options,
  })
}

function createLaunchHistoryFixture(options: { now?: () => number; processExists?: (pid: number) => boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-launch-history-'))
  const dbPath = path.join(directory, 'launch.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  migrateDatabase(db, { dbPath })
  db.prepare('INSERT INTO projects (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run('project-1', 'Launch history', 1, 1)
  const compatibleDatabase = {
    prepare: (sql: string) => db.prepare(sql),
    transaction: (operation: () => unknown) => () => {
      db.exec('BEGIN')
      try {
        const result = operation()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  const profile = makeProfile('profile-1')
  db.prepare(`
    INSERT INTO launch_profiles (
      id, projectId, name, executable, argsJson, cwd, envJson, readyUrl, readyPort,
      enabled, validated, confirmedHash, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.id, profile.projectId, profile.name, profile.executable, JSON.stringify(profile.args),
    profile.cwd, JSON.stringify(profile.env), profile.readyUrl, profile.readyPort,
    1, 1, profile.confirmedHash, profile.createdAt, profile.updatedAt,
  )
  const service = new LaunchRunService(compatibleDatabase as never, {
    sessionId: 'test-session',
    ...options,
  })
  return { directory, db, profile, service }
}

type TestServer = HttpServer | NetServer

function listen(server: TestServer) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('server address unavailable'))
      else resolve(address.port)
    })
  })
}

function close(server: TestServer) {
  return new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

test('LaunchRunService persists failure diagnostics and a newer successful run clears the current failure', () => {
  let now = 100
  const { directory, db, profile, service } = createLaunchHistoryFixture({ now: () => now })
  try {
    const failedRunId = service.begin(profile, {
      profileId: profile.id,
      projectId: profile.projectId,
      state: 'starting',
      pid: 123,
      startedAt: now,
      stoppedAt: null,
      error: '',
      logs: [],
    })
    now = 120
    service.update(failedRunId, {
      profileId: profile.id,
      projectId: profile.projectId,
      state: 'failed',
      pid: null,
      startedAt: 100,
      stoppedAt: 120,
      error: '启动失败示例',
      logs: [{ stream: 'stderr', text: 'failure detail', timestamp: 119 }],
    })
    assert.equal(service.getLatestRuntime(profile.id)?.state, 'failed')
    assert.equal(service.getLatestRuntime(profile.id)?.error, '启动失败示例')
    assert.equal(service.getLatestRuntime(profile.id)?.logs[0]?.text, 'failure detail')
    assert.equal(service.listCurrentFailures().length, 1)

    now = 200
    const successfulRunId = service.begin(profile, {
      profileId: profile.id,
      projectId: profile.projectId,
      state: 'running',
      pid: 456,
      startedAt: 200,
      stoppedAt: null,
      error: '',
      logs: [],
    })
    now = 220
    service.update(successfulRunId, {
      profileId: profile.id,
      projectId: profile.projectId,
      state: 'stopped',
      pid: null,
      startedAt: 200,
      stoppedAt: 220,
      error: '',
      logs: [{ stream: 'system', text: '正常停止', timestamp: 220 }],
    })
    assert.equal(service.getLatestRuntime(profile.id)?.state, 'stopped')
    assert.deepEqual(service.listCurrentFailures(), [])
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('LaunchRunService recovers active and live failed rows as non-stoppable interrupted diagnostics', () => {
  const { directory, db, profile, service } = createLaunchHistoryFixture({
    now: () => 2_000,
    processExists: pid => pid === 4_242,
  })
  try {
    const second = makeProfile('profile-2')
    db.prepare(`
      INSERT INTO launch_profiles (
        id, projectId, name, executable, argsJson, cwd, envJson, readyUrl, readyPort,
        enabled, validated, confirmedHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      second.id, second.projectId, second.name, second.executable, JSON.stringify(second.args),
      second.cwd, JSON.stringify(second.env), second.readyUrl, second.readyPort,
      1, 1, second.confirmedHash, second.createdAt, second.updatedAt,
    )
    service.begin(profile, {
      profileId: profile.id, projectId: profile.projectId, state: 'running', pid: 4_242,
      startedAt: 1_000, stoppedAt: null, error: '', logs: [],
    })
    service.begin(second, {
      profileId: second.id, projectId: second.projectId, state: 'failed', pid: 4_243,
      startedAt: 1_100, stoppedAt: null, error: '停止失败', logs: [],
    })

    assert.equal(service.recoverInterrupted(), 2)
    const alive = service.getLatestRuntime(profile.id)
    const gone = service.getLatestRuntime(second.id)
    assert.equal(alive?.state, 'failed')
    assert.equal(alive?.pid, null)
    assert.match(alive?.error || '', /PID 4242 当前存在/)
    assert.match(gone?.error || '', /原 PID 当前不存在/)
    assert.equal(service.listCurrentFailures().length, 2)
    assert.deepEqual(
      db.prepare('SELECT state FROM launch_runs ORDER BY startedAt').all().map(row => ({ ...row })),
      [{ state: 'interrupted' }, { state: 'interrupted' }],
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('ProcessManager persists logs and the final stopped lifecycle through LaunchRunService', async () => {
  const { directory, db, profile, service } = createLaunchHistoryFixture()
  const manager = createManager(undefined, { history: service })
  try {
    manager.start(profile)
    await waitFor(() => manager.get(profile.id)?.state === 'running')
    await waitFor(() => manager.get(profile.id)?.logs.some(log => log.text.includes('ready-log')) === true)
    await manager.stop(profile.id)
    const persisted = service.getLatestRuntime(profile.id)
    assert.equal(persisted?.state, 'stopped')
    assert.equal(persisted?.pid, null)
    assert.ok(persisted?.logs.some(log => log.text.includes('ready-log')))
    assert.ok(persisted?.logs.some(log => log.text.includes('进程退出')))
  } finally {
    await manager.stopAll().catch(() => undefined)
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('ProcessManager prevents duplicate starts, captures logs, and waits until stop really exits', async () => {
  const states: LaunchStateName[] = []
  const manager = createManager(state => states.push(state.state))
  const profile = makeProfile('launch-basic')

  const first = manager.start(profile)
  const second = manager.start(profile)
  assert.equal(first.pid, second.pid)
  await waitFor(() => manager.get(profile.id)?.state === 'running')
  await waitFor(() => manager.get(profile.id)?.logs.some(log => log.text.includes('ready-log')) === true)
  assert.equal(manager.get(profile.id)?.state, 'running')

  const stopped = await manager.stop(profile.id)
  assert.equal(stopped?.state, 'stopped')
  assert.equal(stopped?.pid, null)
  assert.ok(stopped?.stoppedAt)
  assert.ok(states.includes('running'))
  assert.equal(states.includes('ready'), false)
  assert.ok(states.includes('stopped'))
})

test('ProcessManager detects ready URL and falls back from HEAD to GET', async () => {
  const methods: string[] = []
  const server = createHttpServer((request, response) => {
    methods.push(request.method || '')
    response.writeHead(request.method === 'HEAD' ? 405 : 204)
    response.end()
  })
  const port = await listen(server)
  const manager = createManager(undefined, { readinessPollIntervalMs: 10, readinessUrlTimeoutMs: 200 })
  const profile = makeProfile('launch-url-ready', { readyUrl: `http://127.0.0.1:${port}/health` })

  try {
    manager.start(profile)
    await waitFor(() => manager.get(profile.id)?.state === 'ready')
    assert.deepEqual(methods.slice(0, 2), ['HEAD', 'GET'])
  } finally {
    await manager.stop(profile.id).catch(() => undefined)
    await close(server)
  }
})

test('ProcessManager detects a ready port', async () => {
  const server = createNetServer(socket => socket.end())
  const port = await listen(server)
  const manager = createManager(undefined, { readinessPollIntervalMs: 10, readinessPortTimeoutMs: 100 })
  const profile = makeProfile('launch-port-ready', { readyPort: port })

  try {
    manager.start(profile)
    await waitFor(() => manager.get(profile.id)?.state === 'ready')
  } finally {
    await manager.stop(profile.id).catch(() => undefined)
    await close(server)
  }
})

test('ProcessManager reports spawn errors without leaving an active PID', async () => {
  const manager = createManager()
  const executable = path.join(process.cwd(), `missing-launch-executable-${crypto.randomUUID()}`)
  const profile = makeProfile('launch-spawn-error', { executable, args: [] })

  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'failed' && manager.get(profile.id)?.pid === null)
  assert.match(manager.get(profile.id)?.error || '', /ENOENT|not found|找不到/i)
})

test('ProcessManager reports a non-zero process exit', async () => {
  const manager = createManager()
  const profile = makeProfile('launch-nonzero', { args: ['-e', 'process.exit(7)'] })

  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'failed')
  assert.equal(manager.get(profile.id)?.pid, null)
  assert.match(manager.get(profile.id)?.error || '', /code=7/)
})

test('stop does not resolve until the child lifecycle confirms exit', async () => {
  const delayMs = 120
  const manager = createManager(undefined, {
    terminateProcess: async child => {
      setTimeout(() => child.kill('SIGTERM'), delayMs)
    },
  })
  const profile = makeProfile('launch-delayed-stop')
  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'running')

  const started = Date.now()
  const state = await manager.stop(profile.id)
  assert.ok(Date.now() - started >= delayMs - 20)
  assert.equal(state?.state, 'stopped')
  assert.equal(state?.pid, null)
})

test('a failed kill is visible, blocks duplicate start, and can be retried', async () => {
  let failTermination = true
  const manager = createManager(undefined, {
    terminateProcess: async (child, force) => {
      if (failTermination) throw new Error('simulated taskkill failure')
      await terminateDirectly(child, force)
    },
  })
  const profile = makeProfile('launch-retry-stop')
  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'running')

  await assert.rejects(manager.stop(profile.id), /simulated taskkill failure.*可重试停止/)
  assert.equal(manager.get(profile.id)?.state, 'failed')
  assert.notEqual(manager.get(profile.id)?.pid, null)
  assert.throws(() => manager.start(profile), /尚未确认退出/)

  failTermination = false
  const stopped = await manager.stop(profile.id)
  assert.equal(stopped?.state, 'stopped')
  assert.equal(stopped?.pid, null)
})

test('ProcessManager allows only one live Profile per project and permits another after stop', async () => {
  const manager = createManager()
  const first = makeProfile('launch-project-a-1', { projectId: 'project-a' })
  const second = makeProfile('launch-project-a-2', { projectId: 'project-a' })

  try {
    manager.start(first)
    await waitFor(() => manager.get(first.id)?.state === 'running')
    assert.throws(() => manager.start(second), /已有另一个启动配置正在运行/)
    assert.equal(manager.get(second.id), null)

    const stopped = await manager.stop(first.id)
    assert.equal(stopped?.state, 'stopped')
    manager.start(second)
    await waitFor(() => manager.get(second.id)?.state === 'running')
  } finally {
    await manager.stopAll().catch(() => undefined)
  }
})

test('stopProject cleans its stale runtime and stopAll waits for other projects', async () => {
  const manager = createManager()
  const first = makeProfile('launch-project-a-1', { projectId: 'project-a' })
  const other = makeProfile('launch-project-b', { projectId: 'project-b' })

  try {
    manager.start(first)
    manager.start(other)
    await waitFor(() => [first, other].every(profile => manager.get(profile.id)?.state === 'running'))

    await manager.stopProject('project-a')
    assert.equal(manager.get(first.id), null)
    assert.equal(manager.get(other.id)?.state, 'running')

    await manager.stopAll()
    assert.equal(manager.get(other.id)?.state, 'stopped')
    assert.equal(manager.get(other.id)?.pid, null)
  } finally {
    await manager.stopAll().catch(() => undefined)
  }
})

test('dispose removes an already-exited failed runtime', async () => {
  const manager = createManager()
  const profile = makeProfile('launch-dispose', { args: ['-e', 'process.exit(9)'] })
  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'failed' && manager.get(profile.id)?.pid === null)

  const disposed = await manager.dispose(profile.id)
  assert.equal(disposed?.state, 'failed')
  assert.equal(manager.get(profile.id), null)
})

test('readiness timeout force-stops the child and preserves the failed launch result', async () => {
  const probe = createNetServer()
  const unavailablePort = await listen(probe)
  await close(probe)
  const manager = createManager(undefined, {
    readinessTimeoutMs: 50,
    readinessPollIntervalMs: 10,
    readinessPortTimeoutMs: 20,
  })
  const profile = makeProfile('launch-readiness-timeout', { readyPort: unavailablePort })

  manager.start(profile)
  await waitFor(() => manager.get(profile.id)?.state === 'failed' && manager.get(profile.id)?.pid === null)
  assert.match(manager.get(profile.id)?.error || '', /未达到就绪状态/)
  assert.ok(manager.get(profile.id)?.logs.some(log => log.text.includes('强制停止进程')))
})

test('readiness kill failure keeps the process managed and allows a manual stop retry', async () => {
  const probe = createNetServer()
  const unavailablePort = await listen(probe)
  await close(probe)
  let firstForceAttempt = true
  const manager = createManager(undefined, {
    readinessTimeoutMs: 50,
    readinessPollIntervalMs: 10,
    readinessPortTimeoutMs: 20,
    terminateProcess: async (child, force) => {
      if (force && firstForceAttempt) {
        firstForceAttempt = false
        throw new Error('simulated readiness taskkill failure')
      }
      await terminateDirectly(child, force)
    },
  })
  const profile = makeProfile('launch-readiness-retry', { readyPort: unavailablePort })

  manager.start(profile)
  await waitFor(() => (manager.get(profile.id)?.error || '').includes('simulated readiness taskkill failure'))
  assert.notEqual(manager.get(profile.id)?.pid, null)
  assert.throws(() => manager.start(profile), /尚未确认退出/)

  const stopped = await manager.stop(profile.id)
  assert.equal(stopped?.state, 'stopped')
  assert.equal(stopped?.pid, null)
})
