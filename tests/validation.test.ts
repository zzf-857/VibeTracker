import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expectFiniteNumber,
  expectObjectFields,
  validateAiGeneratedPayload,
  validateImportLaunchCandidate,
  validateLaunchProfile,
  ValidationError,
} from '../electron/services/validation.ts'
import { filterCommitFiles } from '../electron/services/llmService.ts'

test('AI JSON validation accepts traceable records and rejects malformed responses', () => {
  const result = validateAiGeneratedPayload({
    project: { name: 'VibeTracker', description: '本地中枢', techStack: ['Electron'], tags: [], phase: '开发中', phaseReason: '仍在实现', confidence: 0.8, evidence: ['README'] },
    records: [{ title: '接入 Git', description: '增量同步', gitShas: ['a'.repeat(40)], confidence: 0.9, evidence: ['commit:a'] }],
    assetNotes: [],
  })
  assert.equal(result.records[0].gitShas[0], 'a'.repeat(40))
  assert.throws(() => validateAiGeneratedPayload({ project: {}, records: 'bad', assetNotes: [] }), ValidationError)
  assert.throws(() => validateAiGeneratedPayload({
    project: { name: 'x', description: '', techStack: [], tags: [], phase: '', phaseReason: '', confidence: 2, evidence: [] },
    records: [], assetNotes: [],
  }), /0-1/)
})

test('launch profile validation preserves argument arrays and rejects unsafe shapes', () => {
  const profile = validateLaunchProfile({
    projectId: 'project-1', name: '开发服务器', executable: 'npm.cmd', args: ['run', 'dev'],
    cwd: 'C:\\repo', env: { PORT: '4173' }, readyUrl: 'http://localhost:4173', readyPort: 4173,
  })
  assert.deepEqual(profile.args, ['run', 'dev'])
  assert.equal(profile.readyPort, 4173)
  assert.throws(() => validateLaunchProfile({ ...profile, args: 'run dev' }), /参数必须是数组/)
  assert.throws(() => validateLaunchProfile({ ...profile, readyPort: 70000 }), /1-65535/)
  assert.throws(() => validateLaunchProfile({ ...profile, enabled: 'false' }), /布尔值/)
  assert.throws(() => validateLaunchProfile({ ...profile, reason: '扫描说明' }), /不支持字段: reason/)
})

test('strict object contracts reject unknown project, record, and pagination fields', () => {
  assert.throws(() => expectObjectFields(
    { name: 'Project', description: '', progress: 50 },
    '项目更新',
    ['name', 'description', 'phase', 'milestone', 'nextStep'],
  ), /项目更新包含不支持字段: progress/)
  assert.throws(() => expectObjectFields(
    { projectId: 'project-1', title: '记录', description: '', progressDelta: 10 },
    '开发记录',
    ['projectId', 'title', 'description', 'createdAt', 'gitShas'],
  ), /开发记录包含不支持字段: progressDelta/)
  assert.throws(() => expectObjectFields(
    { cursor: '1|record-1', limit: 30, offset: 30 },
    '分页参数',
    ['cursor', 'limit', 'reviewStatus'],
  ), /分页参数包含不支持字段: offset/)
})

test('import launch candidates keep display-only reasons out of persisted profiles', () => {
  const profile = validateImportLaunchCandidate('project-1', {
    name: '开发服务器', executable: 'node.exe', args: ['server.js'], cwd: 'C:\\repo',
    env: {}, readyUrl: 'http://127.0.0.1:4173', readyPort: 4173,
    reason: '从 package.json 发现，仅推荐，不会自动执行',
  })
  assert.equal('reason' in profile, false)
  assert.equal(profile.enabled, true)
  assert.throws(() => validateImportLaunchCandidate('project-1', {
    name: '开发服务器', executable: 'node.exe', args: [], cwd: 'C:\\repo', env: {},
    readyUrl: '', readyPort: null, reason: '', shell: true,
  }), /不支持字段: shell/)
})

test('LLM file exclusions remove matching paths without removing Git traceability', () => {
  const [commit] = filterCommitFiles([{
    sha: 'a'.repeat(40), parentShas: [], authorName: 'Dev', authorEmail: '', authoredAt: 1,
    subject: 'change', body: '', fileNames: ['src/main.ts', 'dist/app.js', 'packages/a/.env.local', 'package-lock.json'],
    stats: { added: 10, deleted: 1, files: 4 },
  }], ['dist/**', '.env*', '*.lock', 'package-lock.json'])
  assert.deepEqual(commit.fileNames, ['src/main.ts'])
  assert.equal(commit.sha, 'a'.repeat(40))
  assert.equal(commit.stats.files, 1)
})

test('finite number validation rejects coercion and enforces integer bounds', () => {
  assert.equal(expectFiniteNumber(50, '分页数量', { integer: true, min: 1, max: 100 }), 50)
  assert.throws(() => expectFiniteNumber('50', '分页数量', { integer: true }), /有效数字/)
  assert.throws(() => expectFiniteNumber(Number.NaN, '分页数量'), /有效数字/)
  assert.throws(() => expectFiniteNumber(1.5, '分页数量', { integer: true }), /整数/)
  assert.throws(() => expectFiniteNumber(0, '分页数量', { min: 1 }), /不能小于/)
})
