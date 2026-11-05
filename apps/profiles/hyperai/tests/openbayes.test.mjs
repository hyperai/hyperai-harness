/**
 * Installing the OpenBayes user skill must be best-effort and safe.
 *
 * The skill is downloaded at install time (never bundled), must not overwrite a
 * copy another agent already uses, and must never fail the HyperAI install.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installOpenbayesSkill, openbayesSkillDir, openbayesVersion, parseArgs, validateOpenbayesArchive } from '../scripts/install.mjs'

/** Build `openbayes-user/…` and pack it with the system tar. */
function makeArchive({ skill = '# OpenBayes User\n', version = 'v9.9.9', extra = undefined, omitSkill = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openbayes-fixture-'))
  const tree = join(root, 'tree')
  mkdirSync(join(tree, 'openbayes-user'), { recursive: true })
  if (!omitSkill) writeFileSync(join(tree, 'openbayes-user', 'SKILL.md'), skill)
  if (version !== undefined) writeFileSync(join(tree, 'openbayes-user', 'VERSION'), `${version}\n`)
  if (extra !== undefined) extra(tree)
  const archive = join(root, 'latest.tar.gz')
  const packed = spawnSync('tar', ['-czf', archive, '-C', tree, 'openbayes-user'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  return { archive, root }
}

/** Serve one file at `/latest.tar.gz`; anything else is a 404. */
async function serve(body) {
  const server = createServer((request, response) => {
    if (request.url === '/latest.tar.gz' && body !== undefined) {
      response.writeHead(200, { 'content-type': 'application/gzip' })
      response.end(body)
      return
    }
    response.writeHead(404)
    response.end('missing')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/latest.tar.gz`, close: () => new Promise(resolve => server.close(resolve)) }
}

function collect() {
  const lines = []
  return { lines, log: line => lines.push(line) }
}

test('installs the skill into ~/.agents/skills and reports its version', async () => {
  const fixture = makeArchive()
  const server = await serve(readFileSync(fixture.archive))
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  const output = collect()
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: output.log })
    assert.equal(result.status, 'installed')
    assert.equal(result.version, 'v9.9.9')
    assert.equal(readFileSync(join(openbayesSkillDir(home), 'VERSION'), 'utf8').trim(), 'v9.9.9')
    assert.match(output.lines.join('\n'), /已安装 v9\.9\.9/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(fixture.root, { recursive: true, force: true })
    await server.close()
  }
})

test('an existing copy is kept untouched', async () => {
  const fixture = makeArchive()
  const server = await serve(readFileSync(fixture.archive))
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  const dir = openbayesSkillDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'VERSION'), 'v0.0.1\n')
  writeFileSync(join(dir, 'LOCAL-MARKER'), 'keep me\n')
  const output = collect()
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: output.log })
    assert.equal(result.status, 'kept')
    assert.equal(result.version, 'v0.0.1')
    assert.equal(existsSync(join(dir, 'LOCAL-MARKER')), true)
    assert.match(output.lines.join('\n'), /已有 v0\.0\.1，保留不动/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(fixture.root, { recursive: true, force: true })
    await server.close()
  }
})

test('a download failure warns and leaves the rest of the install alone', async () => {
  const server = await serve(undefined)
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  const output = collect()
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: output.log })
    assert.equal(result.status, 'failed')
    assert.match(String(result.reason), /HTTP 404/u)
    assert.match(output.lines.join('\n'), /手动安装：npx skills add https:\/\/openbayes\.com\/skills\/openbayes-user/u)
    assert.equal(existsSync(openbayesSkillDir(home)), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
    await server.close()
  }
})

test('an archive with a second root directory is rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openbayes-fixture-'))
  const tree = join(root, 'tree')
  mkdirSync(join(tree, 'openbayes-user'), { recursive: true })
  mkdirSync(join(tree, 'other'), { recursive: true })
  writeFileSync(join(tree, 'openbayes-user', 'SKILL.md'), '# OpenBayes User\n')
  writeFileSync(join(tree, 'openbayes-user', 'VERSION'), 'v9.9.9\n')
  writeFileSync(join(tree, 'other', 'SKILL.md'), '# wrong\n')
  const archive = join(root, 'latest.tar.gz')
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', tree, 'openbayes-user', 'other'], { encoding: 'utf8' }).status, 0)
  const server = await serve(readFileSync(archive))
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  const output = collect()
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: output.log })
    assert.equal(result.status, 'failed')
    assert.match(String(result.reason), /根目录必须只有 openbayes-user/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    await server.close()
  }
})

test('an archive without SKILL.md is rejected', async () => {
  const fixture = makeArchive({ omitSkill: true })
  const server = await serve(readFileSync(fixture.archive))
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: () => {} })
    assert.equal(result.status, 'failed')
    assert.match(String(result.reason), /缺少 openbayes-user\/SKILL\.md/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(fixture.root, { recursive: true, force: true })
    await server.close()
  }
})

test('an archive containing a symlink is rejected', async () => {
  const fixture = makeArchive({ extra: tree => {
    symlinkSync('/etc/passwd', join(tree, 'openbayes-user', 'leak'))
  } })
  const server = await serve(readFileSync(fixture.archive))
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  try {
    const result = await installOpenbayesSkill({ home, url: server.url, log: () => {} })
    assert.equal(result.status, 'failed')
    assert.match(String(result.reason), /符号链接/u)
    assert.equal(existsSync(join(openbayesSkillDir(home), 'leak')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(fixture.root, { recursive: true, force: true })
    await server.close()
  }
})

test('archive validation rejects absolute paths and parent segments', () => {
  assert.throws(() => validateOpenbayesArchive(['/openbayes-user/SKILL.md']), /非法路径/u)
  assert.throws(() => validateOpenbayesArchive(['openbayes-user/../../evil']), /上级目录/u)
  assert.throws(() => validateOpenbayesArchive(['openbayes-user\\\\SKILL.md']), /非法路径/u)
  assert.throws(() => validateOpenbayesArchive(['openbayes-user/']), /缺少/u)
  assert.equal(validateOpenbayesArchive(['openbayes-user/', 'openbayes-user/SKILL.md'], ['d', '-']), true)
})

test('dry-run only reports the target', async () => {
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  try {
    const result = await installOpenbayesSkill({ home, dryRun: true, log: () => {} })
    assert.equal(result.status, 'planned')
    assert.equal(existsSync(openbayesSkillDir(home)), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('openbayesVersion tolerates a missing VERSION file', () => {
  const home = mkdtempSync(join(tmpdir(), 'openbayes-home-'))
  try {
    mkdirSync(openbayesSkillDir(home), { recursive: true })
    assert.equal(openbayesVersion(openbayesSkillDir(home)), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the installer installs the skill by default and can opt out', () => {
  assert.equal(parseArgs([]).openbayes, true)
  assert.equal(parseArgs(['--no-openbayes']).openbayes, false)
})
