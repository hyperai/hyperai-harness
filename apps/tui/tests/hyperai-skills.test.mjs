/**
 * Offline contract checks for the HyperAI Skills TUI bridge formatting and
 * SHA-pinning fingerprint. No TUI and no network are touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkingText, choices, confirmMessage, currentText, detailOptions, dialogTitle, errorText,
  errorTitle, fingerprint, normalizeCheck, noticeText, resultText,
} from '../src/hyperaiSkillsCore.js'

const payload = {
  source: { repo: 'https://example.invalid/skills.git', requestedRef: 'feat/ppt-generation-upstream', resolvedRef: 'a'.repeat(40), channel: 'prerelease' },
  changes: true,
  count: 2,
  updates: [
    { name: 'ppt-generation', action: 'add', version: '1.1.0', description: 'PPT generation', files: 17, bytes: 371397, digest: 'd1' },
    { name: 'kiwix-search', action: 'update', version: '2.0.0', files: 4, bytes: 100, digest: 'd2' },
  ],
}

test('normalizeCheck keeps the compact fields and validates the shape', () => {
  const checked = normalizeCheck(payload)
  assert.equal(checked.resolvedRef, 'a'.repeat(40))
  assert.equal(checked.channel, 'prerelease')
  assert.equal(checked.count, 2)
  assert.deepEqual(checked.updates.map(item => [item.name, item.action]), [['ppt-generation', 'add'], ['kiwix-search', 'update']])
  assert.throws(() => normalizeCheck(null))
})

test('fingerprint changes only when the pinned SHA or shown content changes', () => {
  const one = fingerprint(payload)
  assert.equal(fingerprint(payload), one)
  const sameShaNewDigest = { ...payload, updates: [{ ...payload.updates[0], digest: 'other' }] }
  assert.notEqual(fingerprint(sameShaNewDigest), one)
  const newSha = { ...payload, source: { ...payload.source, resolvedRef: 'b'.repeat(40) } }
  assert.notEqual(fingerprint(newSha), one)
})

test('prompt copy lists add/update and the install/later choices', () => {
  assert.match(noticeText(payload, 'zh'), /2 项可安装更新.*\/skills-update/u)
  assert.match(noticeText(payload, 'en'), /2 updates available.*\/skills-update/u)
  assert.equal(dialogTitle(payload, 'zh'), 'HyperAI Skills · 2 项可安装')
  assert.deepEqual(choices(payload, 'zh').map(item => item.id), ['install', 'details', 'later'])
  assert.ok(choices(payload, 'en').find(item => item.id === 'install').description.includes('ppt-generation'))
  const details = detailOptions(payload, 'en')
  assert.equal(details.at(-1).id, 'back')
  assert.ok(details[0].label.includes('ppt-generation'))
  assert.ok(details[1].label.includes('kiwix-search'))
  assert.match(confirmMessage(payload, 'zh'), /ppt-generation/u)
})

test('result/error/current copy stays short and non-verbose', () => {
  assert.match(resultText({ installed: ['ppt-generation'], updated: [], failed: [] }, 'zh'), /已安装 ppt-generation/u)
  assert.match(resultText({ installed: [], updated: ['kiwix-search'], failed: [{ name: 'x', error: 'boom' }] }, 'en'), /Updated kiwix-search; Failed: x/u)
  assert.match(errorText(new Error('git clone failed with a very long detail '.repeat(20)), 'en'), /check failed: git clone failed/u)
  assert.ok(errorText(new Error('x'.repeat(500))).length < 220)
  assert.match(currentText('zh'), /已是最新/u)
  assert.match(checkingText('zh'), /正在检查/u)
  assert.match(errorTitle('en'), /check failed/u)
})
