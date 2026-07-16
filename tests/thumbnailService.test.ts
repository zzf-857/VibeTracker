import assert from 'node:assert/strict'
import test from 'node:test'
import { parseThumbnailSize, ThumbnailService } from '../electron/services/thumbnailService.ts'

test('thumbnail size parsing accepts only bounded cache presets', () => {
  assert.equal(parseThumbnailSize(null), null)
  assert.equal(parseThumbnailSize('96'), 96)
  assert.equal(parseThumbnailSize('1280'), 1280)
  assert.throws(() => parseThumbnailSize(''), /尺寸无效/)
  assert.throws(() => parseThumbnailSize('97'), /允许范围/)
  assert.throws(() => parseThumbnailSize('640.5'), /尺寸无效/)
})

test('thumbnail cache deduplicates concurrent work and invalidates by file version', async () => {
  let generated = 0
  const service = new ThumbnailService(async (_filePath, size) => {
    generated += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return Buffer.alloc(size, generated)
  }, { maxEntries: 4, maxBytes: 10_000 })

  const [first, duplicate] = await Promise.all([
    service.get('C:\\images\\one.png', '100:1', 96),
    service.get('C:\\images\\one.png', '100:1', 96),
  ])
  assert.equal(generated, 1)
  assert.equal(first, duplicate)
  assert.equal(await service.get('C:\\images\\one.png', '100:1', 96), first)
  assert.equal(generated, 1)

  const changed = await service.get('C:\\images\\one.png', '101:2', 96)
  assert.equal(generated, 2)
  assert.notEqual(changed, first)
})

test('thumbnail cache evicts least-recently-used entries within entry and byte budgets', async () => {
  const counts = new Map<string, number>()
  const service = new ThumbnailService(async filePath => {
    counts.set(filePath, (counts.get(filePath) || 0) + 1)
    return Buffer.alloc(700, filePath.charCodeAt(0))
  }, { maxEntries: 2, maxBytes: 1_500 })

  await service.get('a', '1', 96)
  await service.get('b', '1', 96)
  await service.get('a', '1', 96)
  await service.get('c', '1', 96)
  await service.get('b', '1', 96)

  assert.equal(counts.get('a'), 1)
  assert.equal(counts.get('b'), 2)
  assert.equal(counts.get('c'), 1)
})
