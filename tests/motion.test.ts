import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getStaggerStyle,
  getMotionPhaseClass,
  makeRitualKey,
  shouldAnimateCountChange,
} from '../src/lib/motion.ts'

test('getStaggerStyle exposes the CSS stagger custom property', () => {
  assert.deepEqual(getStaggerStyle(3), { '--stagger': 3 })
})

test('getMotionPhaseClass maps known ritual phases to stable class names', () => {
  assert.equal(getMotionPhaseClass('confirm'), 'ritual-confirm')
  assert.equal(getMotionPhaseClass('timeline'), 'ritual-timeline')
  assert.equal(getMotionPhaseClass('sync'), 'ritual-sync')
  assert.equal(getMotionPhaseClass('settle'), 'ritual-settle')
})

test('makeRitualKey changes when an entity receives a new event timestamp', () => {
  assert.equal(makeRitualKey('commit-1', 1779800000000), 'commit-1:1779800000000')
})

test('shouldAnimateCountChange only animates real count changes', () => {
  assert.equal(shouldAnimateCountChange(3, 4), true)
  assert.equal(shouldAnimateCountChange(4, 4), false)
  assert.equal(shouldAnimateCountChange(undefined, 1), false)
})
