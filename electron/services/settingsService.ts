import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expectObject, expectString, expectStringArray } from './validation'

export type LogGranularity = 'minimal' | 'normal' | 'detailed'
export type ToneMode = 'historical' | 'standardized'

export interface PublicAppSettings {
  screenshotsDirectory: string
  llm: {
    baseUrl: string
    model: string
    hasApiKey: boolean
    defaultLanguage: string
    logGranularity: LogGranularity
    toneMode: ToneMode
    excludedPaths: string[]
    customRules: string[]
  }
}

interface StoredSettings {
  screenshotsDirectory: string
  llm: Omit<PublicAppSettings['llm'], 'hasApiKey'>
}

interface SecureStorage {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export type SettingsTransactionPhase = 'prepared' | 'config-committed' | 'key-committed'

export interface SettingsServiceOptions {
  /** Internal observability/fault-injection hook. Throwing simulates an abrupt process interruption. */
  onTransactionPhase?: (phase: SettingsTransactionPhase) => void | Promise<void>
}

interface SettingsTransactionJournal {
  version: 1
  operationId: string
  configNextFile: string
  keyNextFile: string
  configBackupFile: string
  keyBackupFile: string
  previousConfigExisted: boolean
  previousKeyExisted: boolean
  deleteKey: boolean
  nextConfigHash: string
  nextKeyHash: string
  previousConfigHash: string
  previousKeyHash: string
  checksum: string
}

class SettingsTransactionInterruptedError extends Error {
  constructor(readonly phase: SettingsTransactionPhase, cause: unknown) {
    super(`设置事务在 ${phase} 阶段被中断`, { cause })
    this.name = 'SettingsTransactionInterruptedError'
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SETTINGS_TRANSACTION_VERSION = 1

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

function errnoCode(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function transactionJournalChecksum(journal: Omit<SettingsTransactionJournal, 'checksum'> | SettingsTransactionJournal) {
  return sha256(JSON.stringify([
    journal.version,
    journal.operationId,
    journal.configNextFile,
    journal.keyNextFile,
    journal.configBackupFile,
    journal.keyBackupFile,
    journal.previousConfigExisted,
    journal.previousKeyExisted,
    journal.deleteKey,
    journal.nextConfigHash,
    journal.nextKeyHash,
    journal.previousConfigHash,
    journal.previousKeyHash,
  ]))
}

const DEFAULT_LLM = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  defaultLanguage: 'zh-CN',
  logGranularity: 'normal' as LogGranularity,
  toneMode: 'historical' as ToneMode,
  excludedPaths: ['node_modules/**', 'dist/**', 'build/**', '*.lock', '.env*'],
  customRules: [],
}

export class SettingsService {
  private readonly configPath: string
  private readonly keyPath: string
  private readonly transactionJournalPath: string
  private writeQueue: Promise<void> = Promise.resolve()
  private recoveryPromise: Promise<void> | null = null

  constructor(
    private readonly userDataPath = app.getPath('userData'),
    private readonly secureStorage: SecureStorage = safeStorage,
    private readonly options: SettingsServiceOptions = {},
  ) {
    this.configPath = path.join(userDataPath, 'config.json')
    this.keyPath = path.join(userDataPath, 'llm-api-key.bin')
    this.transactionJournalPath = path.join(userDataPath, 'llm-settings-transaction.json')
  }

  private defaults(): StoredSettings {
    return {
      screenshotsDirectory: path.join(this.userDataPath, 'screenshots'),
      llm: { ...DEFAULT_LLM, excludedPaths: [...DEFAULT_LLM.excludedPaths], customRules: [] },
    }
  }

  getDefaultScreenshotsDirectory() {
    return this.defaults().screenshotsDirectory
  }

  private async fileHash(filePath: string) {
    try {
      return sha256(await fs.readFile(filePath))
    } catch (error) {
      if (['ENOENT', 'EISDIR', 'EPERM'].includes(errnoCode(error) || '')) return ''
      throw error
    }
  }

  private async removeReplaceableFile(filePath: string) {
    try {
      const stat = await fs.lstat(filePath)
      if (stat.isFile() || stat.isSymbolicLink()) await fs.unlink(filePath)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error
    }
  }

  private async replaceFile(source: string, target: string) {
    await this.removeReplaceableFile(target)
    await fs.rename(source, target)
  }

  private resolveJournalFile(fileName: string, operationId: string) {
    const expectedPrefix = `.llm-settings-${operationId}-`
    if (!fileName || path.basename(fileName) !== fileName || !fileName.startsWith(expectedPrefix)) {
      throw new Error('设置事务 journal 包含不受信任的文件名')
    }
    return path.join(this.userDataPath, fileName)
  }

  private parseTransactionJournal(value: unknown): SettingsTransactionJournal {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置事务 journal 不是有效对象')
    const input = value as Record<string, unknown>
    if (input.version !== SETTINGS_TRANSACTION_VERSION) throw new Error('设置事务 journal 版本不受支持')
    const operationId = typeof input.operationId === 'string' ? input.operationId : ''
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('设置事务 journal operationId 无效')
    const stringField = (name: keyof SettingsTransactionJournal) => {
      const field = input[name]
      if (typeof field !== 'string') throw new Error(`设置事务 journal.${name} 必须是字符串`)
      return field
    }
    const booleanField = (name: keyof SettingsTransactionJournal) => {
      const field = input[name]
      if (typeof field !== 'boolean') throw new Error(`设置事务 journal.${name} 必须是布尔值`)
      return field
    }
    const journal: SettingsTransactionJournal = {
      version: 1,
      operationId,
      configNextFile: stringField('configNextFile'),
      keyNextFile: stringField('keyNextFile'),
      configBackupFile: stringField('configBackupFile'),
      keyBackupFile: stringField('keyBackupFile'),
      previousConfigExisted: booleanField('previousConfigExisted'),
      previousKeyExisted: booleanField('previousKeyExisted'),
      deleteKey: booleanField('deleteKey'),
      nextConfigHash: stringField('nextConfigHash'),
      nextKeyHash: stringField('nextKeyHash'),
      previousConfigHash: stringField('previousConfigHash'),
      previousKeyHash: stringField('previousKeyHash'),
      checksum: stringField('checksum'),
    }
    for (const fileName of [journal.configNextFile, journal.keyNextFile, journal.configBackupFile, journal.keyBackupFile]) {
      this.resolveJournalFile(fileName, operationId)
    }
    for (const [label, hash, required] of [
      ['nextConfigHash', journal.nextConfigHash, true],
      ['nextKeyHash', journal.nextKeyHash, !journal.deleteKey],
      ['previousConfigHash', journal.previousConfigHash, journal.previousConfigExisted],
      ['previousKeyHash', journal.previousKeyHash, journal.previousKeyExisted],
    ] as const) {
      if ((required && !SHA256_PATTERN.test(hash)) || (!required && hash && !SHA256_PATTERN.test(hash))) {
        throw new Error(`设置事务 journal.${label} 无效`)
      }
    }
    if (!SHA256_PATTERN.test(journal.checksum) || journal.checksum !== transactionJournalChecksum(journal)) {
      throw new Error('设置事务 journal checksum 无效')
    }
    return journal
  }

  private async readTransactionJournal() {
    try {
      return this.parseTransactionJournal(JSON.parse(await fs.readFile(this.transactionJournalPath, 'utf8')))
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return null
      throw new Error(`设置事务 journal 无法读取：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  private transactionPaths(journal: SettingsTransactionJournal) {
    return {
      configNext: this.resolveJournalFile(journal.configNextFile, journal.operationId),
      keyNext: this.resolveJournalFile(journal.keyNextFile, journal.operationId),
      configBackup: this.resolveJournalFile(journal.configBackupFile, journal.operationId),
      keyBackup: this.resolveJournalFile(journal.keyBackupFile, journal.operationId),
    }
  }

  private async cleanupTransaction(journal: SettingsTransactionJournal) {
    const files = this.transactionPaths(journal)
    // Removing the journal first declares that both target files are already consistent.
    await this.removeReplaceableFile(this.transactionJournalPath)
    await Promise.all(Object.values(files).map(filePath => this.removeReplaceableFile(filePath)))
  }

  private async cleanupOrphanTransactionFiles() {
    let names: string[]
    try {
      names = await fs.readdir(this.userDataPath)
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return
      throw error
    }
    const sidecar = /^\.llm-settings-[0-9a-f-]{36}-(?:config|key)\.(?:next|previous)$/i
    const journalTemporary = /^llm-settings-transaction\.json\.[0-9a-f-]{36}\.tmp$/i
    await Promise.all(names
      .filter(name => sidecar.test(name) || journalTemporary.test(name))
      .map(name => this.removeReplaceableFile(path.join(this.userDataPath, name))))
  }

  private async rollForwardTransaction(journal: SettingsTransactionJournal) {
    const files = this.transactionPaths(journal)
    if (await this.fileHash(this.configPath) !== journal.nextConfigHash) {
      if (await this.fileHash(files.configNext) !== journal.nextConfigHash) throw new Error('下一版普通设置暂存文件缺失或损坏')
      await this.replaceFile(files.configNext, this.configPath)
    }
    if (await this.fileHash(this.configPath) !== journal.nextConfigHash) throw new Error('普通设置原子替换后校验失败')

    if (journal.deleteKey) {
      await this.removeReplaceableFile(this.keyPath)
    } else if (await this.fileHash(this.keyPath) !== journal.nextKeyHash) {
      if (await this.fileHash(files.keyNext) !== journal.nextKeyHash) throw new Error('下一版加密密钥暂存文件缺失或损坏')
      await this.replaceFile(files.keyNext, this.keyPath)
    }
    if (!journal.deleteKey && await this.fileHash(this.keyPath) !== journal.nextKeyHash) {
      throw new Error('加密密钥原子替换后校验失败')
    }
  }

  private async rollbackTransaction(journal: SettingsTransactionJournal) {
    const files = this.transactionPaths(journal)
    if (journal.previousConfigExisted) {
      if (await this.fileHash(this.configPath) !== journal.previousConfigHash) {
        if (await this.fileHash(files.configBackup) !== journal.previousConfigHash) throw new Error('旧普通设置备份缺失或损坏')
        await this.replaceFile(files.configBackup, this.configPath)
      }
      if (await this.fileHash(this.configPath) !== journal.previousConfigHash) throw new Error('旧普通设置恢复后校验失败')
    } else {
      await this.removeReplaceableFile(this.configPath)
    }

    if (journal.previousKeyExisted) {
      if (await this.fileHash(this.keyPath) !== journal.previousKeyHash) {
        if (await this.fileHash(files.keyBackup) !== journal.previousKeyHash) throw new Error('旧加密密钥备份缺失或损坏')
        await this.replaceFile(files.keyBackup, this.keyPath)
      }
      if (await this.fileHash(this.keyPath) !== journal.previousKeyHash) throw new Error('旧加密密钥恢复后校验失败')
    } else {
      await this.removeReplaceableFile(this.keyPath)
    }
  }

  private async recoverPendingTransaction(): Promise<'none' | 'rolled-forward' | 'rolled-back'> {
    const journal = await this.readTransactionJournal()
    if (!journal) {
      await this.cleanupOrphanTransactionFiles()
      return 'none'
    }
    try {
      await this.rollForwardTransaction(journal)
      await this.cleanupTransaction(journal)
      console.info('[Settings] Recovered an interrupted LLM settings transaction by rolling forward')
      return 'rolled-forward'
    } catch (forwardError) {
      try {
        await this.rollbackTransaction(journal)
        await this.cleanupTransaction(journal)
        console.warn(
          '[Settings] Rolled back an interrupted LLM settings transaction:',
          forwardError instanceof Error ? forwardError.message : String(forwardError),
        )
        return 'rolled-back'
      } catch (rollbackError) {
        throw new Error(
          `设置事务恢复失败；前向恢复：${forwardError instanceof Error ? forwardError.message : String(forwardError)}；回滚：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          { cause: rollbackError },
        )
      }
    }
  }

  private ensureRecovered() {
    if (!this.recoveryPromise) {
      this.recoveryPromise = this.recoverPendingTransaction().then(() => undefined).catch(error => {
        this.recoveryPromise = null
        throw error
      })
    }
    return this.recoveryPromise
  }

  private async notifyTransactionPhase(phase: SettingsTransactionPhase) {
    try {
      await this.options.onTransactionPhase?.(phase)
    } catch (error) {
      throw new SettingsTransactionInterruptedError(phase, error)
    }
  }

  private sanitizeStored(value: unknown): StoredSettings {
    const defaults = this.defaults()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
    const root = value as Record<string, unknown>
    const llm = root.llm && typeof root.llm === 'object' && !Array.isArray(root.llm)
      ? root.llm as Record<string, unknown>
      : {}
    const logGranularity = ['minimal', 'normal', 'detailed'].includes(String(llm.logGranularity))
      ? llm.logGranularity as LogGranularity
      : defaults.llm.logGranularity
    const toneMode = ['historical', 'standardized'].includes(String(llm.toneMode))
      ? llm.toneMode as ToneMode
      : defaults.llm.toneMode
    return {
      screenshotsDirectory: typeof root.screenshotsDirectory === 'string' && root.screenshotsDirectory
        ? path.resolve(root.screenshotsDirectory)
        : defaults.screenshotsDirectory,
      llm: {
        baseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl : defaults.llm.baseUrl,
        model: typeof llm.model === 'string' ? llm.model : '',
        defaultLanguage: typeof llm.defaultLanguage === 'string' ? llm.defaultLanguage : defaults.llm.defaultLanguage,
        logGranularity,
        toneMode,
        excludedPaths: Array.isArray(llm.excludedPaths) ? llm.excludedPaths.filter(item => typeof item === 'string').slice(0, 200) : defaults.llm.excludedPaths,
        customRules: Array.isArray(llm.customRules) ? llm.customRules.filter(item => typeof item === 'string').slice(0, 100) : [],
      },
    }
  }

  private async readStoredUnlocked(): Promise<StoredSettings> {
    await this.ensureRecovered()
    try {
      return this.sanitizeStored(JSON.parse(await fs.readFile(this.configPath, 'utf8')))
    } catch {
      return this.defaults()
    }
  }

  private async getApiKeyUnlocked() {
    await this.ensureRecovered()
    if (!this.secureStorage.isEncryptionAvailable()) return ''
    try {
      return this.secureStorage.decryptString(await fs.readFile(this.keyPath))
    } catch {
      return ''
    }
  }

  private async getPublicUnlocked(): Promise<PublicAppSettings> {
    const [stored, apiKey] = await Promise.all([this.readStoredUnlocked(), this.getApiKeyUnlocked()])
    return { ...stored, llm: { ...stored.llm, hasApiKey: Boolean(apiKey) } }
  }

  private async writeStored(next: StoredSettings) {
    await fs.mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.configPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
      await fs.rename(temporary, this.configPath)
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private encryptApiKey(apiKey: string) {
    if (!apiKey) return null
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，API Key 未保存')
    return this.secureStorage.encryptString(apiKey)
  }

  private async writeEncryptedApiKey(encrypted: Buffer | null) {
    if (!encrypted) {
      await fs.unlink(this.keyPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
      return
    }
    await fs.mkdir(this.userDataPath, { recursive: true })
    const temporary = `${this.keyPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600 })
      await fs.rename(temporary, this.keyPath)
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async writeTransactionJournal(journal: SettingsTransactionJournal) {
    const temporary = `${this.transactionJournalPath}.${journal.operationId}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 })
      await this.replaceFile(temporary, this.transactionJournalPath)
    } catch (error) {
      await this.removeReplaceableFile(temporary).catch(() => undefined)
      throw error
    }
  }

  private async commitLlmSettings(next: StoredSettings, encryptedApiKey: Buffer | null) {
    await this.ensureRecovered()
    await fs.mkdir(this.userDataPath, { recursive: true })
    const operationId = randomUUID()
    const baseName = `.llm-settings-${operationId}`
    const journal: SettingsTransactionJournal = {
      version: 1,
      operationId,
      configNextFile: `${baseName}-config.next`,
      keyNextFile: `${baseName}-key.next`,
      configBackupFile: `${baseName}-config.previous`,
      keyBackupFile: `${baseName}-key.previous`,
      previousConfigExisted: false,
      previousKeyExisted: false,
      deleteKey: encryptedApiKey === null,
      nextConfigHash: '',
      nextKeyHash: encryptedApiKey ? sha256(encryptedApiKey) : '',
      previousConfigHash: '',
      previousKeyHash: '',
      checksum: '',
    }
    const files = this.transactionPaths(journal)
    const configBytes = Buffer.from(JSON.stringify(next, null, 2), 'utf8')
    journal.nextConfigHash = sha256(configBytes)
    journal.previousConfigHash = await this.fileHash(this.configPath)
    journal.previousKeyHash = await this.fileHash(this.keyPath)
    journal.previousConfigExisted = Boolean(journal.previousConfigHash)
    journal.previousKeyExisted = Boolean(journal.previousKeyHash)
    journal.checksum = transactionJournalChecksum(journal)
    let journalWritten = false

    try {
      await fs.writeFile(files.configNext, configBytes, { mode: 0o600 })
      if (encryptedApiKey) await fs.writeFile(files.keyNext, encryptedApiKey, { mode: 0o600 })
      if (journal.previousConfigExisted) await fs.copyFile(this.configPath, files.configBackup)
      if (journal.previousKeyExisted) await fs.copyFile(this.keyPath, files.keyBackup)
      await this.writeTransactionJournal(journal)
      journalWritten = true
      // A later public read must inspect this durable journal if the current
      // operation is interrupted. Public operations are serialized below, so
      // clearing the cached no-journal result cannot race the active commit.
      this.recoveryPromise = null
      await this.notifyTransactionPhase('prepared')

      await this.replaceFile(files.configNext, this.configPath)
      await this.notifyTransactionPhase('config-committed')
      if (encryptedApiKey) await this.replaceFile(files.keyNext, this.keyPath)
      else await this.removeReplaceableFile(this.keyPath)
      await this.notifyTransactionPhase('key-committed')
      await this.cleanupTransaction(journal)
    } catch (error) {
      if (error instanceof SettingsTransactionInterruptedError) throw error
      if (!journalWritten) {
        await Promise.all(Object.values(files).map(filePath => this.removeReplaceableFile(filePath).catch(() => undefined)))
        throw error
      }
      let recovery: 'none' | 'rolled-forward' | 'rolled-back'
      try {
        recovery = await this.recoverPendingTransaction()
      } catch (recoveryError) {
        throw new Error(
          `API Key 保存失败且设置事务恢复失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          { cause: error },
        )
      }
      if (recovery === 'rolled-forward') return
      throw error
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>) {
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async readStored(): Promise<StoredSettings> {
    return this.enqueueOperation(() => this.readStoredUnlocked())
  }

  async hasApiKey() {
    return this.enqueueOperation(async () => Boolean(await this.getApiKeyUnlocked()))
  }

  async getPublic(): Promise<PublicAppSettings> {
    return this.enqueueOperation(() => this.getPublicUnlocked())
  }

  async setScreenshotsDirectory(directory: string): Promise<PublicAppSettings> {
    return this.enqueueOperation(async () => {
      const resolved = path.resolve(expectString(directory, '截图目录', { required: true, max: 4_096 }))
      await fs.mkdir(resolved, { recursive: true })
      const stat = await fs.stat(resolved)
      if (!stat.isDirectory()) throw new Error('截图目录不是有效文件夹')
      const current = await this.readStoredUnlocked()
      await this.writeStored({ ...current, screenshotsDirectory: resolved })
      return this.getPublicUnlocked()
    })
  }

  async update(value: unknown): Promise<PublicAppSettings> {
    return this.enqueueOperation(async () => {
      const input = expectObject(value, '设置')
      if (Object.prototype.hasOwnProperty.call(input, 'screenshotsDirectory')) {
        throw new Error('截图目录必须通过专用的安全迁移操作修改')
      }
      const unsupportedRootKey = Object.keys(input).find(key => key !== 'llm')
      if (unsupportedRootKey) throw new Error(`不支持的设置字段: ${unsupportedRootKey}`)
      const current = await this.readStoredUnlocked()
      const llmInput = input.llm === undefined ? {} : expectObject(input.llm, 'LLM 设置')
      const supportedLlmKeys = new Set([
        'baseUrl', 'model', 'apiKey', 'defaultLanguage', 'logGranularity', 'toneMode', 'excludedPaths', 'customRules',
      ])
      const unsupportedLlmKey = Object.keys(llmInput).find(key => !supportedLlmKeys.has(key))
      if (unsupportedLlmKey) throw new Error(`不支持的 LLM 设置字段: ${unsupportedLlmKey}`)
      const logGranularity = llmInput.logGranularity === undefined
        ? current.llm.logGranularity
        : expectString(llmInput.logGranularity, '日志粒度', { required: true, max: 20 })
      if (!['minimal', 'normal', 'detailed'].includes(logGranularity)) throw new Error('日志粒度无效')
      const toneMode = llmInput.toneMode === undefined
        ? current.llm.toneMode
        : expectString(llmInput.toneMode, '风格模式', { required: true, max: 30 })
      if (!['historical', 'standardized'].includes(toneMode)) throw new Error('风格模式无效')
      const next: StoredSettings = {
        screenshotsDirectory: current.screenshotsDirectory,
        llm: {
          baseUrl: llmInput.baseUrl === undefined ? current.llm.baseUrl : expectString(llmInput.baseUrl, 'Base URL', { required: true, max: 2_048 }),
          model: llmInput.model === undefined ? current.llm.model : expectString(llmInput.model, 'Model', { max: 300 }),
          defaultLanguage: llmInput.defaultLanguage === undefined ? current.llm.defaultLanguage : expectString(llmInput.defaultLanguage, '默认语言', { required: true, max: 50 }),
          logGranularity: logGranularity as LogGranularity,
          toneMode: toneMode as ToneMode,
          excludedPaths: llmInput.excludedPaths === undefined ? current.llm.excludedPaths : expectStringArray(llmInput.excludedPaths, '排除路径', 200),
          customRules: llmInput.customRules === undefined ? current.llm.customRules : expectStringArray(llmInput.customRules, '生成规则', 100),
        },
      }
      let baseUrl: URL
      try { baseUrl = new URL(next.llm.baseUrl) } catch { throw new Error('Base URL 不是有效 URL') }
      if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('Base URL 仅支持 HTTP/HTTPS')
      next.llm.baseUrl = baseUrl.toString().replace(/\/$/, '')
      const changesApiKey = Object.prototype.hasOwnProperty.call(llmInput, 'apiKey')
      const encryptedApiKey = changesApiKey
        ? this.encryptApiKey(expectString(llmInput.apiKey, 'API Key', { max: 8_192, trim: false }))
        : undefined
      if (changesApiKey) {
        try {
          await this.commitLlmSettings(next, encryptedApiKey ?? null)
        } catch (error) {
          if (error instanceof SettingsTransactionInterruptedError) throw error
          throw new Error(`API Key 保存失败，普通配置已回滚：${error instanceof Error ? error.message : String(error)}`, { cause: error })
        }
      } else await this.writeStored(next)
      return this.getPublicUnlocked()
    })
  }

  async setApiKey(apiKey: string) {
    const encrypted = this.encryptApiKey(apiKey)
    return this.enqueueOperation(async () => {
      await this.ensureRecovered()
      return this.writeEncryptedApiKey(encrypted)
    })
  }

  async getApiKey() {
    return this.enqueueOperation(() => this.getApiKeyUnlocked())
  }
}
