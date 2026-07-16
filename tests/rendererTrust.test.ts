import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { isTrustedRendererUrl } from '../electron/services/rendererTrust.ts'

test('packaged renderer trust accepts only the exact application index file', () => {
  const rendererFile = path.resolve('dist', 'index.html')
  const trusted = pathToFileURL(rendererFile)
  trusted.hash = '#/project/example'
  trusted.searchParams.set('source', 'test')

  assert.equal(isTrustedRendererUrl(trusted.toString(), { rendererFile }), true)
  assert.equal(isTrustedRendererUrl(pathToFileURL(path.join(path.dirname(rendererFile), 'other.html')).toString(), { rendererFile }), false)
  assert.equal(isTrustedRendererUrl('file://server/share/index.html', { rendererFile }), false)
  assert.equal(isTrustedRendererUrl('https://example.com/index.html', { rendererFile }), false)
  assert.equal(isTrustedRendererUrl('data:text/html,diagnostic', { rendererFile }), false)
})

test('development renderer trust is restricted to the configured origin', () => {
  const options = { devServerUrl: 'http://127.0.0.1:5173/', rendererFile: path.resolve('dist', 'index.html') }
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/project/one', options), true)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', options), false)
  assert.equal(isTrustedRendererUrl('https://127.0.0.1:5173/', options), false)
  assert.equal(isTrustedRendererUrl('file:///tmp/index.html', options), false)
})
