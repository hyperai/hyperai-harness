#!/usr/bin/env node
/**
 * Build the pnpm patch that turns the upstream `@deepseek-harness-tui/dsh-tui`
 * package into the HyperAI-branded TUI used by the `hyperai` profile.
 *
 * The patch is the whole branding implementation: upstream UI logic — chat,
 * streaming, tool cards, approvals, sessions, model pickers, shortcuts and all
 * image handling — is untouched. Only brand data (splash words, tagline,
 * wordmark, product labels, the single brand title colour), the DeepSeek-branded
 * first-run wizard gate, the default brand labels and the startup splash art are
 * changed. The splash renders no art at all: no logo, PNG, ANSI sprite, whale or
 * mascot — only the HYPERAI HARNESS pixel wordmark.
 *
 * Every replacement is an exact-match edit: a mismatch means the pinned upstream
 * version drifted and the build fails instead of producing a silently
 * half-branded patch.
 *
 * Usage:
 *   node scripts/build-patch.mjs [--version 0.16.1] [--from <pristine-pkg-dir>]
 *
 * Output: patches/dsh-tui@<version>.patch. The profile installer in
 * `apps/profiles/hyperai` copies that patch into the managed profile's
 * `patches/` directory, where `pnpm-workspace.yaml` applies it.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const BRAND = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
const TUI_PACKAGE = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
/** The one product brand colour; both the splash title and the wordmark use it. */
const TITLE = parseHexColor(BRAND.titleColor)

const q = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const rgb = color => `Object.freeze({ r: ${color.r}, g: ${color.g}, b: ${color.b} })`

/**
 * Parse a `#rrggbb` brand colour.
 * @param {string} hex - Colour literal from the brand data.
 * @returns {{r:number,g:number,b:number}} RGB channels.
 */
function parseHexColor(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex)
  if (match === null) throw new Error(`brand titleColor must be #rrggbb, got ${JSON.stringify(hex)}`)
  return { r: Number.parseInt(match[1], 16), g: Number.parseInt(match[2], 16), b: Number.parseInt(match[3], 16) }
}

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
    cpSync(source, work, { recursive: true, filter: path => !path.split(/[\\/]/u).includes('.git') })
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
    throw new Error(`expected ${BRAND.upstream.package}@${version}, got ${manifest.name}@${manifest.version}`)
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
function edits() {
  const words = BRAND.splashWords
  const tagline = BRAND.tagline
  const plugin = BRAND.pluginName
  const product = BRAND.productName
  const title = rgb(TITLE)
  const titleHex = BRAND.titleColor.replace('#', '').toUpperCase()
  return [
    {
      file: 'lib/types/branding.js',
      why: 'splash words',
      find: "    deepseek: Object.freeze({ top: 'DEEPSEEK', bottom: 'HARNESS', plain: 'DeepSeek Harness' }),",
      replace: `    deepseek: Object.freeze({ top: ${q(words.top)}, bottom: ${q(words.bottom)}, plain: ${q(words.plain)} }),`,
    },
    {
      file: 'lib/types/branding.js',
      why: 'HyperAI brand palette (one solid title colour)',
      find: `    codex: Object.freeze({ top: 'CODEX', bottom: 'HARNESS', plain: 'Codex' }),
});`,
      replace: `    codex: Object.freeze({ top: 'CODEX', bottom: 'HARNESS', plain: 'Codex' }),
});
/**
 * HyperAI palette for the patched default (\`dsh\` backend) look.
 *
 * The product brand colour is one value, \`#${titleHex}\`. The splash title, the
 * wordmark and the welcome tagline all use it unchanged, so light and dark
 * terminals show the same brand pink instead of deriving theme gradients (the
 * earlier pink -> near-white ladder read as an unintended purple/pink ramp on
 * light themes). No other brand accent is introduced here.
 */
export const HYPERAI_PALETTE = Object.freeze({
    accent: ${title},
    accentShimmer: ${title},
    tagline: ${title},
    title: Object.freeze({
        base: ${title},
        start: ${title},
        mid: ${title},
        end: ${title},
        flash: ${title},
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
      file: 'lib/types/i18n.js',
      why: 'star easter egg no longer references the whale girl',
      find: "    'logo-star-title': { zh: '鲸鱼娘好像在等一颗小星星…… ☆', en: 'The whale girl seems to be waiting for a little star… ☆' },\n    'logo-star-caught': { zh: '鲸鱼娘捡到一颗小星星啦 ✨', en: 'The whale girl caught a little star ✨' },",
      replace: `    'logo-star-title': { zh: 'HyperAI Harness 好像在等一颗小星星…… ☆', en: 'HyperAI Harness seems to be waiting for a little star… ☆' },
    'logo-star-caught': { zh: 'HyperAI Harness 捡到一颗小星星啦 ✨', en: 'HyperAI Harness caught a little star ✨' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star copy names the HyperAI product instead of dshTUI/whale girl',
      find: `    'star-modal-body-1': { zh: '不知不觉，dshTUI 已经陪你走了这么久啦。', en: 'Before you noticed, dsh-TUI had already come this far with you.' },`,
      replace: `    'star-modal-body-1': { zh: '不知不觉，HyperAI Harness 已经陪你走了这么久啦。', en: 'Before you noticed, HyperAI Harness had already come this far with you.' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star modal asks for a star for the HyperAI product',
      find: `    'star-modal-body-4': { zh: '那就送鲸鱼娘一颗小小的 Star 吧 ⭐', en: 'treat the whale girl to a tiny Star ⭐' },`,
      replace: `    'star-modal-body-4': { zh: '那就送 HyperAI Harness 一颗小小的 Star 吧 ⭐', en: 'treat HyperAI Harness to a tiny Star ⭐' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star modal names the HyperAI product',
      find: `    'star-modal-body-6': { zh: '和把 dshTUI 做得更好的动力！', en: 'and to keep making dsh-TUI better!' },`,
      replace: `    'star-modal-body-6': { zh: '和把 HyperAI Harness 做得更好的动力！', en: 'and to keep making HyperAI Harness better!' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star thank-you copy drops the whale girl',
      find: `    'star-modal-thanks-1': { zh: '鲸鱼娘成功接住了一颗小星星 ~', en: 'The whale girl caught a little star ~' },`,
      replace: `    'star-modal-thanks-1': { zh: 'HyperAI Harness 成功接住了一颗小星星 ~', en: 'HyperAI Harness caught a little star ~' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'star thank-you copy names the HyperAI product',
      find: `    'star-modal-thanks-3': { zh: '这颗 Star 会变成 dshTUI 继续成长的动力。', en: 'This Star becomes fuel for dsh-TUI to keep growing.' },`,
      replace: `    'star-modal-thanks-3': { zh: '这颗 Star 会变成 HyperAI Harness 继续成长的动力。', en: 'This Star becomes fuel for HyperAI Harness to keep growing.' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'onboarding connection copy uses the HyperAI name',
      find: "    'onboarding-conn-running': { zh: '正在连接 DeepSeek…', en: 'Connecting to DeepSeek…' },",
      replace: `    'onboarding-conn-running': { zh: '正在连接 HyperAI…', en: 'Connecting to HyperAI…' },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'settings help names the HyperAI assistant',
      find: "    'thinking-enabled-desc': { zh: '在对话中显示 DeepSeek 的思考过程', en: \"Show DeepSeek's reasoning in the conversation\" },",
      replace: `    'thinking-enabled-desc': { zh: '在对话中显示 HyperAI 的思考过程', en: "Show HyperAI's reasoning in the conversation" },`,
    },
    {
      file: 'lib/types/i18n.js',
      why: 'interrupted-turn help names the HyperAI assistant',
      find: "    'interrupted-ask-next': { zh: '· 接下来想让 DeepSeek 做什么？', en: '· What should DeepSeek do instead?' },",
      replace: `    'interrupted-ask-next': { zh: '· 接下来想让 HyperAI 做什么？', en: '· What should HyperAI do instead?' },`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'HyperAI palette import',
      find: "import { BRAND_SPLASH_WORDS, BRAND_TAGLINE } from '../branding.js';",
      replace: "import { BRAND_SPLASH_WORDS, BRAND_TAGLINE, HYPERAI_PALETTE } from '../branding.js';",
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'wordmark uses the HyperAI brand pink',
      find: '    const wordmarkRGB = parseRGB(theme.accent) ?? BRAND;\n    const wordmarkShimmerRGB = parseRGB(theme.accentShimmer) ?? ICE;\n    const taglineRGB = parseRGB(theme.activity) ?? ICE;',
      replace: `    // hyperai-tui: the patched default brand owns the accent family, so the
    // wordmark/tagline use the product brand colour instead of the theme accent.
    const hyperaiLook = brand === 'deepseek';
    const wordmarkRGB = hyperaiLook ? HYPERAI_PALETTE.accent : parseRGB(theme.accent) ?? BRAND;
    const wordmarkShimmerRGB = hyperaiLook ? HYPERAI_PALETTE.accentShimmer : parseRGB(theme.accentShimmer) ?? ICE;
    const taglineRGB = hyperaiLook ? HYPERAI_PALETTE.tagline : parseRGB(theme.activity) ?? ICE;`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'title resolves to the one solid brand colour (font palettes/bevel shades cannot override it)',
      find: `    const titleFrom = titleFont.palette?.from
        ?? bevelShade?.from
        ?? brandLadder?.start
        ?? wordmarkRGB;
    const titleTopTo = titleFont.palette?.to
        ?? bevelShade?.to
        ?? brandLadder?.mid
        ?? taglineRGB;
    const titleBottomFrom = titleFont.palette?.from
        ?? bevelShade?.from
        ?? brandLadder?.mid
        ?? taglineRGB;
    const titleBottomTo = titleFont.palette?.to
        ?? bevelShade?.to
        ?? brandLadder?.end
        ?? PALE;`,
      replace: `    // hyperai-tui: the brand title is one solid colour. Font palettes and the
    // bevel font's derived shading must not turn it into a gradient in another
    // brand hue, so the deepseek default bypasses every other colour source.
    const titleFrom = hyperaiLook ? HYPERAI_PALETTE.title.base : titleFont.palette?.from
        ?? bevelShade?.from
        ?? brandLadder?.start
        ?? wordmarkRGB;
    const titleTopTo = hyperaiLook ? HYPERAI_PALETTE.title.base : titleFont.palette?.to
        ?? bevelShade?.to
        ?? brandLadder?.mid
        ?? taglineRGB;
    const titleBottomFrom = hyperaiLook ? HYPERAI_PALETTE.title.base : titleFont.palette?.from
        ?? bevelShade?.from
        ?? brandLadder?.mid
        ?? taglineRGB;
    const titleBottomTo = hyperaiLook ? HYPERAI_PALETTE.title.base : titleFont.palette?.to
        ?? bevelShade?.to
        ?? brandLadder?.end
        ?? PALE;`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'title uses the one solid brand colour on every theme',
      find: "    const brandLadder = brand === 'claude'",
      replace: `    const brandLadder = brand === 'deepseek'
        ? HYPERAI_PALETTE.title
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
      why: 'splash renders no art (row arrangement)',
      find: '    const splash = resolveSplashLayout(columns, { whale, font: titleFont });',
      replace: `    // hyperai-tui: the splash is the pixel wordmark only — no logo, whale,
    // mascot or image placeholder is rendered in any arrangement.
    const splash = resolveSplashLayout(columns, { whale: false, font: titleFont });`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'splash renders no art (column arrangement)',
      find: `        ? {
            showWhale: whale && columns >= WHALE_BOX_WIDTH,`,
      replace: `        ? {
            showWhale: false,`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'center the two brand words as a pyramid on launchpad widths',
      find: '    const uniformBrand = brand !== \'deepseek\';',
      replace: `    // hyperai-tui: HYPERAI and HARNESS have different ink widths in the pixel
    // fonts, so center the narrower word under the wider one (launchpad only;
    // the chat header keeps left alignment).
    const uniformBrand = true;`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'plain narrow-terminal title stays brand pink',
      find: '(_jsx(Text, { color: "accent", bold: true, wrap: "truncate-end", children: words.plain }))',
      replace: `(_jsx(Text, { bold: true, wrap: "truncate-end", children: sweep(words.plain, t, HYPERAI_PALETTE.accent, HYPERAI_PALETTE.accent, 60) }))`,
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
      file: 'lib/types/components/launchpadLayout.js',
      why: 'launchpad hero budget reserves no art rows',
      find: '    const wantsArt = options.whale || options.whaleGirl === true;',
      replace: `    // hyperai-tui: the splash never renders art, so the launchpad budget must
    // not reserve rows for it (the wordmark is the whole hero).
    const wantsArt = false;`,
    },
    {
      file: 'lib/types/utils/paths.js',
      why: 'TUI preference/history root is shared with the dsh-tui profile upstream',
      find: `/** Data directory all preferences/history live in (\`~/.dsh-tui\`). */
export const DATA_DIR = join(homeDir(), '.dsh-tui');`,
      replace: `/**
 * hyperai-tui: all UI state lives inside HyperAI's own directory, never in
 * ~/.dsh-tui* (which belongs to DeepSeek Harness). HYPERAI_TUI_DIR is set by
 * the generated launcher; the fallback keeps direct runs isolated too.
 */
export const DATA_DIR = process.env.HYPERAI_TUI_DIR || join(homeDir(), '.hyperai', 'tui');`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'pin the HyperAI splash to the upstream solid base font',
      find: "    const [dailyFont] = React.useState(() => pickSplashFont());",
      replace: `    // hyperai-tui: the upstream daily rotation can select stencil/classic/dot
    // fonts (interior cutouts look hollow). The brand keeps the base solid
    // pixel font; an explicit \`/settings\` font choice still wins below.
    const [dailyFont] = React.useState(() => brand === 'deepseek' ? splashFontById('bold') : pickSplashFont());`,
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'pin the HyperAI launchpad splash to the upstream solid base font',
      find: "    const [dailyFont] = React.useState(() => pickSplashFont());",
      replace: `    // hyperai-tui: mirror LogoV2 — the launchpad must not land on a hollow
    // daily font (stencil/classic) for the brand.
    const [dailyFont] = React.useState(() => brand === 'deepseek' ? splashFontById('bold') : pickSplashFont());`,
    },
    {
      file: 'lib/types/dsh-adapter/plugin.js',
      why: 'DeepSeek-branded first-run wizard gate',
      find: '    const onboardingOnBoot = dshBoot && noResume && shouldOfferOnboarding();',
      replace: '    const onboardingOnBoot = false; // hyperai-tui: upstream onboarding is DeepSeek-branded; the profile leaves provider/model setup to native /provider and /model',
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'launchpad version plate',
      find: '`dsh-tui v${tuiVersion}`',
      replace: '`hyperai-tui v${tuiVersion}`',
    },
    {
      file: 'lib/types/update.js',
      why: 'self-version reads report the upstream dsh-tui version, not the HyperAI release',
      find: `                if (packageJson.name === PACKAGE_NAME && typeof version === 'string' && valid(version) !== null) {
                    return version;
                }`,
      replace: `                // hyperai-tui: package.json.version is the HyperAI release
                // (0.2.0-beta.2.1); the dsh-tui version is recorded in
                // hyperai.upstreamVersion. Every caller of this function means
                // the upstream TUI package — the dsh-tui half of the version
                // plate, the version-drift warning and /update target checks —
                // so it must keep returning the upstream version.
                const upstream = packageJson.hyperai?.upstreamVersion;
                if (packageJson.name === PACKAGE_NAME && typeof upstream === 'string' && valid(upstream) !== null) {
                    return upstream;
                }
                if (packageJson.name === PACKAGE_NAME && typeof version === 'string' && valid(version) !== null) {
                    return version;
                }`,
    },
    {
      file: 'lib/types/update.js',
      why: 'disable the upstream TUI version check before it can contact npm/GitHub',
      find: `export async function checkForTuiUpdate() {
    // Callers start this during the first render; the first \`fetch()\` loads
    // undici synchronously, so yield first and let that cost land after the frame.
    await new Promise(resolve => setImmediate(resolve));`,
      replace: `export async function checkForTuiUpdate() {
    // hyperai-tui: the branded package is versioned by the HyperAI profile
    // installer. Never contact npm/GitHub for an upstream self-update; both the
    // chat launchpad and the adapter's background notice call this function.
    return undefined;
    // Callers start this during the first render; the first \`fetch()\` loads
    // undici synchronously, so yield first and let that cost land after the frame.
    await new Promise(resolve => setImmediate(resolve));`,
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
    {
      file: 'lib/types/tips.js',
      why: 'remove whale intro tips that describe disabled HyperAI art',
      find: `    {
        id: 'disp-whale',
        group: 'display',
        zh: '首屏鲸鱼动画（终端 ≥64 列才显示）',
        en: 'The whale intro shows on terminals ≥64 columns',
    },
    {
        id: 'disp-context-legend',`,
      replace: `    {
        id: 'disp-context-legend',`,
    },
    {
      file: 'lib/types/tips.js',
      why: 'remove whale click/idle tips that describe disabled HyperAI art',
      find: `    {
        id: 'disp-whale-click',
        group: 'display',
        zh: '开始第一个任务前点鲸鱼冒爱心、唤醒睡着的它；闲置动作可在 /settings 关',
        en: 'Before your first task, click the whale for hearts and to wake it; idle moves toggle in /settings',
    },
    {
        id: 'disp-smooth',`,
      replace: `    {
        id: 'disp-smooth',`,
    },
    {
      file: 'lib/types/components/LogoV2.js',
      why: 'chat header version must be the HyperAI product version, not the upstream TUI version',
      find: "sweep('✦ hyperai-tui', t, wordmarkRGB, wordmarkShimmerRGB, 60), _jsx(Text, { dimColor: true, children: '  v' + VERSION })",
      replace: `sweep('✦ hyperai-tui', t, wordmarkRGB, wordmarkShimmerRGB, 60), _jsx(Text, { dimColor: true, children: '  v${TUI_PACKAGE.version}' })`,
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'settings copy must not present upstream mascot/brand controls as active HyperAI features',
      find: `    'brand': {
        label: 'Brand look',
        descriptions: { zh: '品牌外观' },
        group: 'splash',
        hint: 'Brand look of the splash and theme. Follow backend (default) switches with the active kernel — Claude boots orange (CLAUDE CODE title, Claude girl), Codex boots lavender (CODEX title, "Build anything with Codex"); the other values pin one look. Applies immediately.',
        hintDescriptions: { zh: '开屏与主题的品牌外观。跟随后端（默认）随当前内核自动切——Claude 后端整套换橙（CLAUDE CODE 大标题、Claude 娘立绘），Codex 后端整套换薰衣草紫（CODEX 大标题、"Build anything with Codex" 标语）；选固定档则锁定一种外观。立即生效。' },`,
      replace: `    'brand': {
        label: 'HyperAI look (upstream compatibility)',
        descriptions: { zh: 'HyperAI 外观（上游兼容）' },
        group: 'splash',
        hint: 'HyperAI uses the fixed HyperAI Harness palette and text-only wordmark. This upstream brand selector is retained only for compatibility; it does not reintroduce the upstream logo or mascot.',
        hintDescriptions: { zh: 'HyperAI 固定使用 HyperAI Harness 品牌色和纯文字字标。此项仅为上游兼容保留，不会重新引入上游 Logo 或吉祥物。' },`,
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'settings copy must not present upstream mascot/brand controls as active HyperAI features',
      find: "        label: 'Header art',\n        descriptions: { zh: '标题图形 logo' },\n        group: 'splash',\n        hint: 'Header art. DeepSeek follows Companion skin and the maid toggle; Claude uses its own art; Codex uses its own raster portrait or maid character-art fallback. Off leaves a text-only header.',\n        hintDescriptions: { zh: '标题图形：DeepSeek 品牌随宠物皮肤与女仆娘开关，Claude 使用自己的图案；Codex 优先显示自己的真图，不可用时回落女仆娘字符画。关闭则只留文字标题。' },",
      replace: `        label: 'Header art (not used by HyperAI)',
        descriptions: { zh: '标题图形（HyperAI 不使用）' },
        group: 'splash',
        hint: 'HyperAI renders a text-only pixel wordmark; upstream header art is disabled by the profile patch. This setting is retained only for upstream compatibility.',
        hintDescriptions: { zh: 'HyperAI 只渲染文字像素字标；上游标题图形已由 Profile patch 关闭。此设置仅为上游兼容保留。' },`,
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'settings copy must not present upstream mascot controls as active HyperAI features',
      find: "        label: 'Maid portrait',\n        descriptions: { zh: '女仆娘立绘' },\n        group: 'splash',",
      replace: `        label: 'Maid portrait (not used by HyperAI)',
        descriptions: { zh: '女仆娘立绘（HyperAI 不使用）' },
        group: 'splash',`,
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'settings copy must not present upstream mascot controls as active HyperAI features',
      find: "        label: 'Welcome whale idle',\n        descriptions: { zh: '鲸鱼娘闲置动画（欢迎期）' },\n        group: 'splash',",
      replace: `        label: 'Welcome animation (not used by HyperAI)',
        descriptions: { zh: '欢迎动画（HyperAI 不使用）' },
        group: 'splash',`,
    },
    {
      file: 'lib/types/components/splashFonts.js',
      why: 'default splash-font option must visibly say HyperAI pins the solid face',
      find: "    { value: SPLASH_FONT_DAILY, label: 'Daily rotation (default)', descriptions: { zh: '按天轮换（默认）' } },",
      replace: "    { value: SPLASH_FONT_DAILY, label: 'HyperAI fixed solid (upstream compatibility)', descriptions: { zh: 'HyperAI 固定实心字标（上游兼容）' } },",
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'splash font label/description must say HyperAI pins the solid face',
      find: "        label: 'Splash font',\n        descriptions: { zh: '开屏大字字体' },",
      replace: `        label: 'Splash font (HyperAI fixed solid)',
        descriptions: { zh: '开屏大字字体（HyperAI 固定实心；上游兼容）' },`,
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'splash font hint must not imply HyperAI rotates the face',
      find: "        hintDescriptions: { zh: '开屏头部的大字字面。按天轮换（默认）随本地日期换款；选某一款即固定那一款。立即生效。' },",
      replace: "        hintDescriptions: { zh: 'HyperAI 固定使用实心上游字标；按天轮换已禁用。此下拉仅为上游兼容保留，选择不会改变 HyperAI 的开屏品牌字标。' },",
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'companion skin must be marked as not used by HyperAI',
      find: "        label: 'Companion skin',\n        descriptions: { zh: '宠物皮肤' },",
      replace: `        label: 'Companion skin (not used by HyperAI)',
        descriptions: { zh: '宠物皮肤（HyperAI 不使用）' },`,
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'terminal title should identify the product, not an upstream glyph',
      find: "    useTerminalTitle(`${titlePrefix} 🐋 ${channel.sessionTitle}`);",
      replace: "    useTerminalTitle(`HyperAI Harness · ${channel.sessionTitle}${channel.working ? ' · working' : ''}`);",
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'splash font setting must explain the HyperAI solid-font pin',
      find: "        hint: 'Big-text face on the header splash. Daily rotates by local date (default); pick a face to pin that one. Applies immediately.',",
      replace: "        hint: 'Upstream splash font setting. HyperAI always starts from the solid bold face (daily hollow rotation is bypassed); an explicit face remains available for upstream compatibility.',",
    },
    {
      file: 'lib/types/settings/definitions.js',
      why: 'splash group must not advertise a mascot',
      find: "    { id: 'splash', mode: 'inline', title: 'Splash', descriptions: { zh: '开屏与吉祥物' } },",
      replace: "    { id: 'splash', mode: 'inline', title: 'Splash / 开屏', descriptions: { zh: '开屏与字标' } },",
    },
    {
      file: 'lib/types/commands.js',
      why: 'HyperAI Skills update command',
      find: "    { name: 'skills', description: 'List available skills' },",
      replace: `    { name: 'skills', description: 'List available skills' },
    { name: 'skills-update', description: 'Check for HyperAI Skills updates and install them' },`,
    },
    {
      file: 'lib/types/commands.js',
      why: 'the upstream /update entry must not replace the branded package',
      find: "    { name: 'update', description: 'Update dsh-tui and restart' },",
      replace: "    { name: 'update', description: 'HyperAI: quit and run hyperai update to upgrade' },",
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'the upstream /update route is disabled for the branded package',
      find: `            case 'update':
                setHelpOpen(false);
                if (onUpdate === undefined) {
                    channel.notify(t('update-unavailable'), { color: 'warning' });
                }
                else if (channel.working) {
                    channel.notify(t(WORKING_GATE_NOTICES.update), { color: 'warning' });
                }
                else {
                    channel.notify(t('update-starting'));
                    onUpdate();
                }
                return true;`,
      replace: `            case 'update':
                setHelpOpen(false);
                channel.pushLocal('/update', [
                    getLang() === 'zh'
                        ? 'HyperAI Harness 不通过 /update 升级；请使用 HyperAI Profile 安装器/发布流程。'
                        : 'HyperAI Harness does not upgrade through /update; use the HyperAI profile installer/release flow.',
                ]);
                return true;`,
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'narrow footer: give the workspace label a shrink budget and keep the version plate readable',
      find: "children: cornerLeft })), _jsx(Text, { dimColor: true, wrap: \"truncate-middle\", children: tuiPart ?? '' })",
      replace: "children: cornerLeft })), _jsx(Text, { dimColor: true, wrap: \"truncate-middle\", flexShrink: 0, children: tuiPart ?? '' })",
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'narrow footer: stack workspace/version rows instead of colliding them',
      find: "_jsxs(Box, { flexShrink: 0, flexDirection: \"row\", justifyContent: \"space-between\", height: 1, children: [",
      replace: "_jsxs(Box, { flexShrink: 0, flexDirection: columns < 110 ? \"column\" : \"row\", justifyContent: columns < 110 ? \"flex-start\" : \"space-between\", height: columns < 110 ? 2 : 1, children: [",
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'narrow footer: reserve a second row in the layout budget',
      find: "        cornerRows: 1 + kernelRows.length,",
      replace: "        cornerRows: (columns < 110 ? 2 : 1) + kernelRows.length,",
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'narrow footer: let the workspace label shrink so the version plate stays readable',
      find: "(_jsx(Text, { dimColor: true, wrap: \"truncate-middle\", children: cornerLeft }))",
      replace: "(_jsx(Text, { dimColor: true, wrap: \"truncate-middle\", flexShrink: 1, minWidth: 0, children: cornerLeft }))",
    },
    {
      file: 'lib/types/screens/Launchpad.js',
      why: 'version plate distinguishes the HyperAI product from the pinned upstream TUI',
      find: "    const tuiPart = tuiVersion === undefined || tuiVersion === '' ? undefined : `hyperai-tui v${tuiVersion}`;",
      replace: `    // Keep the product version readable in narrow terminals; the full
    // product+upstream pair is used only when there is room for it.
    const tuiPart = tuiVersion === undefined || tuiVersion === ''
        ? undefined
        : (columns < 72 ? \`hyperai v${TUI_PACKAGE.version}\` : \`hyperai-tui v${TUI_PACKAGE.version} · dsh-tui v\${tuiVersion}\`);`,
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'import the HyperAI skills updater UI bridge',
      find: "import { WORKING_GATE_NOTICES } from '../commands.js';",
      replace: `import { WORKING_GATE_NOTICES } from '../commands.js';
import { useSkillsUpdate } from '../hyperaiSkills.js';`,
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'mount the HyperAI skills updater hook',
      find: "    const dialogSnapshot = React.useSyncExternalStore(listener => dialogs.subscribe(listener), () => dialogs.getSnapshot());",
      replace: `    const dialogSnapshot = React.useSyncExternalStore(listener => dialogs.subscribe(listener), () => dialogs.getSnapshot());
    // hyperai-tui: asynchronous HyperAI Skills update hint + explicit install flow.
    const skillsUpdate = useSkillsUpdate({ channel, dialogs });`,
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'render the non-blocking HyperAI Skills update hint',
      find: "statusEntries.length > 0 && (_jsx(Text, { dimColor: true, wrap: \"truncate\", children: statusEntries.map(entry => entry.text).join(' · ') })),",
      replace: `statusEntries.length > 0 && (_jsx(Text, { dimColor: true, wrap: \"truncate\", children: statusEntries.map(entry => entry.text).join(' · ') })),
                                    skillsUpdate.notice !== null && (_jsx(Box, { onClick: () => { void skillsUpdate.open(); }, children: _jsx(Text, { color: \"warning\", wrap: \"truncate\", children: skillsUpdate.notice }) })),`,
    },
    {
      file: 'lib/types/screens/Chat.js',
      why: 'dispatch /skills-update',
      find: "            case 'skills': {",
      replace: `            case 'skills-update': {
                setHelpOpen(false);
                setLaunchpadOpen(false);
                void skillsUpdate.open();
                return true;
            }
            case 'skills': {`,
    },
  ]
}

/** New HyperAI TUI files added to the patched package. */
const EXTRA_FILES = [
  ['hyperaiSkillsCore.js', 'lib/types/hyperaiSkillsCore.js'],
  ['hyperaiSkills.js', 'lib/types/hyperaiSkills.js'],
  ['hyperaiUpdate.js', 'lib/types/hyperaiUpdate.js'],
]

/** Copy the HyperAI-owned UI modules into the patched package source. */
function addExtraFiles(dir) {
  for (const [source, target] of EXTRA_FILES) {
    writeFileSync(join(dir, target), readFileSync(join(PKG, 'src', source), 'utf8'))
  }
}

/** Files the patch is expected to touch, used as a build self-check. */
const EXPECTED_FILES = [
  'lib/types/branding.js',
  'lib/types/i18n.js',
  'lib/types/components/LogoV2.js',
  'lib/types/components/splashFonts.js',
  'lib/types/components/launchpadLayout.js',
  'lib/types/dsh-adapter/plugin.js',
  'lib/types/utils/paths.js',
  'lib/types/screens/Launchpad.js',
  'lib/types/update.js',
  'lib/types/components/splashEggs.js',
  'lib/types/tips.js',
  'lib/types/commands.js',
  'lib/types/settings/definitions.js',
  'lib/types/screens/Chat.js',
  'lib/types/hyperaiSkills.js',
  'lib/types/hyperaiSkillsCore.js',
  'lib/types/hyperaiUpdate.js',
]

/** Build the patch text from the pinned upstream package. */
export function buildPatch({ from, version = BRAND.upstream.version } = {}) {
  const { dir, work } = acquireSource(from, version)
  try {
    const git = initRepo(dir)
    for (const edit of edits()) replaceOne(dir, edit)
    addExtraFiles(dir)
    git('add', '-A')
    const patch = git('diff', '--cached', '--binary', '--no-color')
    const changed = [...patch.matchAll(/^diff --git a\/(\S+) b\//gmu)].map(match => match[1])
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

/** Refuse patches that still carry logo art or embedded binary payloads. */
function assertNoArtifacts(patch) {
  for (const marker of ['HYPERAI_LOGO', 'hyperaiLogo', 'data:image']) {
    if (patch.includes(marker)) throw new Error(`patch must not contain logo/image data (${marker})`)
  }
  if (/[A-Za-z0-9+/]{500,}={0,2}/u.test(patch)) throw new Error('patch contains an embedded base64 payload')
  const longestLine = patch.split('\n').reduce((longest, line) => Math.max(longest, line.length), 0)
  if (longestLine > 4000) throw new Error(`patch has a ${longestLine}-character line; expected text-only edits`)
  if (patch.length > 256 * 1024) throw new Error(`patch is unexpectedly large (${patch.length} bytes)`)
}

/** Apply the generated patch to a fresh copy and smoke-test the branded result. */
function verifyPatch(patch, from, version) {
  assertNoArtifacts(patch)
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
    const branding = readFileSync(join(pristine, 'lib/types/branding.js'), 'utf8')
    if (!branding.includes(BRAND.splashWords.top) || !branding.includes(BRAND.splashWords.bottom)) {
      throw new Error('patch apply smoke test failed: splash words missing')
    }
    if (!branding.includes(`r: ${TITLE.r}, g: ${TITLE.g}, b: ${TITLE.b}`)) {
      throw new Error('patch apply smoke test failed: brand title colour missing')
    }
    if (!branding.includes('title: Object.freeze({')) throw new Error('patch apply smoke test failed: solid title palette missing')
    const logo = readFileSync(join(pristine, 'lib/types/components/LogoV2.js'), 'utf8')
    if (!logo.includes('HYPERAI_PALETTE.title')) throw new Error('patch apply smoke test failed: title palette not wired')
    if (!logo.includes('whale: false')) throw new Error('patch apply smoke test failed: row splash art not suppressed')
    if (!logo.includes('showWhale: false')) throw new Error('patch apply smoke test failed: column splash art not suppressed')
    const layout = readFileSync(join(pristine, 'lib/types/components/launchpadLayout.js'), 'utf8')
    if (!layout.includes('const wantsArt = false;')) throw new Error('patch apply smoke test failed: launchpad art budget not cleared')
    const fonts = readFileSync(join(pristine, 'lib/types/components/splashFonts.js'), 'utf8')
    if (!fonts.includes('BRAND_SPLASH_WORDS[brand]')) throw new Error('patch apply smoke test failed: splash words not wired')
    if (existsSync(join(pristine, 'lib/types/components/hyperaiLogo.js'))) {
      throw new Error('patch apply smoke test failed: unexpected logo component')
    }
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

/**
 * Whether this module is the process entry point.
 *
 * Comparing `process.argv[1]` with `fileURLToPath(import.meta.url)` as strings
 * fails when the script is reached through a symlinked directory (macOS `/tmp`
 * is `/private/tmp`, for example): Node resolves the module URL to the real
 * path while argv keeps the logical one, so the main flow is skipped and the
 * process still exits 0. Resolve both sides before comparing.
 * @returns {boolean} True when run directly (not imported).
 */
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  const args = parseArgs(process.argv.slice(2))
  const { patch, changed, version } = buildPatch(args)
  const out = join(PKG, 'patches', `dsh-tui@${version}.patch`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${patch}\n`)
  process.stdout.write(`hyperai-tui: wrote ${out}\n`)
  for (const file of changed) process.stdout.write(`  ${file}\n`)
}
