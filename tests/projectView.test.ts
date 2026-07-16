import test from 'node:test'
import assert from 'node:assert/strict'
import { getActivityLevel, getProjectCover, getRecentRecord, toImageSrc } from '../src/lib/projectView.ts'

test('getActivityLevel maps commit counts into calm heatmap levels', () => {
  assert.equal(getActivityLevel(0), 0)
  assert.equal(getActivityLevel(1), 1)
  assert.equal(getActivityLevel(2), 2)
  assert.equal(getActivityLevel(4), 3)
  assert.equal(getActivityLevel(8), 4)
})

test('getProjectCover prefers manual cover before development record images', () => {
  const project = {
    coverImagePath: 'C:/manual.png',
    commits: [
      { images: [{ imagePath: 'C:/commit.png' }] }
    ]
  }

  assert.equal(getProjectCover(project), 'C:/manual.png')
})

test('getProjectCover falls back to latest development record image', () => {
  const project = {
    coverImagePath: '',
    commits: [
      { images: [] },
      { images: [{ imagePath: 'C:/older.png' }] }
    ],
    recentRecord: { images: [{ imagePath: 'C:/recent.png' }] }
  }

  assert.equal(getProjectCover(project), 'C:/recent.png')
})

test('getRecentRecord returns the first record from an already sorted list', () => {
  const record = { title: '最新进展' }
  assert.equal(getRecentRecord({ records: [record, { title: '旧进展' }] }), record)
})

test('toImageSrc preserves data URI mock previews', () => {
  const src = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E'
  assert.equal(toImageSrc(src), src)
})

test('toImageSrc adds bounded local thumbnail requests and restores the original preview URL', () => {
  const thumbnail = toImageSrc('C:\\repo\\preview.png', 640)
  const thumbnailUrl = new URL(thumbnail)
  assert.equal(thumbnailUrl.protocol, 'vibe-asset:')
  assert.equal(thumbnailUrl.hostname, 'local')
  assert.equal(thumbnailUrl.searchParams.get('size'), '640')

  const original = new URL(toImageSrc(thumbnail))
  assert.equal(original.searchParams.has('size'), false)
  assert.equal(toImageSrc('https://example.com/image.png', 320), 'https://example.com/image.png')
})
