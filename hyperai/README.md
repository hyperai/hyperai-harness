# HyperAI distribution layer

This directory is the **HyperAI distribution kit** for the harness in this
repository. It is additive: it does not change a single file under `packages/`,
`apps/`, `vendor/`, or the build, so the DeepSeek Harness core is untouched and
upstream upgrades stay simple.

The kit gives this Mac (or any machine with the `dsh` CLI installed) a second,
independent profile named **`hyperai`** that boots a HyperAI-branded terminal
interface with the official HyperAI mark, the `HYPERAI HARNESS` title, an
OpenAI-compatible model route, and the relevant [hyperai-skills](https://github.com/hyperai/hyperai-skills)
installed as a profile-scoped skill root. The existing `dsh-tui` profile keeps
its own package, its own configuration, and its own UI state.

```
hyperai/
├── hyperai-tui/                # the hyperai-tui plugin distribution (build + install)
│   ├── brand/                  # official mark source, provenance, generated terminal art
│   ├── overlay/                # the splash-mark component added to the upstream package
│   ├── patches/                # the pnpm patch that rebrands dsh-tui (generated)
│   ├── profile/                # the hyperai dsh profile template (package.json + cordis patch)
│   ├── scripts/                # build-patch, generate-logo-art, install, install-skills, verify
│   └── tests/                  # node:test coverage for art, installer planning, skills logic
├── skills/                     # pinned hyperai-skills source + install set
└── docs/                       # branding, skills, and OpenTUI notes
```

## Install

Requirements: the `dsh` CLI (this Mac: `0.2.1-rc.2`), Node.js ≥ 22.19, `pnpm`
available to the `dsh plugin` command, and Git for the skills checkout.

```sh
# 1. build the branding artifacts from the committed official logo (writes
#    brand/generated/* and patches/dsh-tui@0.16.1.patch)
cd hyperai/hyperai-tui
node scripts/generate-logo-art.mjs
node scripts/build-patch.mjs

# 2. install the profile + pinned TUI dependency + skills into ~/.dsh
node scripts/install.mjs

# 3. point the profile at an OpenAI-compatible endpoint and launch
export HYPERAI_API_KEY=...                 # value of the key
export HYPERAI_BASE_URL=https://.../v1     # default https://api.openai.com/v1
export HYPERAI_MODEL=<model-id>            # default gpt-4o-mini placeholder
dsh --profile hyperai
```

`node scripts/install.mjs --dry-run` prints the plan without writing.
`node scripts/install.mjs --json` prints a machine-readable result.
`node scripts/install.mjs --no-skills` skips the skills step, and
`--verified-only` installs only the repo-verified skill area.

## Launch

```sh
dsh --profile hyperai          # supported entry point (same syntax as dsh-tui)
hyperai-tui                    # optional launcher shim from hyperai-tui/bin
```

## Environment contract

Nothing is hard-coded: the profile reads its route from the launcher
environment, so no key or endpoint is ever committed.

| Variable | Default | Meaning |
|---|---|---|
| `HYPERAI_API_KEY` | — | the credential, resolved live through `apiKeyEnv` |
| `HYPERAI_API_KEY_ENV` | `HYPERAI_API_KEY` | name of the variable that holds the key |
| `HYPERAI_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible gateway |
| `HYPERAI_MODEL` | `gpt-4o-mini` | deployment default model id |
| `HYPERAI_MODELS` | value of `HYPERAI_MODEL` | comma-separated model list for the picker |
| `HYPERAI_PROVIDER` | `hyperai` | pi-ai route key pinned as the deployment default |
| `HYPERAI_PROVIDER_LABEL` | `HyperAI` | display name of the route |
| `HYPERAI_SKILLS_DIR` | `<profile>/skills` | profile-scoped skill root |
| `DSH_TUI_PRESET`, `DSH_TUI_WORKSPACE_TARGET`, `DSH_TUI_RESUME_SESSION`, `DSH_TUI_BACKEND` | — | forwarded unchanged to the TUI row |

Users change the model later with `/model`; a persisted pick wins over the
deployment default exactly as upstream defines it.

## What was verified on this machine

| Check | Result | Evidence |
|---|---|---|
| Build the branding patch from the pinned upstream package | **PASS** | `scripts/build-patch.mjs` self-applies the patch to a fresh extraction |
| `hyperai-tui` artifacts (logo art, patch, profile, skills lock) | **PASS** | `node scripts/verify.mjs` → 12/12; `node --test tests/` → 20/20 |
| `hyperai` profile recognized and composed by dsh | **PASS** | `DSH_HOME=<home> dsh --profile hyperai --dump-config` |
| Startup shows `HYPERAI` / `HARNESS` block title + HyperAI mark | **PASS** | PTY capture of the launchpad and chat splash |
| Mark is generated from the canonical official SVG `/Users/zhenhaoli/Downloads/logo-icon-border-1.svg` | **PASS** | byte-identical copy in `brand/hyperai-logo.svg`; generator parses the SVG's own elements + embedded icon; no remote fetch; the old 60×60 PNG is retired |
| Mark uses the upstream whale's own drawing mechanism | **PASS** | letter-grid sprites + palette in `whaleFrames.js` format; rendered by the whale's `renderSpriteRows`; white circle + SVG rose icon preserved, **no ink/black substitution, no image protocol** |
| 40×40 main mark + 26×26 small-window fallback | **PASS** | wide mark on ≥44-row content; automatic degradation on shorter terminals; layout budget shares the same threshold |
| High-definition logo via terminal image protocol | **PASS** | Ghostty 1.4.0 + Kitty Graphics: 512×512 transparent PNG painted through the upstream `Image` component (`ghostty-hd-logo.png`); protocol probe returns `G i=31;OK` |
| Non-graphics terminals keep the ANSI logo | **PASS** | Terminal.app and PTY captures show the 40×40/26×26 sprite (`terminal-ansi-logo.png`); `DSH_TUI_DISABLE_TERMINAL_IMAGES=1` in Ghostty also falls back (`ghostty-ansi-fallback.png`) |
| Window resize / image clearing in HD mode | **PASS** | Ghostty shrink→enlarge captures keep one placement, no ghost/残影 (`ghostty-small-window.png`, `ghostty-resized-back.png`); layout height unchanged |
| User's real embedded terminal (Orca, xterm.js 6.0.0 light) | **PASS** | Real probes: no Kitty/Sixel, OSC 11 `#FFFFFF`; ANSI fallback was present but the official white plate had 1:1 contrast (logo looked gone). Light-theme rim fixes it — `orca-light-before.png` / `orca-light-after.png`; ring-pixel profile 0 → 3811+2450 (dark controls stay 0) |
| Light-terminal variants only add the SVG-accent rim | **PASS** | Dark sprites/PNG byte-identical to the official render; light sprites repaint only the circle edge with the SVG's own `#E11D48`; dark terminals measured 0 rim pixels |
| Image decode failure falls back to ANSI | **PASS** | Ghostty + corrupted embedded PNG payload: sharp decode fails → ANSI sprite (`ghostty-png-decode-fallback.png`), same rendering as images-disabled |
| Terminal diagnostics command | **PASS** | `node scripts/diagnose-terminal.mjs --json` reports real probes (Kitty/Sixel/DA1/OSC 11/XTVERSION/cell size), protocol, theme variant, fallback reason; no secrets; covered by `tests/diagnose-terminal.test.mjs` |
| SVG-derived logo clarity compared in the real terminal | **PASS** | `logo-clarity-svg.png`: 26/40/48 grids on the same background/box; 48×48 needs a 24-row slot and is not used in production |
| Title gradient is pink → white, not the theme's mist blue | **PASS** | captured title cells use `#FF6096`/`#FFA6C4`/`#FFF4F8`, **0 blue-ish cells** (was `#7DA1DE`) |
| Welcome screen no longer shows the DeepSeek whale/wordmark/tagline | **PASS** | `✦ hyperai-tui`, `HyperAI Harness` tagline, mark in the art slot |
| Input box and base UI | **PASS** | PTY capture |
| Model configuration loaded from the environment | **PASS** | launchpad param line showed the env model; `/model` route from `llm-pi-ai` |
| Real model message round-trip | **PASS** | live OpenAI-compatible route answered `SVG_LOGO_OK` |
| Tool call (bash) inside the TUI | **PASS** | live turn displayed the tool card and `SVG_TOOL_OK` |
| Agent discovers the installed skills | **PASS** | real profile context line reported `技能 10` (4 installed here + 6 pre-existing `~/.agents/skills` entries); a live turn listed every name |
| One applicable skill actually executed | **PASS (partial)** | installed `mineru-ocr` script converted a synthetic MinerU payload to xlsx with `A3:A4` merged cells; the live MinerU API path is **NOT TESTED** (no `MINERU_API_KEY`) |
| Existing `dsh-tui` profile still starts | **PASS** | PTY launch showed the upstream launchpad, `dsh-tui v0.16.1` |
| Existing `dsh-tui` profile files untouched | **PASS** | hashes of its `package.json` / `cordis.patch.yml` / `cordis.yml` / `pnpm-workspace.yaml` unchanged; its `node_modules` copy has no HyperAI patch |
| Existing `~/.dsh-tui` UI state not overwritten | **PASS** | the HyperAI profile writes `~/.dsh-tui-hyperai`; `model.json`/`settings.json`/`home.json` hashes in `~/.dsh-tui` unchanged after launches |

Screen captures live in [`docs/screenshots/`](docs/screenshots) (colored PNGs
plus text): `launchpad.png`, `launchpad-light.png`, `launchpad-compact.png`,
`chat-splash.png`, `chat-reply.png`, the SVG clarity comparison
`logo-clarity-svg.png`, real Terminal.app captures `real-terminal-dark.png`,
`real-terminal-light.png`, `real-terminal-small.png` (compact fallback), and the
Ghostty HD-mode evidence `ghostty-hd-logo.png`, `ghostty-chat-splash.png`,
`ghostty-small-window.png`, `ghostty-resized-back.png`,
`ghostty-ansi-fallback.png`, `terminal-ansi-logo.png`,
`logo-hd-vs-ansi.png`, `logo-detail-2x.png`, `hyperai-logo-512.png`,
`ghostty-protocol-probe.json`, plus the user-terminal and light-vs-dark evidence
`orca-light-before.png`, `orca-light-after.png`, `orca-light-small.png`,
`orca-light-resized-back.png`, `terminal-ansi-dark.png`, `terminal-ansi-light.png`,
`ghostty-hd-logo-dark.png`, `ghostty-hd-logo-light.png`,
`logo-light-fix-comparison.png`, `ghostty-png-decode-fallback.png`. The full
terminal matrix and diagnostics are in
[`docs/terminal-compatibility.md`](docs/terminal-compatibility.md) and the
protocol research in [`docs/image-protocols.md`](docs/image-protocols.md). The exact procedure and evidence are in
[`docs/verification.md`](docs/verification.md).

**NOT TESTED:** live MinerU OCR API calls (no key); `playwright-browser` (no
Playwright/Chromium in this environment); permission-approval prompt flow
(the verification turns ran with `DSH_PERMISSION_MODE=danger-full-access`);
Claude/Codex backends under the HyperAI profile.

## Safety notes

- The installed `@deepseek-harness-tui/dsh-tui` package is never modified. The
  HyperAI profile gets its own `node_modules` copy, patched through pnpm
  `patchedDependencies`.
- The `dsh-tui` profile keeps `~/.dsh-tui` as its UI-state directory; the
  HyperAI profile uses `~/.dsh-tui-hyperai`, so model picks, history, and
  onboarding state do not cross profiles.
- The installer refuses to overwrite a profile it did not create (use
  `--force` to back up and replace), and it backs up every file it replaces.
- No credential is written by the kit. `~/.hermes/.env`-style key files are
  read by the operator, not by these scripts.

## Known limitations and follow-ups

- The mark is generated from the **canonical official SVG**
  `/Users/zhenhaoli/Downloads/logo-icon-border-1.svg` (stored as
  `brand/hyperai-logo.svg`; provenance in `brand/PROVENANCE.md`). The generator
  parses the SVG's white-circle path, icon rect and embedded `271×267` PNG,
  composites them analytically, and downsamples to two whale-format letter-grid
  sprites — `40×40` (20 half-block rows, main) and `26×26` (13 rows, small
  windows) — painted by the whale's `renderSpriteRows` (see
  [`docs/branding.md`](docs/branding.md)). The `40×40` main mark needs a 20-row
  art slot, so the splash hero grew by 7 rows; terminals below 44 content rows
  automatically fall back to the original 13-row height. The embedded icon is
  `271×267`, so it comfortably covers the 40×40 grid; a `48×48` grid measured
  sharper but needs a 24-row slot and is deliberately not adopted. In
  Kitty/Sixel-capable terminals the logo is instead a 512×512 transparent PNG
  painted by the upstream `Image` component; that path needs the terminal
  renderer's own detection (it also disables itself under tmux/screen, in
  non-fullscreen and non-TTY runs, and when
  `DSH_TUI_DISABLE_TERMINAL_IMAGES=1`) and the optional `sharp` decoder that
  dsh-tui already ships — any failure keeps the ANSI sprite. Light terminal
  themes use a variant that repaints only the circle's outer edge with the SVG's
  own icon accent, because the official white plate on a pure-white background
  (e.g. the xterm.js-based Orca, VS Code or iTerm2 light themes) has no contrast;
  dark themes keep the official rendering. Real Sixel, iTerm2 inline images,
  VS Code/Cursor and Windows/Linux terminals are **NOT TESTED** here (see the
  matrix), and image placements have no end-to-end display acknowledgement. `@deepseek-harness-tui/dsh-tui`
  0.16.1 supports Kitty Graphics + Sixel only (no iTerm2 inline images), and its
  Ghostty screenshots are color-managed by the display profile, so captured RGB
  values can differ slightly from the PNG's exact bytes while looking identical.
- The UI color theme outside the splash header is still upstream's default
  (mist blue); only the splash title/wordmark/tagline were moved to the HyperAI
  pink family. A full palette is a data change in the patch but needs a design
  decision and visual review.
- `/update` is deliberately disabled inside the HyperAI build: running the
  upstream updater would replace the branded package. Bumps go through
  `scripts/build-patch.mjs` after updating `brand/brand.json` and
  `profile/package.json`.
- The upstream first-run wizard is disabled (it is DeepSeek-credential
  specific); provider setup is the environment contract above.
- Residual upstream surfaces that still say `dsh-tui`/DeepSeek in rarely seen
  places: the `/star` easter egg copy after usage milestones, some `/tips`
  entries, and the `/deepseek` easter-egg command name.
