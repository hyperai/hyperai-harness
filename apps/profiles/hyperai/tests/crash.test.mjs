/**
 * Real subprocess SIGKILL regression for the legacy skills swap.
 *
 * The child is the real install-skills.mjs CLI. A SIGSTOP freezes the exact
 * "old directory renamed away, new directory not yet in place" state after it
 * is observed, then SIGKILL terminates the process. No journal or filesystem
 * state is fabricated. The test uses 12 skills and user extras at both the
 * skill root and inside references/.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(PKG, 'scripts', 'install-skills.mjs')
const NAMES = Array.from({ length: 12 }, (_, index) => `qa-kill-${String(index + 1).padStart(2, '0')}`)
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function writeSkills(repo, version) {
  const root = join(repo, 'skills')
  for (const name of NAMES) {
    const dir = join(root, name)
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${version} ${name}\nversion: ${version === 'v1' ? '1.0.0' : version === 'v2' ? '2.0.0' : '3.0.0'}\n---\n\n# ${version}\n`)
    writeFileSync(join(dir, 'references', 'notes.md'), `managed ${version} ${name}\n`)
  }
}

function lockFor(path, repo, ref) {
  writeFileSync(path, `${JSON.stringify({
    schema: 1,
    repository: repo,
    ref,
    verified: NAMES.map(name => ({ name, area: 'skills', validated: true })),
    unverified: [],
  }, undefined, 2)}\n`)
}

function runInstaller(home, lock, repo, ref, extra = []) {
  return spawnSync(process.execPath, [
    CLI, '--dsh-home', home, '--profile', 'hyperai', '--lock', lock, '--source', repo, ...extra,
  ], { encoding: 'utf8', timeout: 60_000 })
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function hashTree(dir) {
  const out = {}
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(current, entry.name), relative)
      else if (entry.isFile()) out[relative] = hashFile(join(current, entry.name))
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out
}

function extrasHashes(home) {
  const root = join(home, 'profiles', 'hyperai', 'skills')
  const out = {}
  for (const name of NAMES) {
    for (const relative of ['NOTES.md', join('references', 'my-notes.md')]) {
      out[`${name}/${relative}`] = hashFile(join(root, name, relative))
    }
  }
  return out
}

test('MID-SWAP SIGKILL restores old tree and preserves user extras before v2/v3 updates', { timeout: 120_000 }, async () => {
  if (process.platform === 'win32') return
  const root = tempDir('hyperai-crash-')
  const home = join(root, 'home')
  const repo = join(root, 'repo')
  const baseline = join(root, 'baseline')
  mkdirSync(repo, { recursive: true })
  try {
    git(repo, 'init', '-q', '-b', 'master')
    git(repo, 'config', 'user.email', 'qa@example.invalid')
    git(repo, 'config', 'user.name', 'QA')
    writeSkills(repo, 'v1')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'v1')
    const v1 = git(repo, 'rev-parse', 'HEAD')
    const lockV1 = join(root, 'lock-v1.json')
    lockFor(lockV1, repo, v1)
    const installed = runInstaller(home, lockV1, repo, undefined)
    assert.equal(installed.status, 0, installed.stderr)
    const skillsRoot = join(home, 'profiles', 'hyperai', 'skills')
    for (const name of NAMES) {
      writeFileSync(join(skillsRoot, name, 'NOTES.md'), `user root ${name}\n`)
      writeFileSync(join(skillsRoot, name, 'references', 'my-notes.md'), `user ref ${name}\n`)
    }
    const beforeExtras = extrasHashes(home)
    cpSync(home, baseline, { recursive: true })

    writeSkills(repo, 'v2')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'v2')
    const v2 = git(repo, 'rev-parse', 'HEAD')
    const lockV2 = join(root, 'lock-v2.json')
    lockFor(lockV2, repo, v2)

    let caught
    for (let attempt = 1; attempt <= 10 && caught === undefined; attempt++) {
      rmSync(home, { recursive: true, force: true })
      cpSync(baseline, home, { recursive: true })
      const child = spawn(process.execPath, [
        CLI, '--dsh-home', home, '--profile', 'hyperai', '--lock', lockV2, '--source', repo, '--json',
      ], { stdio: 'ignore' })
      let exited = false
      child.once('exit', () => { exited = true })
      const started = Date.now()
      while (Date.now() - started < 8_000 && !exited && caught === undefined) {
        for (const name of NAMES) {
          const target = join(skillsRoot, name)
          if (existsSync(target)) continue
          const pending = join(home, 'profiles', 'hyperai', '.hyperai-skills', 'pending', `${name}.json`)
          const staging = join(home, 'profiles', 'hyperai', '.hyperai-skills', 'staging')
          if (!existsSync(pending) || !existsSync(staging)) continue
          const old = readdirSync(staging).find(entry => entry.startsWith(`${name}-old-`))
          if (old === undefined) continue
          try {
            process.kill(child.pid, 'SIGSTOP')
          } catch {
            continue
          }
          await delay(20)
          if (!existsSync(target) && existsSync(join(staging, old))) {
            try {
              process.kill(child.pid, 'SIGKILL')
              caught = { name, old: join(staging, old) }
            } catch { caught = undefined }
          } else {
            try { process.kill(child.pid, 'SIGCONT') } catch { /* already gone */ }
          }
          break
        }
        if (caught === undefined) await new Promise(resolveTick => setImmediate(resolveTick))
      }
      if (!exited) {
        child.kill('SIGCONT')
        child.kill('SIGKILL')
      }
    }
    assert.ok(caught, 'could not freeze the real MID-SWAP window in 10 attempts')
    assert.equal(existsSync(caught.old), true, 'old tree must survive the kill')
    assert.deepEqual(hashTree(caught.old)['NOTES.md'], beforeExtras[`${caught.name}/NOTES.md`])

    const recovered = runInstaller(home, lockV2, repo, undefined)
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.equal(existsSync(join(home, 'profiles', 'hyperai', '.hyperai-skills', 'pending')), true)
    assert.deepEqual(readdirSync(join(home, 'profiles', 'hyperai', '.hyperai-skills', 'pending')), [])
    assert.deepEqual(extrasHashes(home), beforeExtras)
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'hyperai', '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.equal(Object.keys(manifest.skills).length, NAMES.length)
    for (const name of NAMES) {
      assert.equal(manifest.skills[name].ref, v2)
      for (const [file, digest] of Object.entries(manifest.skills[name].files)) {
        assert.equal(hashFile(join(skillsRoot, name, file)), digest, `${name}/${file}`)
      }
    }

    // Repeated recovery/update is idempotent and still preserves extras.
    const again = runInstaller(home, lockV2, repo, undefined)
    assert.equal(again.status, 0, again.stderr)
    assert.deepEqual(extrasHashes(home), beforeExtras)

    // A later v3 update must also converge and keep extras.
    writeSkills(repo, 'v3')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'v3')
    const v3 = git(repo, 'rev-parse', 'HEAD')
    const lockV3 = join(root, 'lock-v3.json')
    lockFor(lockV3, repo, v3)
    const v3run = runInstaller(home, lockV3, repo, undefined)
    assert.equal(v3run.status, 0, v3run.stderr)
    assert.deepEqual(extrasHashes(home), beforeExtras)
    const v3manifest = JSON.parse(readFileSync(join(home, 'profiles', 'hyperai', '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.deepEqual(NAMES.map(name => v3manifest.skills[name].ref), NAMES.map(() => v3))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
