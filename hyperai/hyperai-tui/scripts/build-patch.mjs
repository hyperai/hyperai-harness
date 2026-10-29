#!/usr/bin/env node
/**
 * Build the pnpm patch that turns the upstream `@deepseek-harness-tui/dsh-tui`
 * package into the HyperAI-branded TUI used by the `hyperai` profile.
 *
 * The patch is the whole branding implementation: upstream UI logic — chat,
 * streaming, tool cards, approvals, sessions, model pickers, shortcuts — is
 * untouched. Only brand data (splash words, tagline, wordmark, product labels),
 * the splash art slot (official HyperAI mark instead of the DeepSeek whale),
 * the DeepSeek-branded first-run wizard gate, and the default brand labels are
 * replaced. Every replacement is an exact-match edit: a mismatch means the
 * pinned upstream version drifted and the build fails instead of producing a
 * silently half-branded patch.
 *
 * Usage:
 *   node scripts/build-patch.mjs [--version 0.16.1] [--from <pristine-pkg-dir>]
 *
 * Output: patches/dsh-tui@<version>.patch (committed; consumed by
 * profile/pnpm-workspace.yaml `patchedDependencies`).
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const BRAND = JSON.parse(readFileSync(join(PKG, 'brand', 'brand.json'), 'utf8'))

const q = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/** Run a command and return trimmed stdout. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

/**
 * Unpack a pristine upstream package.
 * @param from - Optional local pristine package directory.
 * @param version - Upstream version to fetch from the registry.
 * @returns Absolute path of the extracted package.
 */
function acquireSource(from, version) {
  const work = mkdtempSync(join(tmpdir(), 'hyperai-tui-src-'))
  if (from !== undefined) {
    const source = resolve(from)
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    assertUpstream(manifest, version)
    cpSync(source, work, { recursive: true, filter: path => !path.split(/[\\/]/).includes('.git') })
    return { dir: work, work }
  }
  const tarball = run('npm', ['pack', `${BRAND.upstream.package}@${version}`, '--pack-destination', work, '--silent'])
  const archive = join(work, tarball.split('\n').pop())
  run('tar', ['-xzf', archive, '-C', work])
  rmSync(archive, { force: true })
  const dir = join(work, 'package')
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assertUpstream(manifest, version)
  return { dir, work }
}

/** Fail when the fetched package is not the pinned upstream package/version. */
function assertUpstream(manifest, version) {
  if (manifest.name !== BRAND.upstream.package || manifest.version !== version) {
    throw new Error(
      `expected ${BRAND.upstream.package}@${version}, got ${manifest.name}@${manifest.version}`,
    )
  }
}

/** Initialize a throwaway git repository, commit the tree, and return a diff runner. */
function initRepo(dir) {
  const git = (...args) => run('git', ['-C', dir, ...args])
  git('init', '--quiet')
  git('config', 'user.name', 'hyperai-tui build')
  git('config', 'user.email', 'hyperai-tui@localhost')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'upstream')
  return git
}

/** Apply an exact-match replacement; a missing or duplicated target is a build error. */
function replaceOne(root, edit) {
  const path = join(root, edit.file)
  const original = readFileSync(path, 'utf8')
  const count = original.split(edit.find).length - 1
  if (count !== 1) {
    throw new Error(`${edit.file}: expected exactly one match for "${edit.why}", found ${count}`)
  }
  writeFileSync(path, original.replace(edit.find, edit.replace))
}

/** The brand edits, in the order they are applied. */
function edits(version) {
  const words = BRAND.splashWords
  const tagline = BRAND.tagline
  const plugin = BRAND.pluginName
  const product = BRAND.productName
  return [
    {
      file: 'lib/types/branding.js',
      why: 'splash words',
      find: "    deepseek: Object.freeze({ top: 'DEEPSEEK', bottom: 'HARNESS', plain: 'DeepSeek Harness' }),",
      replace: `    deepseek: Object.freeze({ top: ${q(words.top)}, bottom: ${q(words.bottom)}, plain: ${q(words.plain)} }),`,
    },
    {
      file: 'lib/types/branding.js',
      why: 'HyperAI accent + title gradient palette',
      find: `    codex: Object.freeze({ top: 'CODEX', bottom: 'HARNESS', plain: 'Codex' }),
});`,
      replace: `    codex: Object.freeze({ top: 'CODEX', bottom: 'HARNESS', plain: 'Codex' }),
});
/**
 * HyperAI palette for the patched default (\`dsh\` backend) look. The splash
 * title runs pink -> near-white on dark terminals; on light terminals it runs
 * deep pink -> light pink because a white tail would disappear against the
 * background. The wordmark and tagline reuse the mark's pink family so the
 * header does not mix a pink title with the theme's mist-blue accents.
 */
export const HYPERAI_PALETTE = Object.freeze({
    accent: Object.freeze({ r: 255, g: 96, b: 150 }),
    accentShimmer: Object.freeze({ r: 255, g: 214, b: 230 }),
    tagline: Object.freeze({ r: 255, g: 206, b: 224 }),
    titleDark: Object.freeze({
        base: Object.freeze({ r: 255, g: 96, b: 150 }),
        start: Object.freeze({ r: 255, g: 96, b: 150 }),
        mid: Object.freeze({ r: 255, g: 166, b: 196 }),
        end: Object.freeze({ r: 255, g: 247, b: 250 }),
        flash: Object.freeze({ r: 255, g: 255, b: 255 }),
    }),
    titleLight: Object.freeze({
        base: Object.freeze({ r: 214, g: 51, b: 108 }),
        start: Object.freeze({ r: 214, g: 51, b: 108 }),
        mid: Object.freeze({ r: 255, g: 102, b: 153 }),
        end: Object.freeze({ r: 255, g: 179, b: 204 }),
        flash: Object.freeze({ r: 255, g: 224, b: 236 }),
    }),
});`,
    },
    {
      file: 'lib/types/branding.js',
      why: 'welcome tagline',
      find: "    deepseek: Object.freeze({ zh: '', en: '' }),",
      replace: `    deepseek: Object.freeze({ zh: ${q(tagline.zh)}, en: ${q(tagline.en)} }),`,
    },
    {
      file: 'lib/types/branding.js',
      why: 'brand setting label',
      find: "    { value: 'deepseek', label: 'DeepSeek (mist blue)', descriptions: { zh: 'DeepSeek（雾蓝）' } },",
      replace: `    { value: 'deepseek', label: '${product} (default)', descriptions: { zh: '${product}（默认）' } },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'welcome tagline copy',
      find: "    'logo-tagline': { zh: '探索未至之境！', en: 'Explore the uncharted!' },",
      replace: `    'logo-tagline': { zh: ${q(tagline.zh)}, en: ${q(tagline.en)} },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'kernel label',
      find: "    'kernel-label-dsh': { zh: 'DeepSeek Harness', en: 'DeepSeek Harness' },",
      replace: `    'kernel-label-dsh': { zh: ${q(product)}, en: ${q(product)} },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'task-complete notification',
      find: "    'task-complete-notification': { zh: 'dsh-TUI · 任务已完成', en: 'dsh-TUI · Task complete' },",
      replace: `    'task-complete-notification': { zh: ${q(`${plugin} · 任务已完成`)}, en: ${q(`${plugin} · Task complete`)} },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'onboarding intro (zh)',
      find: "        zh: '第一次用 dsh-TUI？花一分钟跑一遍引导，把 API Key、语言、主题、模型一次配好。',",
      replace: `        zh: ${q(`第一次用 ${plugin}？花一分钟跑一遍引导，把 API Key、语言、主题、模型一次配好。`)},`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'onboarding intro (en)',
      find: "        en: 'New to dsh-TUI? One minute of setup wires up your API key, language, theme and model.',",
      replace: `        en: ${q(`New to ${plugin}? One minute of setup wires up your API key, language, theme and model.`)},`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'onboarding title',
      find: "    'onboarding-title': { zh: '欢迎使用 dsh-TUI', en: 'Welcome to dsh-TUI' },",
      replace: `    'onboarding-title': { zh: ${q(`欢迎使用 ${plugin}`)}, en: ${q(`Welcome to ${plugin}`)} },`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'HyperAI palette import',
      find: "import { BRAND_SPLASH_WORDS, BRAND_TAGLINE } from '../branding.js';",
      replace: "import { BRAND_SPLASH_WORDS, BRAND_TAGLINE, HYPERAI_PALETTE } from '../branding.js';",
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'wordmark uses the HyperAI accent family',
      find: '    const wordmarkRGB = parseRGB(theme.accent) ?? BRAND;\n    const wordmarkShimmerRGB = parseRGB(theme.accentShimmer) ?? ICE;\n    const taglineRGB = parseRGB(theme.activity) ?? ICE;',
      replace: `    // hyperai-tui: the patched default brand owns the accent family, so the
    // wordmark/tagline share the mark's pink instead of the theme's mist blue.
    const hyperaiLook = brand === 'deepseek';
    const wordmarkRGB = hyperaiLook ? HYPERAI_PALETTE.accent : parseRGB(theme.accent) ?? BRAND;
    const wordmarkShimmerRGB = hyperaiLook ? HYPERAI_PALETTE.accentShimmer : parseRGB(theme.accentShimmer) ?? ICE;
    const taglineRGB = hyperaiLook ? HYPERAI_PALETTE.tagline : parseRGB(theme.activity) ?? ICE;`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'title gradient runs pink -> near-white instead of the theme blue',
      find: "    const brandLadder = brand === 'claude'",
      replace: `    const brandLadder = brand === 'deepseek'
        ? (isLightThemeActive(themeName) ? HYPERAI_PALETTE.titleLight : HYPERAI_PALETTE.titleDark)
        : brand === 'claude'`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'splash wordmark',
      find: "sweep('✦ dsh-TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
      replace: `sweep('✦ ${plugin}', t, wordmarkRGB, wordmarkShimmerRGB, 60)`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'brand art import',
      find: "import { STANDARD_FRAME_INDEX, WhaleArt } from './Whale.js';",
      replace: "import { STANDARD_FRAME_INDEX, WhaleArt } from './Whale.js';\nimport { HyperAILogoArt } from './hyperaiLogo.js';",
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'splash art slot',
      find: "_jsx(WhaleArt, { frameIndex: frameIndex, pose: settled && whaleIdle && !whaleFrozen ? (idlePose ?? RESTING_POSE) : undefined, width: WHALE_BOX_WIDTH })",
      replace: '_jsx(HyperAILogoArt, { width: WHALE_BOX_WIDTH })',
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'mascot slot disabled (upstream mascots are DeepSeek-branded)',
      find: '    const mascotSkin = useSplashMascotSkin(companionSkin);',
      replace: '    const mascotSkin = undefined; // hyperai-tui: the brand mark replaces upstream mascots',
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'portrait slot disabled (upstream portraits are DeepSeek/Claude/Codex art)',
      find: "    const portraitMode = whaleGirl || brand !== 'deepseek';",
      replace: '    const portraitMode = false; // hyperai-tui: the brand mark replaces upstream portraits',
    },
    {
      file: 'lib/types/components/splashFonts.js',
      why: 'splash title words (the deepseek brand short-circuits to the font table)',
      find: `export function resolveSplashTitleFont(font, brand = 'deepseek', egg = null) {
    if (brand === 'deepseek' && egg === null)
        return font;
    const words = BRAND_SPLASH_WORDS[brand];
    return withTagline(font, brand === 'deepseek' ? font.tagline.top : words.top, egg?.bottom ?? words.bottom, brand === 'deepseek' ? undefined : { uniform: true });
}`,
      replace: `export function resolveSplashTitleFont(font, brand = 'deepseek', egg = null) {
    // hyperai-tui: every brand — including the dsh default — takes its splash
    // words from BRAND_SPLASH_WORDS instead of the font table's built-in
    // DEEPSEEK/HARNESS pair.
    const words = BRAND_SPLASH_WORDS[brand];
    return withTagline(font, words.top, egg?.bottom ?? words.bottom, { uniform: true });
}`,
    },
    {
      file: 'lib/types/components/splashArtRows.js',
      why: 'splash art form pinned to the mark',
      find: `export function resolveSplashArtForm(input) {
    const brand = input.brand ?? 'deepseek';
    if (brand === 'deepseek' && (input.mascotSkin === 'deepy' || input.mascotSkin === 'whaleGirl'))
        return 'mascot';
    if (input.whaleGirl || brand !== 'deepseek')
        return 'portrait';
    return 'whale';
}`,
      replace: `export function resolveSplashArtForm(input) {
    // hyperai-tui: the splash art slot always renders the HyperAI brand mark.
    return 'whale';
}`,
    },
    {
      file: 'lib/types/components/splashArtRows.js',
      why: 'splash mark height: wide 40x40 mark normally, compact 26x26 on small terminals',
      find: `export const WHALE_ART_ROWS = 13;`,
      replace: `import { HYPERAI_LOGO_WIDE_MIN_ROWS } from './hyperaiLogoRows.js';
export const WHALE_ART_ROWS = 13;
/** hyperai-tui: splash mark height for the wide 40x40 sprite (20 half-block rows). */
export const HYPERAI_ART_ROWS_WIDE = 20;
/** hyperai-tui: splash mark height for the compact 26x26 sprite (13 half-block rows). */
export const HYPERAI_ART_ROWS_COMPACT = 13;
/**
 * hyperai-tui: pick the splash mark height from the terminal height. Shared by
 * the logo component and the Launchpad layout budget so the two never disagree.
 * @param {number} rows - terminal content rows.
 * @returns 20 for >= HYPERAI_LOGO_WIDE_MIN_ROWS, otherwise 13.
 */
export function hyperaiArtRows(rows = process.stdout?.rows ?? 40) {
    return rows >= HYPERAI_LOGO_WIDE_MIN_ROWS ? HYPERAI_ART_ROWS_WIDE : HYPERAI_ART_ROWS_COMPACT;
}`,
    },
    {
      file: 'lib/types/components/splashArtRows.js',
      why: 'dynamic splash art height',
      find: `export function splashArtRows(form, imageBox) {
    if (form === 'whale')
        return WHALE_ART_ROWS;
    if (form === 'portrait')
        return PORTRAIT_ART_ROWS;
    return imageBox?.rows ?? MASCOT_ART_ROWS;
}`,
      replace: `export function splashArtRows(form, imageBox, rows) {
    if (form === 'whale')
        return hyperaiArtRows(rows);
    if (form === 'portrait')
        return PORTRAIT_ART_ROWS;
    return imageBox?.rows ?? MASCOT_ART_ROWS;
}`,
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'layout budget must use the same dynamic art height as the logo component',
      find: `    const artRows = splashArtRows(splashArtForm, mascotBox);`,
      replace: `    const artRows = splashArtRows(splashArtForm, mascotBox, rows);`,
    },
    {
      file: 'lib/types/utils/paths.js',
      why: 'TUI preference/history root is shared with the dsh-tui profile upstream',
      find: `/** Data directory all preferences/history live in (\`~/.dsh-tui\`). */
export const DATA_DIR = join(homeDir(), '.dsh-tui');`,
      replace: `/**
 * hyperai-tui: keep a second dsh profile from reading and writing the dsh-tui
 * profile's UI state. Upstream keeps every preference (model route, workspace,
 * history, onboarding) under one \`~/.dsh-tui\`; that would let a \`/model\` pick
 * in the hyperai profile overwrite the dsh-tui profile's persisted route. The
 * dsh-tui profile keeps the legacy path; any other profile gets its own
 * \`~/.dsh-tui-<profile>\` root.
 * @returns The directory name for the current profile's UI state.
 */
function dataDirName() {
    const argv = process.argv;
    let profile;
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--profile' && typeof argv[index + 1] === 'string')
            profile = argv[index + 1];
        else if (argv[index].startsWith('--profile='))
            profile = argv[index].slice('--profile='.length);
    }
    profile ??= process.env.DSH_TUI_PROFILE;
    return profile === undefined || profile === '' || profile === 'dsh-tui' ? '.dsh-tui' : \`.dsh-tui-\${profile}\`;
}
/** Data directory all preferences/history live in (\`~/.dsh-tui\`). */
export const DATA_DIR = join(homeDir(), dataDirName());`,
    },
    {
      file: 'lib/types/dsh-adapter/plugin.js',
      why: 'DeepSeek-branded first-run wizard gate',
      find: '    const onboardingOnBoot = dshBoot && noResume && shouldOfferOnboarding();',
      replace: '    const onboardingOnBoot = false; // hyperai-tui: upstream onboarding is DeepSeek-branded; the profile configures the provider from the environment',
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'launchpad version plate',
      find: '`dsh-tui v${tuiVersion}`',
      replace: '`hyperai-tui v${tuiVersion}`',
    },
    {
      file: 'lib/types/update.js',
      why: 'upstream updater would replace the branded package',
      find: `export async function resolveTuiUpdateTarget() {
    const current = installedTuiVersion();`,
      replace: `export async function resolveTuiUpdateTarget() {
    // hyperai-tui: the upstream updater replaces the branded package with the
    // unbranded one, so the hyperai profile installer owns version bumps.
    return { kind: 'unknown' };
    const current = installedTuiVersion();`,
    },
    {
      file: 'lib/types/components/splashEggs.js',
      why: 'star welcome line points at the HyperAI repository',
      find: "export const SPLASH_STAR_URL = 'https://github.com/ccch1mneyyy/dsh-TUI';",
      replace: "export const SPLASH_STAR_URL = 'https://github.com/hyperai/hyperai-harness';",
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star welcome line names the HyperAI TUI',
      find: "    'logo-star-ask': { zh: '喜欢 dshTUI 的话，顺手点亮一颗 {{star}}？（点这一行或 {{key}} 一键支持）', en: 'If you like dsh-TUI, would you light a {{star}}? (click this line or {{key}})' },",
      replace: `    'logo-star-ask': { zh: ${q(`喜欢 ${plugin} 的话，顺手点亮一颗 {{star}}？（点这一行或 {{key}} 一键支持`)}, en: ${q(`If you like ${plugin}, would you light a {{star}}? (click this line or {{key}})`) } },`,
    },
  ]
}

/** Files the patch is expected to touch, used as a build self-check. */
const EXPECTED_FILES = [
  'lib/types/branding.js',
  'lib/types/i18n.js',
  'lib/types/components/LogoV2.js',
  'lib/types/components/splashArtRows.js',
  'lib/types/components/splashFonts.js',
  'lib/types/dsh-adapter/plugin.js',
  'lib/types/utils/paths.js',
  'lib/types/screens/Launchpad.js',
  'lib/types/update.js',
  'lib/types/components/splashEggs.js',
  'lib/types/components/hyperaiLogo.js',
  'lib/types/components/hyperaiLogoRows.js',
]

/** Files added from the repository overlay / generated brand output. */
function addFiles(root) {
  cpSync(join(PKG, 'overlay', 'components', 'hyperaiLogo.js'), join(root, 'lib/types/components/hyperaiLogo.js'))
  cpSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), join(root, 'lib/types/components/hyperaiLogoRows.js'))
}

/** Build the patch text from the pinned upstream package. */
export function buildPatch({ from, version = BRAND.upstream.version } = {}) {
  const { dir, work } = acquireSource(from, version)
  try {
    const git = initRepo(dir)
    for (const edit of edits(version)) replaceOne(dir, edit)
    addFiles(dir)
    git('add', '-A')
    const patch = git('diff', '--cached', '--binary', '--no-color')
    const changed = [...patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map(match => match[1])
    assertExpectedFiles(changed)
    verifyPatch(patch, from, version)
    return { patch, changed, version }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** The patch must not touch upstream files beyond the documented branding edits. */
function assertExpectedFiles(changed) {
  const unexpected = changed.filter(file => !EXPECTED_FILES.includes(file))
  const missing = EXPECTED_FILES.filter(file => !changed.includes(file))
  if (unexpected.length > 0) throw new Error(`patch touches unexpected files: ${unexpected.join(', ')}`)
  if (missing.length > 0) throw new Error(`patch is missing expected files: ${missing.join(', ')}`)
}

/** Apply the generated patch to a fresh copy and compare it with the edited tree. */
function verifyPatch(patch, from, version) {
  const sandbox = mkdtempSync(join(tmpdir(), 'hyperai-tui-verify-'))
  try {
    const pristine = join(sandbox, 'pristine')
    const source = acquireSource(from, version)
    cpSync(source.dir, pristine, { recursive: true })
    rmSync(source.work, { recursive: true, force: true })
    const patchFile = join(sandbox, 'brand.patch')
    writeFileSync(patchFile, `${patch}\n`)
    const git = initRepo(pristine)
    git('apply', '--check', patchFile)
    git('apply', patchFile)
    const applied = readFileSync(join(pristine, 'lib/types/branding.js'), 'utf8')
    if (!applied.includes(BRAND.splashWords.top)) throw new Error('patch apply smoke test failed: splash words missing')
    if (!applied.includes(BRAND.splashWords.bottom)) throw new Error('patch apply smoke test failed: splash words missing')
    const logo = readFileSync(join(pristine, 'lib/types/components/hyperaiLogoRows.js'), 'utf8')
    if (!logo.includes('export const HYPERAI_LOGO_SPRITE_WIDE =')) throw new Error('patch apply smoke test failed: wide logo sprite missing')
    if (!logo.includes('export const HYPERAI_LOGO_SPRITE_COMPACT =')) throw new Error('patch apply smoke test failed: compact logo sprite missing')
    if (!logo.includes('export const HYPERAI_LOGO_PALETTE =')) throw new Error('patch apply smoke test failed: logo palette missing')
    if (!logo.includes('export const HYPERAI_LOGO_WIDE_MIN_ROWS =')) throw new Error('patch apply smoke test failed: logo width threshold missing')
    const component = readFileSync(join(pristine, 'lib/types/components/hyperaiLogo.js'), 'utf8')
    if (!component.includes("from './Whale.js'")) throw new Error('patch apply smoke test failed: component does not reuse the whale renderer')
    if (!component.includes('renderSpriteRows')) throw new Error('patch apply smoke test failed: whale renderer not used')
    if (!component.includes('useTerminalSize')) throw new Error('patch apply smoke test failed: component does not read terminal height')
    const artRows = readFileSync(join(pristine, 'lib/types/components/splashArtRows.js'), 'utf8')
    if (!artRows.includes('hyperaiArtRows')) throw new Error('patch apply smoke test failed: dynamic splash art height missing')
    const launchpad = readFileSync(join(pristine, 'lib/types/screens/Launchpad.js'), 'utf8')
    if (!launchpad.includes('splashArtRows(splashArtForm, mascotBox, rows)')) throw new Error('patch apply smoke test failed: Launchpad layout budget not updated')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const args = { from: undefined, version: BRAND.upstream.version }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--version') args.version = argv[++index]
    else if (arg === '--from') args.from = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node scripts/build-patch.mjs [--version <upstream-version>] [--from <pristine-package-dir>]\n')
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return args
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'))) {
    throw new Error('brand/generated/hyperai-logo.js is missing; run scripts/generate-logo-art.mjs first')
  }
  const args = parseArgs(process.argv.slice(2))
  const { patch, changed, version } = buildPatch(args)
  const out = join(PKG, 'patches', `dsh-tui@${version}.patch`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${patch}\n`)
  process.stdout.write(`hyperai-tui: wrote ${out}\n`)
  for (const file of changed) process.stdout.write(`  ${file}\n`)
}
