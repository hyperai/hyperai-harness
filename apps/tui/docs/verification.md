# Verification record: simplified HyperAI Harness TUI

## Automated (offline)

Run from `apps/tui` unless stated otherwise.

```sh
node scripts/build-patch.mjs        # rebuild patches/dsh-tui@0.16.1.patch
node scripts/verify.mjs             # 8/8 distribution checks
node --test tests/                  # 7/7 branding contract tests

cd ../profiles/hyperai
node scripts/verify.mjs             # 7/7 profile checks
node --test tests/                  # 10/10 installer + skills tests
```

`build-patch.mjs` unpacks the pinned upstream package with `npm pack`, applies
the exact-match edits, then applies the generated patch to a fresh copy and
smoke-tests it (splash words, solid `#FF6096` palette, art suppression, the
solid-title override, no logo module, brand-display copy). TUI verify additionally rejects logo
payloads, added image-protocol code, unexpected upstream files and patch size
growth; profile verify checks the native manifest/bundles, the environment-driven
model route, the TUI patch wiring, the pinned skills lock and the installer plan
and refusal rules.

Measured: patch is **34,787 bytes / 10 upstream files** (the previous logo
distribution carried >150 KB of embedded PNG/sprites; none of it remains).

## Real terminal acceptance (macOS 26.1, arm64)

### macOS Terminal.app — dark, light, small window, chat splash

Real window captures (ScreenCaptureKit, no simulated images):

| Capture | Result |
|---|---|
| `screenshots/launchpad-dark.png` | dark terminal `#101014`: pixel wordmark only, `#FF6096` title, input card/model line/footer present, **no logo or empty art block** |
| `screenshots/launchpad-light.png` | light terminal `#FAF7F2`: same layout, same `#FF6096` title (no theme gradient / no purple-blue shift) |
| `screenshots/launchpad-small.png` | 598×415 window: title stays centred and the hero collapses without blank art rows; input card remains usable |
| `screenshots/launchpad-resized-back.png` | resized small → back: layout matches the initial capture, no residue |
| `screenshots/chat-splash.png` / `chat-splash-light.png` | chat splash: wordmark + pixel title only, no logo |

Pixel assertions on those captures: containing pixels equal to `#FF6096` are
present in both themes (≈1.7k–2.9k pure pixels per capture), the old logo
`#E11D48`/white-circle profile is **0 pixels**, upstream whale blue is **0
pixels**, and the title block is horizontally centred (light/dark launchpad
centres within ~2% of the window centre).

### User's real embedded terminal: Orca (xterm.js 6.0.0, light theme)

`orca terminal read --screen` of a real Orca-managed terminal running
`dsh --profile hyperai` shows the 10-row pixel wordmark (`████`/`▓▓▓` glyphs)
starting at row 0, then the input card, model line and footer — **no logo rows**
(the full 20-line buffer is kept in
`screenshots/orca-terminal-screen.txt`). The Orca terminal is a plain
`xterm-256color` xterm.js surface; the HyperAI startup path no longer performs
any image-protocol probe, so there is nothing to mis-detect or leave blank.

Note: an Orca **window** screenshot could not be captured in this environment
(the Orca window was showing another workspace tab through `cua-driver` capture,
and `orca terminal switch` only changes the CLI-side focus); the terminal buffer
above is the real rendered screen content. The visual acceptance therefore uses
the real Terminal.app captures.

### Functional regression (real model gateway)

Real TUI session through the OpenAI-compatible gateway, driven in a PTY:

| Check | Result |
|---|---|
| Model reply | `glm-5.3`: `⏺ SIMPLE_OK`; `deepseek-v4-pro`: `⏺ SIMPLE_OK` |
| Tool call | `• Bash(echo SIMPLE_TOOL_OK)` → `⎿ SIMPLE_TOOL_OK` in both runs |
| Skills discovery | chat splash context line: `… Skills 10 · Tools 27` |
| Launch | `dsh --profile hyperai` starts into the launchpad; `hyperai-tui v0.16.1` plate |

`deepseek-v4-flash` returned a provider-side `400 "no healthy deployment"` from
the gateway during this run; the profile's model list and route are unchanged and
`/model`/`HYPERAI_MODEL` still switch models (verified with the two models
above).

### Isolation

- Original `dsh-tui` profile: its installed TUI still contains upstream
  `DEEPSEEK` branding and no HyperAI patch; this work never writes to
  `~/.dsh/profiles/dsh-tui` or `~/.dsh-tui`.
  `~/.dsh-tui/model.json` and the `dsh-tui` profile's `cordis.patch.yml` differ
  from an older baseline captured on 2026-10-29, but their mtimes are
  `2026-10-30 10:45/10:46` — **before this turn started (11:22)**, i.e. user
  activity between tasks, not this change.
- HyperAI profile migration: the installed profile was backed up first
  (`/tmp/hyperai-migration/profile-backup-*.tar.gz`, `/tmp/hyperai-migration/
  skills-before`, skills manifest), then refreshed in place. Verified after
  install: managed manifest marker, patch hash equal to the repository patch,
  branding applied, no `hyperaiLogoRows.js`, **skills directory and manifest
  byte-identical**, and `~/.dsh-tui-hyperai` UI state untouched.
- Root pnpm workspace: `apps/tui` is intentionally excluded from
  `pnpm-workspace.yaml` (no workspace dependencies/build graph), so the root
  project list, lockfile and build graph are unchanged; `pnpm m ls --depth -1`
  still lists only the pre-existing projects. `apps/profiles/hyperai` is two
  levels deep and not a workspace project (it installs into
  `~/.dsh/profiles/hyperai` through the native profile mechanism).

## Not tested / limitations

- Orca **window screenshot** in this environment (see note above); the real
  terminal buffer is recorded instead.
- Windows/Linux terminals are not available on this machine.
- The branding patch is version-pinned to `@deepseek-harness-tui/dsh-tui@0.16.1`;
  upstream drift fails the exact-match build (see `README.md`). A native Cordis
  branding plugin is a follow-up, not part of this distribution.
- The splash intentionally has no logo and no image protocol; there is no
  light/dark logo variant, rim, PNG or sprite to test anymore.
