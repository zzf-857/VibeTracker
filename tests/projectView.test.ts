import test from 'node:test'
import assert from 'node:assert/strict'
import { getActivityLevel, getProjectCover, getRecentCommit } from '../src/lib/projectView.ts'

test('getActivityLevel maps commit counts into calm heatmap levels', () => {
  assert.equal(getActivityLevel(0), 0)
  assert.equal(getActivityLevel(1), 1)
  assert.equal(getActivityLevel(2), 2)
  assert.equal(getActivityLevel(4), 3)
  assert.equal(getActivityLevel(8), 4)
})

test('getProjectCover prefers manual cover before commit images', () => {
  const project = {
    coverImagePath: 'C:/manual.png',
    commits: [
      { images: [{ imagePath: 'C:/commit.png' }] }
    ]
  }

  assert.equal(getProjectCover(project), 'C:/manual.png')
})

test('getProjectCover falls back to latest commit image', () => {
  const project = {
    coverImagePath: '',
    commits: [
      { images: [] },
      { images: [{ imagePath: 'C:/older.png' }] }
    ],
    recentCommit: { images: [{ imagePath: 'C:/recent.png' }] }
  }

  assert.equal(getProjectCover(project), 'C:/recent.png')
})

test('getRecentCommit returns the first commit from an already sorted list', () => {
  const commit = { title: '最新进展' }
  assert.equal(getRecentCommit({ commits: [commit, { title: '旧进展' }] }), commit)
})
