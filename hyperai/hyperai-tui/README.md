# hyperai-tui

The HyperAI-branded build of [`@deepseek-harness-tui/dsh-tui`](https://github.com/ccch1mneyyy/dsh-TUI)
plus the `hyperai` dsh profile that mounts it.

It is **not a reimplementation**: upstream already provides chat and streaming,
tool cards, permission approvals, session resume, model/effort/preset pickers,
the composer, keyboard shortcuts, settings, and the agent status line. The
branding is a `pnpm patch` over the pinned upstream package (0.16.1) with a
handful of data and slot edits, so every interaction keeps working exactly as
upstream, and upgrading is a patch rebuild rather than a merge.

## How the branding works

`scripts/build-patch.mjs` unpacks the exact upstream tarball, applies
exact-match edits (a mismatch aborts the build — no silent half-branded build),
adds two files, and writes `patches/dsh-tui@0.16.1.patch`. The profile installs
that patch through pnpm `patchedDependencies`.

| Upstream file | Edit | Purpose |
|---|---|---|
| `lib/types/branding.js` | splash words → `HYPERAI`/`HARNESS`, tagline, `/settings` brand label, `HYPERAI_PALETTE` (pink accent + dark/light title ladders) | brand data |
| `lib/types/components/splashFonts.js` | the `deepseek` brand no longer short-circuits to the font table's built-in `DEEPSEEK`/`HARNESS` | the big title actually changes |
| `lib/types/components/LogoV2.js` | art slot → `HyperAILogoArt`; mascot/portrait slots off; `✦ hyperai-tui` wordmark; title ladder pinned to the HyperAI pink palette (pink → near-white on dark, deep pink → light pink on light) | splash art + title gradient |
| `lib/types/components/hyperaiLogo.js` (new) | splash-mark component; uses the upstream `Image` component + embedded 512×512 PNG when the renderer reports Kitty/Sixel support, otherwise the wide/compact whale sprite through `renderSpriteRows`; fixed-height art slot keeps the layout stable | renderer |
| `lib/types/components/hyperaiLogoRows.js` (new, generated) | two letter-grid sprites (wide 40×40, compact 26×26) + palette + the embedded 512×512 transparent PNG used by the terminal image protocol path | asset |
| `lib/types/components/splashArtRows.js` | art form pinned to the mark; dynamic art height (wide 20 rows / compact 13 rows) shared with the logo component | layout |
| `lib/types/screens/Launchpad.js` | version plate `hyperai-tui v…`; layout budget uses the dynamic art height | landing page |
| `lib/types/i18n.js` | tagline, kernel label, task notification, onboarding copy, star line | copy |
| `lib/types/components/splashEggs.js` | star line links the HyperAI repository | copy |
| `lib/types/dsh-adapter/plugin.js` | first-run wizard off (upstream wizard is DeepSeek-credential specific) | boot |
| `lib/types/utils/paths.js` | UI state root `~/.dsh-tui-<profile>` for non-`dsh-tui` profiles | isolation |
| `lib/types/update.js` | updater disabled (it would replace the branded package) | safety |

The splash mark is generated from the **canonical official SVG**
(`/Users/zhenhaoli/Downloads/logo-icon-border-1.svg`, copied byte-for-byte to
`brand/hyperai-logo.svg`), never a redraw: `scripts/generate-logo-art.mjs` parses
the SVG (white circle path, icon rect, pattern matrix, embedded 271×267 PNG),
composites it analytically at 512×512 with 4×4 supersampling, and downsamples it
to two letter-grid sprites in the upstream whale frame format — wide `40×40`
(main, 20 display rows) and compact `26×26` (13 rows, small windows) — using the
SVG's own white/rose colors plus intermediate blends, and also encodes a
`512×512` transparent RGBA PNG in the module. The component shows the PNG through
the upstream `Image` component when the renderer's own capability probe reports
Kitty Graphics or Sixel, and falls back to the sprites via the whale's
`renderSpriteRows` otherwise — true-color half blocks, terminal background for
transparent pixels, no theme-specific recoloring. No remote URL is fetched.
Provenance, source path and digest are recorded in `brand/brand.json` and
`brand/PROVENANCE.md`.

## Build and verify

```sh
node scripts/generate-logo-art.mjs   # brand/hyperai-logo.svg -> brand/generated/*
node scripts/build-patch.mjs         # upstream tarball -> patches/dsh-tui@0.16.1.patch
node scripts/verify.mjs              # 11 offline build/distribution checks
node --test tests/                   # 14 unit tests
```

`build-patch.mjs` also self-checks: it extracts a second pristine copy, applies
the generated patch, and asserts the expected file set. It accepts
`--from <pristine-package-dir>` to build offline from a local extraction.

## Install

```sh
node scripts/install.mjs [--dsh-home <dir>] [--profile hyperai] [--dsh-bin <path>]
                         [--no-skills] [--verified-only] [--skills-ref <sha>]
                         [--dry-run] [--force] [--json]
```

The installer writes the managed profile files (`package.json`,
`cordis.patch.yml`, `pnpm-workspace.yaml`, `patches/hyperai-tui.patch`), runs
`dsh plugin --profile hyperai install` (dsh's own pnpm wrapper), verifies the
patch landed in `node_modules`, and then installs the skills. It is idempotent,
refuses to touch a profile it did not create, and backs up replaced files under
`<profile>/.hyperai-backups/<timestamp>/`.

## Profile layout

`profile/` is the template materialized at `~/.dsh/profiles/hyperai`:

- `package.json` — bundles `@deepseek-ai/dsh-base` (harness core) then the
  pinned TUI, exactly like the working `dsh-tui` profile.
- `pnpm-workspace.yaml` — hoisted install plus the patch pin.
- `cordis.patch.yml` — an OpenAI-compatible `llm-pi-ai` route driven entirely by
  environment variables, the TUI row's deployment route, and the profile-scoped
  `skill-filesystem.customSkillDirs` root. No credentials.

## Updating upstream

1. Set `upstream.version` in `brand/brand.json` and the dependency in
   `profile/package.json`.
2. `node scripts/generate-logo-art.mjs && node scripts/build-patch.mjs` — the
   exact-match edits report any drifted upstream line.
3. Reinstall and re-run the PTY verification (see `../README.md`).
4. Never run `/update` inside the HyperAI profile; it would replace the patch.
