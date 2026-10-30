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
import { install, mergeCordisPatch, parseArgs, profileManifest, workspaceFile } from '../scripts/install.mjs'

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
  assert.equal(options.verifiedOnly, false)
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
