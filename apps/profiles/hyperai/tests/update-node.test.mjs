import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeSupported } from '../scripts/update.mjs'

test('update refuses Node versions the bundled dsh cannot run', () => {
  assert.equal(nodeSupported('18.20.4'), false)
  assert.equal(nodeSupported('20.11.0'), false)
  assert.equal(nodeSupported('22.18.0'), false)
  assert.equal(nodeSupported('22.19.0'), true)
  assert.equal(nodeSupported('22.23.4'), true)
  assert.equal(nodeSupported('24.0.0'), true)
})
