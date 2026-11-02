/**
 * Installer planning checks: argument parsing, the dry-run plan, the managed
 * marker, and the refusal to touch a profile this installer did not create.
 * These never run pnpm and never touch the real Harness home.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dependencyInstallArgs, install, mergeCordisPatch, parseArgs, profileManifest, workspaceFile } from '../scripts/install.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TUI = resolve(PKG, '..', '..', 'tui')
const brand = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'hyperai-tui-test-'))
}

test('parseArgs defaults to the hyperai profile under the Harness home', () => {
  const options = parseArgs(['--dsh-home', '/tmp/example-home'])
  assert.equal(options.profile, brand.profileName)
  assert.equal(options.dshHome, '/tmp/example-home')
  assert.equal(options.profileDir, '/tmp/example-home/profiles/hyperai')
  assert.equal(options.skills, true)
  assert.equal(options.verifiedOnly, true)
})

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown argument/u)
})

test('dry run plans every managed file and writes nothing', async () => {
  const home = temporaryHome()
  try {
    const result = await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    assert.deepEqual(
      result.plan.map(step => `${step.action} ${step.file}`),
      [
        'create package.json',
        'create cordis.patch.yml',
        'create pnpm-workspace.yaml',
        'create patches/hyperai-tui.patch',
        'create scripts/skills-lib.mjs',
        'create scripts/skills-update.mjs',
      ],
    )
    assert.equal(existsSync(join(home, 'profiles', 'hyperai', 'package.json')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('dry run is idempotent on a managed profile', async () => {
  const home = temporaryHome()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(profileManifest(), undefined, 2)}\n`)
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8'),
    )
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), workspaceFile())
    const result = await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    assert.deepEqual(
      result.plan.map(step => step.action),
      ['unchanged', 'unchanged', 'unchanged', 'create', 'create', 'create'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('reinstall drops the legacy preset rows but keeps user model configuration', () => {
  const template = readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8')
  const legacyPreset = `# old template header
- id: llm-pi-ai
  config:
    providers:
      hyperai:
        apiKeyEnv: !!js process.env.HYPERAI_API_KEY_ENV ?? 'HYPERAI_API_KEY'
        baseURL: !!js process.env.HYPERAI_BASE_URL ?? 'https://api.openai.com/v1'
        models: !!js >-
          (process.env.HYPERAI_MODELS ?? 'gpt-4o-mini').split(',')
- id: dsh-tui
  config:
    provider: !!js process.env.HYPERAI_PROVIDER ?? 'hyperai'
    model: !!js process.env.HYPERAI_MODEL ?? 'gpt-4o-mini'
    fullscreen: true
    terminalImages: true
    effort: max
- id: skill-filesystem
  config:
    providerName: filesystem
`
  const migrated = mergeCordisPatch(legacyPreset, template)
  assert.equal(migrated.includes('- id: llm-pi-ai'), false)
  assert.equal(migrated.includes('- id: dsh-tui'), false)
  assert.equal(migrated.includes('HYPERAI_API_KEY'), false)
  assert.ok(migrated.includes('- id: skill-filesystem'))

  const userConfig = `${legacyPreset.replace(/^- id: dsh-tui[\s\S]*?\n(?=- id: skill-filesystem)/mu, '')}- id: llm-pi-ai
  config:
    providers:
      litellm:
        apiKeyEnv: LITELLM_API_KEY
        baseURL: https://gateway.example/v1
        api: openai-completions
        models:
          - id: gpt-4o-mini
- insert:
    - id: my-plugin
      name: my-plugin
`
  const kept = mergeCordisPatch(userConfig, template)
  assert.ok(kept.includes('litellm'))
  assert.ok(kept.includes('LITELLM_API_KEY'))
  assert.ok(kept.includes('- insert:'))
  assert.ok(kept.includes('id: my-plugin'))
  // the legacy provider row with expressions is still replaced
  assert.equal(kept.includes('HYPERAI_API_KEY_ENV'), false)

  // A user-edited TUI row (settings the old preset also restated) survives,
  // without the removed env-driven provider/model defaults.
  const tuiUserRow = `${legacyPreset.replace(/^- id: dsh-tui[\s\S]*?\n(?=- id: skill-filesystem)/mu, '')}- id: dsh-tui
  config:
    provider: !!js process.env.HYPERAI_PROVIDER ?? 'hyperai'
    model: !!js process.env.HYPERAI_MODEL ?? 'gpt-4o-mini'
    fullscreen: false
    lang: zh
`
  const tuiKept = mergeCordisPatch(tuiUserRow, template)
  assert.ok(tuiKept.includes('- id: dsh-tui'))
  assert.ok(tuiKept.includes('fullscreen: false'))
  assert.ok(tuiKept.includes('lang: zh'))
  assert.equal(tuiKept.includes('HYPERAI_PROVIDER'), false)
})

test('a foreign profile is refused without --force', async () => {
  const home = temporaryHome()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{"name":"someone-elses-profile"}\n')
    await assert.rejects(
      install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run'])),
      /not created by this installer/u,
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('repeated reinstall normalizes trailing blank lines (QA-018)', () => {
  const template = readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8')
  const withBlank = `${template.replace(/\n+$/u, '\n')}\n\n\n`
  const first = mergeCordisPatch(withBlank, template)
  const second = mergeCordisPatch(first, template)
  assert.equal(first, second)
  assert.equal(/\n{3,}$/u.test(first), false)
})

test('a failed install records a diagnosable failed state (QA-009)', async () => {
  if (process.platform === 'win32') return
  const home = temporaryHome()
  const root = temporaryHome()
  try {
    const fakeDsh = join(root, 'fake-dsh')
    writeFileSync(fakeDsh, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "0.2.0-rc.2\\n"; exit 0; fi\nexit 7\n')
    const { chmodSync } = await import('node:fs')
    chmodSync(fakeDsh, 0o755)
    await assert.rejects(install(parseArgs(['--dsh-home', home, '--dsh-bin', fakeDsh, '--no-skills'])), /dsh plugin|exited|Command failed/u)
    const state = JSON.parse(readFileSync(join(home, 'profiles', 'hyperai', '.hyperai-install.json'), 'utf8'))
    assert.equal(state.status, 'failed')
    assert.equal(state.schema, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})


test('default skill install is verified-only and frozen lock is opt-in (QA-015/022)', () => {
  const defaults = parseArgs([])
  assert.equal(defaults.verifiedOnly, true)
  assert.equal(defaults.frozenLockfile, false)
  const args = dependencyInstallArgs({ profile: 'hyperai', frozenLockfile: false })
  assert.ok(args.includes('--no-frozen-lockfile'))
  const frozen = dependencyInstallArgs({ profile: 'hyperai', frozenLockfile: true })
  assert.ok(frozen.includes('--frozen-lockfile'))
  assert.equal(frozen.includes('--no-frozen-lockfile'), false)
})

test('full default install succeeds with a local skills fixture and stubbed dsh (QA-003/009)', async () => {
  if (process.platform === 'win32') return
  const root = temporaryHome()
  const home = temporaryHome()
  try {
    const repo = join(root, 'skills-repo')
    mkdirSync(join(repo, 'skills', 'example'), { recursive: true })
    writeFileSync(join(repo, 'skills', 'example', 'SKILL.md'), '---\nname: example\ndescription: Use when testing\n---\n# example\n')
    const { execFileSync } = await import('node:child_process')
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim()
    git('init', '-q', '-b', 'master')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    git('add', '-A')
    git('commit', '-qm', 'fixture')
    const ref = git('rev-parse', 'HEAD')
    const lockPath = join(root, 'lock.json')
    writeFileSync(lockPath, `${JSON.stringify({
      schema: 1, repository: repo, ref,
      verified: [{ name: 'example', area: 'skills', validated: true }], unverified: [],
    })}\n`)
    const fakeDsh = join(root, 'fake-dsh')
    writeFileSync(fakeDsh, `#!/bin/sh
if [ "$1" = "--version" ]; then printf "0.2.0-rc.2\\n"; exit 0; fi
if [ "$1" = "plugin" ]; then
  profile="hyperai"
  prev=""
  for arg in "$@"; do if [ "$prev" = "--profile" ]; then profile="$arg"; fi; prev="$arg"; done
  dir="$DSH_HOME/profiles/$profile/node_modules/@deepseek-harness-tui/dsh-tui/lib/types"
  mkdir -p "$dir/components"
  printf "HYPERAI\\n" > "$dir/branding.js"
  printf "showWhale: false\\nHYPERAI_PALETTE.title\\n" > "$dir/components/LogoV2.js"
  exit 0
fi
exit 7
`)
    const { chmodSync } = await import('node:fs')
    chmodSync(fakeDsh, 0o755)
    const result = await install(parseArgs([
      '--dsh-home', home, '--dsh-bin', fakeDsh,
      '--skills-source', repo, '--skills-lock', lockPath,
    ]))
    const profileDir = join(home, 'profiles', 'hyperai')
    assert.ok(result.skills.installed.includes('example'))
    assert.equal(readFileSync(join(profileDir, 'skills', 'example', 'SKILL.md'), 'utf8').includes('Use when testing'), true)
    const state = JSON.parse(readFileSync(join(profileDir, '.hyperai-install.json'), 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.phase, 'done')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
