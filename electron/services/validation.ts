import path from 'node:path'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function expectObject(value: unknown, label = '参数') {
  if (!isPlainObject(value)) throw new ValidationError(`${label}必须是对象`)
  return value
}

export function expectObjectFields(value: unknown, label: string, allowedFields: readonly string[]) {
  const input = expectObject(value, label)
  const allowed = new Set(allowedFields)
  const unknown = Object.keys(input).filter(key => !allowed.has(key))
  if (unknown.length) throw new ValidationError(`${label}包含不支持字段: ${unknown.join(', ')}`)
  return input
}

export function expectString(
  value: unknown,
  label: string,
  options: { required?: boolean; max?: number; trim?: boolean } = {},
) {
  if (typeof value !== 'string') {
    if (!options.required && (value === undefined || value === null)) return ''
    throw new ValidationError(`${label}必须是字符串`)
  }
  const result = options.trim === false ? value : value.trim()
  if (options.required && !result) throw new ValidationError(`${label}不能为空`)
  if (result.length > (options.max ?? 10_000)) throw new ValidationError(`${label}过长`)
  return result
}

export function expectStringArray(value: unknown, label: string, maxItems = 200) {
  if (!Array.isArray(value)) throw new ValidationError(`${label}必须是数组`)
  if (value.length > maxItems) throw new ValidationError(`${label}项目过多`)
  return value.map((item, index) => expectString(item, `${label}[${index}]`, { max: 4_096, trim: false }))
}

export function expectId(value: unknown, label = 'ID') {
  const id = expectString(value, label, { required: true, max: 128 })
  if (!/^[\w.:-]+$/u.test(id)) throw new ValidationError(`${label}格式无效`)
  return id
}

export function expectFiniteNumber(
  value: unknown,
  label: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(`${label}必须是有效数字`)
  if (options.integer && !Number.isInteger(value)) throw new ValidationError(`${label}必须是整数`)
  if (options.min !== undefined && value < options.min) throw new ValidationError(`${label}不能小于 ${options.min}`)
  if (options.max !== undefined && value > options.max) throw new ValidationError(`${label}不能大于 ${options.max}`)
  return value
}

export function expectOptionalUrl(value: unknown, label: string) {
  const raw = expectString(value, label, { max: 2_048 })
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ValidationError(`${label}不是有效 URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError(`${label}仅支持 HTTP/HTTPS`)
  return url.toString()
}

export interface LaunchProfileInput {
  id?: string
  projectId: string
  name: string
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  readyUrl: string
  readyPort: number | null
  enabled: boolean
}

export function validateLaunchProfile(value: unknown): LaunchProfileInput {
  const input = expectObjectFields(value, '启动配置', [
    'id', 'projectId', 'name', 'executable', 'args', 'cwd', 'env',
    'readyUrl', 'readyPort', 'enabled',
  ])
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new ValidationError('启动配置启用状态必须是布尔值')
  }
  const envInput = input.env === undefined ? {} : expectObject(input.env, '环境变量')
  const env: Record<string, string> = {}
  for (const [key, item] of Object.entries(envInput)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new ValidationError(`环境变量名无效: ${key}`)
    env[key] = expectString(item, `环境变量 ${key}`, { max: 8_192, trim: false })
  }
  const readyPort = input.readyPort === undefined || input.readyPort === null || input.readyPort === ''
    ? null
    : Number(input.readyPort)
  if (readyPort !== null && (!Number.isInteger(readyPort) || readyPort < 1 || readyPort > 65535)) {
    throw new ValidationError('就绪端口必须在 1-65535 之间')
  }
  const cwd = path.resolve(expectString(input.cwd, '工作目录', { required: true, max: 4_096 }))
  const executable = expectString(input.executable, '可执行文件', { required: true, max: 4_096, trim: false })
  const args = input.args === undefined ? [] : expectStringArray(input.args, '参数', 100)
  if ([executable, ...args, ...Object.values(env)].some(item => item.includes('\0') || item.includes('\r') || item.includes('\n'))) {
    throw new ValidationError('启动配置不能包含 NUL 或换行控制字符')
  }
  return {
    id: input.id === undefined ? undefined : expectId(input.id, '启动配置 ID'),
    projectId: expectId(input.projectId, '项目 ID'),
    name: expectString(input.name, '配置名称', { required: true, max: 120 }),
    executable,
    args,
    cwd,
    env,
    readyUrl: expectOptionalUrl(input.readyUrl, '就绪 URL'),
    readyPort,
    enabled: input.enabled === undefined ? true : input.enabled,
  }
}

export function validateImportLaunchCandidate(projectIdValue: unknown, value: unknown): LaunchProfileInput {
  const projectId = expectId(projectIdValue, '项目 ID')
  const candidate = expectObjectFields(value, '启动候选', [
    'name', 'executable', 'args', 'cwd', 'env', 'readyUrl', 'readyPort', 'reason',
  ])
  expectString(candidate.reason, '启动候选说明', { max: 1_000 })
  return validateLaunchProfile({
    projectId,
    name: candidate.name,
    executable: candidate.executable,
    args: candidate.args,
    cwd: candidate.cwd,
    env: candidate.env,
    readyUrl: candidate.readyUrl,
    readyPort: candidate.readyPort,
    enabled: true,
  })
}

export interface AiGeneratedPayload {
  project: {
    name: string
    description: string
    techStack: string[]
    tags: string[]
    phase: string
    phaseReason: string
    confidence: number
    evidence: string[]
  }
  records: Array<{
    title: string
    description: string
    gitShas: string[]
    confidence: number
    evidence: string[]
  }>
  assetNotes: Array<{ path: string; note: string }>
}

function expectConfidence(value: unknown, label: string) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new ValidationError(`${label}必须在 0-1 之间`)
  return number
}

export function validateAiGeneratedPayload(value: unknown): AiGeneratedPayload {
  const root = expectObject(value, 'AI 响应')
  const project = expectObject(root.project, 'project')
  if (!Array.isArray(root.records) || root.records.length > 30) throw new ValidationError('records 必须是最多 30 项的数组')
  if (!Array.isArray(root.assetNotes) || root.assetNotes.length > 30) throw new ValidationError('assetNotes 必须是最多 30 项的数组')
  return {
    project: {
      name: expectString(project.name, 'project.name', { required: true, max: 200 }),
      description: expectString(project.description, 'project.description', { max: 5_000 }),
      techStack: expectStringArray(project.techStack, 'project.techStack', 50),
      tags: expectStringArray(project.tags, 'project.tags', 50),
      phase: expectString(project.phase, 'project.phase', { max: 200 }),
      phaseReason: expectString(project.phaseReason, 'project.phaseReason', { max: 2_000 }),
      confidence: expectConfidence(project.confidence, 'project.confidence'),
      evidence: expectStringArray(project.evidence, 'project.evidence', 100),
    },
    records: root.records.map((recordValue, index) => {
      const record = expectObject(recordValue, `records[${index}]`)
      const gitShas = expectStringArray(record.gitShas, `records[${index}].gitShas`, 200)
      if (gitShas.some(sha => !/^[0-9a-f]{7,64}$/i.test(sha))) throw new ValidationError(`records[${index}].gitShas 含无效 SHA`)
      return {
        title: expectString(record.title, `records[${index}].title`, { required: true, max: 240 }),
        description: expectString(record.description, `records[${index}].description`, { max: 8_000 }),
        gitShas,
        confidence: expectConfidence(record.confidence, `records[${index}].confidence`),
        evidence: expectStringArray(record.evidence, `records[${index}].evidence`, 100),
      }
    }),
    assetNotes: root.assetNotes.map((noteValue, index) => {
      const note = expectObject(noteValue, `assetNotes[${index}]`)
      return {
        path: expectString(note.path, `assetNotes[${index}].path`, { required: true, max: 4_096, trim: false }),
        note: expectString(note.note, `assetNotes[${index}].note`, { max: 1_000 }),
      }
    }),
  }
}
