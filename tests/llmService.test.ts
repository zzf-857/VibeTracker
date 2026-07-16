import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { computeLlmInputHash, LlmService, type LlmProvider } from '../electron/services/llmService.ts'

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler)
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('missing server address'))
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function fakeSettings(baseUrl: string, logGranularity: 'minimal' | 'normal' | 'detailed' = 'normal') {
  return {
    getPublic: async () => ({
      screenshotsDirectory: '',
      llm: {
        baseUrl, model: 'fixture-model', hasApiKey: true, defaultLanguage: 'zh-CN',
        logGranularity, toneMode: 'historical', excludedPaths: [], customRules: ['只陈述事实'],
      },
    }),
    getApiKey: async () => 'test-key',
  }
}

function generateInput() {
  const sha = 'a'.repeat(40)
  return {
    project: { name: 'Fixture', description: '本地项目', phase: '开发中', milestone: '', nextStep: '' },
    history: [{ title: '历史标题', description: '保持简洁语气。' }],
    commits: [{
      sha, parentShas: [], authorName: 'Dev', authorEmail: 'dev@example.com', authoredAt: 1000,
      subject: 'feat: fixture', body: 'sensitive body detail', fileNames: ['src/main.ts'],
      stats: { added: 2, deleted: 0, files: 1 },
    }],
    assetCandidates: [],
    knownTags: ['Electron'],
    rules: {
      language: 'zh-CN', toneMode: 'historical', summaryGuidance: '保持准确',
      recordGuidance: '使用短句', exclusions: [], customRules: ['必须关联 SHA'],
    },
  }
}

test('LLM provider sends structured trusted rules and honors minimal log granularity', async () => {
  let requestBody = ''
  const payload = {
    project: { name: 'Fixture', description: '简介', techStack: ['Electron'], tags: ['Electron'], phase: '开发中', phaseReason: '有新提交', confidence: 0.9, evidence: ['commit'] },
    records: [{ title: '完成 fixture', description: '完成变更', gitShas: ['a'.repeat(40)], confidence: 0.9, evidence: ['feat: fixture'] }],
    assetNotes: [],
  }
  const { server, baseUrl } = await listen((request, response) => {
    request.setEncoding('utf8')
    request.on('data', chunk => { requestBody += chunk })
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
    })
  })
  try {
    const result = await new LlmService(fakeSettings(baseUrl, 'minimal') as never).generate(generateInput())
    assert.equal(result.payload.records[0].gitShas[0], 'a'.repeat(40))
    assert.equal(result.metadata.model, 'fixture-model')
    assert.equal(result.metadata.inputHash, computeLlmInputHash(generateInput(), {
      baseUrl,
      model: 'fixture-model',
      defaultLanguage: 'zh-CN',
      logGranularity: 'minimal',
      toneMode: 'historical',
      excludedPaths: [],
      customRules: ['只陈述事实'],
    }))
    const request = JSON.parse(requestBody) as { messages: Array<{ role: string; content: string }> }
    const system = request.messages.find(message => message.role === 'system')!.content
    const user = request.messages.find(message => message.role === 'user')!.content
    assert.match(system, /只陈述事实/)
    assert.match(system, /输出语言：zh-CN/)
    assert.match(user, /历史标题/)
    assert.doesNotMatch(user, /sensitive body detail/)
    assert.doesNotMatch(user, /dev@example.com/)
  } finally {
    await close(server)
  }
})

test('LLM provider rejects non-JSON HTTP failures without creating drafts', async () => {
  const { server, baseUrl } = await listen((_request, response) => {
    response.statusCode = 429
    response.setHeader('Content-Type', 'text/plain')
    response.end('rate limited')
  })
  try {
    await assert.rejects(
      () => new LlmService(fakeSettings(baseUrl) as never).generate(generateInput()),
      /非 JSON HTTP 响应（429）/,
    )
  } finally {
    await close(server)
  }
})

test('LLM retries can reuse the saved provider and model snapshot with the current secure key', async () => {
  let authorization = ''
  let requestedModel = ''
  const payload = {
    project: { name: 'Fixture', description: '', techStack: [], tags: [], phase: '', phaseReason: '', confidence: 0.8, evidence: [] },
    records: [{ title: 'snapshot retry', description: '', gitShas: ['a'.repeat(40)], confidence: 0.8, evidence: [] }],
    assetNotes: [],
  }
  const { server, baseUrl } = await listen(async (request, response) => {
    authorization = request.headers.authorization || ''
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requestedModel = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: unknown }).model || '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
  })
  try {
    const service = new LlmService(fakeSettings('http://127.0.0.1:1/v1') as never)
    const result = await service.generate(generateInput(), undefined, {
      baseUrl,
      model: 'snapshot-model',
      defaultLanguage: 'zh-CN',
      logGranularity: 'minimal',
      toneMode: 'historical',
      excludedPaths: [],
      customRules: [],
    })
    assert.equal(result.metadata.model, 'snapshot-model')
    assert.equal(requestedModel, 'snapshot-model')
    assert.equal(authorization, 'Bearer test-key')
  } finally {
    await close(server)
  }
})

test('LLM connection testing uses unsaved overrides without persisting them first', async () => {
  let authorization = ''
  const { server, baseUrl } = await listen((request, response) => {
    authorization = request.headers.authorization || ''
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'override-model' }] }))
  })
  try {
    const service = new LlmService(fakeSettings('http://127.0.0.1:1/v1') as never)
    const result = await service.testConnection({
      baseUrl,
      model: 'override-model',
      apiKey: 'temporary-key',
    })
    assert.deepEqual(result, { ok: true, model: 'override-model', responseType: 'models' })
    assert.equal(authorization, 'Bearer temporary-key')
  } finally {
    await close(server)
  }
})

test('LLM connection testing falls back to chat completions when models is unsupported', async () => {
  const requestedPaths: string[] = []
  let requestedModel = ''
  const { server, baseUrl } = await listen(async (request, response) => {
    requestedPaths.push(request.url || '')
    if (request.url?.endsWith('/models')) {
      response.statusCode = 404
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'models unsupported' } }))
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requestedModel = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: unknown }).model || '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  })
  try {
    const result = await new LlmService(fakeSettings(baseUrl) as never).testConnection()
    assert.deepEqual(result, { ok: true, model: 'fixture-model', responseType: 'chat' })
    assert.deepEqual(requestedPaths, ['/v1/models', '/v1/chat/completions'])
    assert.equal(requestedModel, 'fixture-model')
  } finally {
    await close(server)
  }
})

test('LLM requests reject oversized inputs before opening a connection', async () => {
  const input = generateInput()
  input.commits[0].body = 'x'.repeat(2 * 1024 * 1024)
  await assert.rejects(
    () => new LlmService(fakeSettings('http://127.0.0.1:1/v1', 'detailed') as never).generate(input),
    /LLM 输入超过 2 MB 限制/,
  )
})

test('LLM requests stop reading oversized HTTP responses', async () => {
  const { server, baseUrl } = await listen((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024 + 1) }))
  })
  try {
    await assert.rejects(
      () => new LlmService(fakeSettings(baseUrl) as never).generate(generateInput()),
      /LLM HTTP 响应超过 4 MB 限制/,
    )
  } finally {
    await close(server)
  }
})

test('LLM asset notes must reference a real candidate from the current input', async () => {
  const payload = {
    project: { name: 'Fixture', description: '', techStack: [], tags: [], phase: '', phaseReason: '', confidence: 0.8, evidence: [] },
    records: [{ title: 'asset trace', description: '', gitShas: ['a'.repeat(40)], confidence: 0.8, evidence: [] }],
    assetNotes: [{ path: 'C:/invented/screenshot.png', note: '模型虚构路径' }],
  }
  const { server, baseUrl } = await listen((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
  })
  try {
    await assert.rejects(
      () => new LlmService(fakeSettings(baseUrl) as never).generate(generateInput()),
      /不在本次输入范围内的截图候选/,
    )
  } finally {
    await close(server)
  }
})

test('LLM provider registry can select an injected provider without changing orchestration', async () => {
  let completionCalls = 0
  const provider: LlmProvider = {
    id: 'fixture-provider',
    async testConnection(settings) {
      return { ok: true, model: settings.llm.model, responseType: 'compatible' }
    },
    async createChatCompletion(_settings, _apiKey, body) {
      completionCalls += 1
      assert.equal(body.model, 'fixture-model')
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              project: { name: 'Fixture', description: '', techStack: [], tags: [], phase: '', phaseReason: '', confidence: 0.8, evidence: [] },
              records: [{ title: 'registry', description: '', gitShas: ['a'.repeat(40)], confidence: 0.8, evidence: [] }],
              assetNotes: [],
            }),
          },
        }],
      }
    },
  }
  const service = new LlmService(fakeSettings('https://provider.invalid/v1') as never, [provider])
  const connection = await service.testConnection({ providerId: provider.id })
  assert.deepEqual(connection, { ok: true, model: 'fixture-model', responseType: 'compatible' })
  const result = await service.generate(generateInput(), undefined, undefined, provider.id)
  assert.equal(result.metadata.provider, provider.id)
  assert.equal(result.payload.records[0].title, 'registry')
  assert.equal(completionCalls, 1)
  await assert.rejects(
    () => service.generate(generateInput(), undefined, undefined, 'missing-provider'),
    /不支持的 LLM Provider/,
  )
})
