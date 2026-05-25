import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStatusName } from '../src/lib/statusValidation.ts'

const statuses = [
  { id: 'todo', name: '待启动' },
  { id: 'doing', name: '进行中' }
]

test('validateStatusName rejects blank names after trimming', () => {
  assert.deepEqual(validateStatusName('   ', statuses), {
    ok: false,
    message: '状态名不能为空'
  })
})

test('validateStatusName rejects duplicate names after trimming', () => {
  assert.deepEqual(validateStatusName(' 进行中 ', statuses), {
    ok: false,
    message: '状态名已存在'
  })
})

test('validateStatusName allows saving the current status with the same name', () => {
  assert.deepEqual(validateStatusName(' 进行中 ', statuses, 'doing'), {
    ok: true,
    value: '进行中'
  })
})
