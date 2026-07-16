import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SettingsService } from '../electron/services/settingsService.ts'

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => {
    const encrypted = value.toString('utf8')
    if (!encrypted.startsWith('encrypted:')) throw new Error('密钥数据无法解密')
    return encrypted.slice('encrypted:'.length)
  },
}

test('LLM API key is encrypted separately and never written to config.json', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    const publicSettings = await service.update({
      llm: { baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'secret-value' },
    })
    assert.equal(publicSettings.llm.hasApiKey, true)
    assert.equal(await service.getApiKey(), 'secret-value')
    const config = fs.readFileSync(path.join(directory, 'config.json'), 'utf8')
    assert.equal(config.includes('secret-value'), false)
    assert.equal(config.includes('apiKey'), false)
    assert.equal(fs.readFileSync(path.join(directory, 'llm-api-key.bin'), 'utf8'), 'encrypted:secret-value')

    const replaced = await service.update({ llm: { apiKey: 'replacement-value' } })
    assert.equal(replaced.llm.hasApiKey, true)
    assert.equal(await service.getApiKey(), 'replacement-value')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('corrupt or undecryptable key files are not reported as configured', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-corrupt-key-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    await service.update({ llm: { model: 'configured-model', apiKey: 'valid-key' } })
    fs.writeFileSync(path.join(directory, 'llm-api-key.bin'), 'not-encrypted-data')

    assert.equal(await service.getApiKey(), '')
    assert.equal(await service.hasApiKey(), false)
    assert.equal((await service.getPublic()).llm.hasApiKey, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('interrupted cross-file LLM settings transactions roll forward from every durable phase', async t => {
  for (const interruptedPhase of ['prepared', 'config-committed', 'key-committed'] as const) {
    await t.test(interruptedPhase, async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vibetracker-settings-journal-${interruptedPhase}-`))
      try {
        const original = new SettingsService(directory, fakeStorage)
        await original.update({
          llm: { baseUrl: 'https://before.example/v1', model: 'before-model', apiKey: 'before-key' },
        })
        const interrupted = new SettingsService(directory, fakeStorage, {
          onTransactionPhase: phase => {
            if (phase === interruptedPhase) throw new Error(`simulated process exit after ${phase}`)
          },
        })
        await assert.rejects(
          () => interrupted.update({
            llm: { baseUrl: 'https://after.example/v1', model: 'after-model', apiKey: 'after-key' },
          }),
          new RegExp(interruptedPhase),
        )

        const journalPath = path.join(directory, 'llm-settings-transaction.json')
        const journalText = fs.readFileSync(journalPath, 'utf8')
        assert.equal(journalText.includes('before-key'), false)
        assert.equal(journalText.includes('after-key'), false)

        const recovered = new SettingsService(directory, fakeStorage)
        const [settings, apiKey] = await Promise.all([recovered.getPublic(), recovered.getApiKey()])
        assert.equal(settings.llm.baseUrl, 'https://after.example/v1')
        assert.equal(settings.llm.model, 'after-model')
        assert.equal(settings.llm.hasApiKey, true)
        assert.equal(apiKey, 'after-key')
        assert.equal(fs.existsSync(journalPath), false)
        assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('.llm-settings-')), [])
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})

test('settings transaction recovery rolls both files back when staged encrypted data is corrupt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-journal-rollback-'))
  try {
    const original = new SettingsService(directory, fakeStorage)
    await original.update({
      llm: { baseUrl: 'https://before.example/v1', model: 'before-model', apiKey: 'before-key' },
    })
    const interrupted = new SettingsService(directory, fakeStorage, {
      onTransactionPhase: phase => {
        if (phase === 'config-committed') throw new Error('simulated process exit after config commit')
      },
    })
    await assert.rejects(() => interrupted.update({
      llm: { baseUrl: 'https://after.example/v1', model: 'after-model', apiKey: 'after-key' },
    }))

    const journalPath = path.join(directory, 'llm-settings-transaction.json')
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { keyNextFile: string }
    fs.writeFileSync(path.join(directory, journal.keyNextFile), 'corrupt-staged-key')

    const recovered = new SettingsService(directory, fakeStorage)
    const settings = await recovered.getPublic()
    assert.equal(settings.llm.baseUrl, 'https://before.example/v1')
    assert.equal(settings.llm.model, 'before-model')
    assert.equal(settings.llm.hasApiKey, true)
    assert.equal(await recovered.getApiKey(), 'before-key')
    assert.equal(fs.existsSync(journalPath), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('interrupted API key removal resumes without resurrecting the previous key', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-journal-delete-key-'))
  try {
    const original = new SettingsService(directory, fakeStorage)
    await original.update({ llm: { model: 'before-model', apiKey: 'before-key' } })
    const interrupted = new SettingsService(directory, fakeStorage, {
      onTransactionPhase: phase => {
        if (phase === 'config-committed') throw new Error('simulated exit before key removal')
      },
    })
    await assert.rejects(() => interrupted.update({ llm: { model: 'after-model', apiKey: '' } }))

    const recovered = new SettingsService(directory, fakeStorage)
    const settings = await recovered.getPublic()
    assert.equal(settings.llm.model, 'after-model')
    assert.equal(settings.llm.hasApiKey, false)
    assert.equal(await recovered.getApiKey(), '')
    assert.equal(fs.existsSync(path.join(directory, 'llm-api-key.bin')), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('API key persistence failure rolls ordinary LLM settings back', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-key-rollback-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    await service.update({ llm: { baseUrl: 'https://before.example/v1', model: 'before-model' } })
    fs.mkdirSync(path.join(directory, 'llm-api-key.bin'))

    await assert.rejects(
      () => service.update({
        llm: { baseUrl: 'https://after.example/v1', model: 'after-model', apiKey: 'cannot-commit' },
      }),
      /API Key 保存失败，普通配置已回滚/,
    )
    const settings = await service.getPublic()
    assert.equal(settings.llm.baseUrl, 'https://before.example/v1')
    assert.equal(settings.llm.model, 'before-model')
    assert.equal(settings.llm.hasApiKey, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('unavailable secure storage rejects the key before changing ordinary settings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-key-preflight-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    await service.update({ llm: { baseUrl: 'https://before.example/v1', model: 'before-model' } })
    const unavailable = new SettingsService(directory, {
      ...fakeStorage,
      isEncryptionAvailable: () => false,
    })
    await assert.rejects(
      () => unavailable.update({
        llm: { baseUrl: 'https://after.example/v1', model: 'after-model', apiKey: 'cannot-encrypt' },
      }),
      /系统安全存储当前不可用/,
    )
    const settings = await service.getPublic()
    assert.equal(settings.llm.baseUrl, 'https://before.example/v1')
    assert.equal(settings.llm.model, 'before-model')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('generic settings updates cannot bypass the dedicated screenshot directory migration', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-screenshot-guard-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    const original = await service.getPublic()
    await assert.rejects(
      () => service.update({ screenshotsDirectory: path.join(directory, 'unsafe-target') }),
      /专用的安全迁移操作/,
    )
    assert.equal((await service.getPublic()).screenshotsDirectory, original.screenshotsDirectory)

    const target = path.join(directory, 'safe-target')
    const updated = await service.setScreenshotsDirectory(target)
    assert.equal(updated.screenshotsDirectory, path.resolve(target))
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')) as Record<string, unknown>
    assert.equal(config.screenshotsDirectory, path.resolve(target))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('concurrent screenshot and LLM settings writes preserve both updates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-concurrency-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    const target = path.join(directory, 'screenshots-target')
    await Promise.all([
      service.setScreenshotsDirectory(target),
      service.update({
        llm: {
          baseUrl: 'https://provider.example/v1',
          model: 'concurrent-model',
          customRules: ['保留并发设置'],
        },
      }),
    ])

    const settings = await service.getPublic()
    assert.equal(settings.screenshotsDirectory, path.resolve(target))
    assert.equal(settings.llm.baseUrl, 'https://provider.example/v1')
    assert.equal(settings.llm.model, 'concurrent-model')
    assert.deepEqual(settings.llm.customRules, ['保留并发设置'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('LLM settings reject invalid enums and unknown fields without changing stored values', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetracker-settings-validation-'))
  try {
    const service = new SettingsService(directory, fakeStorage)
    await service.update({ llm: { baseUrl: 'https://provider.example/v1', model: 'model-a' } })
    const before = await service.getPublic()
    await assert.rejects(() => service.update({ llm: { logGranularity: 'verbose' } }), /日志粒度无效/)
    await assert.rejects(() => service.update({ llm: { toneMode: 'creative' } }), /风格模式无效/)
    await assert.rejects(() => service.update({ llm: { hiddenOption: true } }), /不支持的 LLM 设置字段/)
    assert.deepEqual(await service.getPublic(), before)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
