# Verification record: simplified HyperAI Harness TUI

## Automated (offline)

Run from `apps/tui` unless stated otherwise.

```sh
node scripts/build-patch.mjs        # rebuild patches/dsh-tui@0.16.1.patch
node scripts/verify.mjs             # 13/13 distribution checks
node --test tests/                  # 14/14 branding + skills-bridge tests

cd ../profiles/hyperai
node scripts/verify.mjs             # 12/12 profile checks
node --test tests/                  # 67/67 installer + skills/updater tests
```

`build-patch.mjs` unpacks the pinned upstream package with `npm pack`, applies
the exact-match edits, then applies the generated patch to a fresh copy and
smoke-tests it (splash words, solid `#FF6096` palette, art suppression, the
solid-title override, no logo module, brand-display copy). TUI verify additionally rejects logo
payloads, added image-protocol code, unexpected upstream files and patch size
growth; profile verify checks the native manifest/bundles, that the profile
patch layer contains only the skill root (no forced provider, endpoint,
credential variable or default model), the TUI patch wiring, the pinned skills
lock, the installer plan/refusal rules and the reinstall migration that keeps
user provider/TUI rows while dropping the removed environment-driven preset.

Measured: patch is **81,685 bytes / 16 upstream files** (the previous logo
distribution carried >150 KB of embedded PNG/sprites; none of it remains).
The two added files are the HyperAI Skills TUI bridge; Chat/commands/settings
only gain the branded command/hook/hint, the disabled upstream `/update` route,
the branded terminal title, explicit “not used by HyperAI” labels for the
upstream mascot toggles, and the runtime early-return that disables upstream
TUI self-update checks before any npm/GitHub request.

## Real terminal acceptance (macOS 26.1, arm64)

### Splash font regression (2026-11-02)

Real Orca window captures (CuaDriver window capture, not a terminal-screen
reconstruction) show the failure and the fix:

| Capture | Result |
|---|---|
| `screenshots/real/orca-before-hollow.png` | actual Orca window before the fix: the current date selected upstream's daily `stencil` face, whose interior cutouts read as a hollow/outlined pixel wordmark |
| `screenshots/real/orca-after-solid.png` | actual Orca window after the fix: HYPERAI/HARNESS use the upstream solid `bold` face, exactly `#FF6096` |
| `screenshots/real/orca-after-small.png` | actual Orca window cropped to the wordmark: solid wordmark and centred layout at a narrower window size |
| `screenshots/real/orca-after-narrow.png` | actual Orca narrow-window capture cropped to the terminal content: upstream fallback uses the plain `HyperAI Harness` title with no hollow glyphs |
| `screenshots/real/orca-after-chat.png` | actual Orca chat screen after `/new`: same solid HYPERAI/HARNESS wordmark, no chat regression |

Root cause: `pickSplashFont()` rotates the nine upstream fonts by local date.
On 2026-11-02 it returned `stencil`; the `STENCIL` transform removes interior
vertical-stroke columns (only the first column of each vertical run remains),
so glyph interiors look cut out. `launchpad-dark.png`'s title cells match the
`BOLD_GLYPHS` table (solid 2-cell strokes), so the reference capture was the
`bold` face; Skills commits never changed the glyph data or renderer, only the
calendar moved to `stencil`.

Fix: `build-patch.mjs` now pins the daily selection to `splashFontById('bold')`
for the `deepseek`/HyperAI brand in both `LogoV2` and `Launchpad`; an explicit
`/settings` font choice still wins, and other brands keep upstream rotation.

Exact brand pixels in the actual captures: after-solid `#FF6096` count 14,965;
before-hollow 8,700. Small window also has the solid wordmark.

### Round 2 narrow-width PTY evidence

Real PTY runs (`pyte`, 30 rows) at 120/110/80/56 columns are under
`screenshots/real/terminal-width-{120,110,80,56}.txt` (local paths redacted).
At 110/80/56 the workspace row and version row stack instead of colliding; the
product version remains one of `hyperai-tui v0.2.0-beta.4` / `hyperai v0.2.0-beta.4`, and the
120-column layout keeps the product+upstream pair on one row. This is developer
self-test evidence, not the QA Round 3 certificate.

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

### User's real embedded terminal: Orca (xterm.js)

`orca terminal read --screen` of a real Orca-managed terminal running
`dsh --profile hyperai` shows the 10-row pixel wordmark (`████`/`▓▓▓` glyphs)
followed by the input card, model line and footer — **no logo rows**. The Orca
terminal is a plain `xterm-256color` xterm.js surface; the HyperAI startup path
does not perform any image-protocol probe.

The checked-in evidence is the actual Orca window capture set under
`screenshots/real/`, cropped to the terminal/title area so local window chrome
and workspace paths are not published. It includes the before/after font
regression, the narrower window and the chat splash. The older full-window
capture was removed because it exposed a local account path.

### HyperAI Skills update prompt and install flow

The TUI bridge is split from the profile updater:

- `apps/profiles/hyperai/scripts/skills-update.mjs check --auto/--manual --json`
  owns the remote scan, the 24h auto-check slot and the dismissed-batch state;
- `apps/tui/src/hyperaiSkills.js` owns only presentation and choice, and calls
  `update --yes --ref <resolved-sha>` after the person confirms in the
  existing managed dialog;
- `apps/tui/src/hyperaiSkillsCore.js` is the dependency-free copy/fingerprint
  layer used by unit tests.

Captures (rendered from a real PTY/pyte screen; terminal background supplied by
the capture renderer, matching the real dark/light screens):

| Capture | Result |
|---|---|
| `screenshots/skills-update-prompt-dark.png` | 启动后异步提示：`● HyperAI Skills 有 1 项可安装更新 · 输入 /skills-update`；该提示行可点击，聊天输入框可继续输入 |
| `screenshots/skills-update-prompt-light.png` | 浅色主题同样的提示，品牌 `#FF6096` 像素标题不变 |
| `screenshots/skills-update-prompt-small.png` | 80×24 小窗口：提示不挤占输入框，聊天/落地页保持可用 |
| `screenshots/skills-update-dialog-light.png` | `/skills-update` 打开现有 managed-dialog：安装更新 / 查看详情 / 稍后再说，中文文案 |

Real PTY acceptance used an isolated `DSH_HOME`/`HOME` copy of the profile and
`HYPERAI_SKILLS_TUI_REF=feat/ppt-generation-upstream` with the local dev
checkout as `HYPERAI_SKILLS_TUI_SOURCE` (network to GitHub was timing out during
the last capture run).

**Feedback fix (2026-10-30):** a live Orca terminal showed `/skills-update`
spawning the manual check (the child process was running and `Checking…` was
visible) but the final *up to date* / network-error feedback was only a
2.5–10s toast; a GitHub `ls-remote` can block for 30s, so the toast expired or
was repainted before the person saw it. The manual flow now keeps a persistent
inline `正在检查…` notice and renders the result (`已是最新` / `检查失败` /
`安装完成`) in the existing managed dialog until the user dismisses it. A
fresh Orca terminal confirmed: persistent checking notice, persistent
`HyperAI Skills is up to date · Source …` dialog, and a persistent
`HyperAI Skills check failed: git ls-remote … ETIMEDOUT` dialog. A terminal
started before the patch was installed still runs the old code and must be
restarted. The installed manifest recorded the exact resolved SHA
`34f0a1be0cb3ae9905aecebba13efae6a8657be1`; `ppt-generation` then appeared in
the TUI `/skills` catalog and the DSH loader/`customSkillDirs` list.

### Functional regression (real model gateway)

Real TUI session through the OpenAI-compatible gateway, driven in a PTY:

| Check | Result |
|---|---|
| Model reply | `glm-5.3`: `⏺ SIMPLE_OK`; `deepseek-v4-pro`: `⏺ SIMPLE_OK` |
| Tool call | `• Bash(echo SIMPLE_TOOL_OK)` → `⎿ SIMPLE_TOOL_OK` in both runs |
| Skills discovery | chat splash context line: `… Skills 10 · Tools 27` |
| Launch | `dsh --profile hyperai` starts into the launchpad; `hyperai-tui v0.16.1` plate |

`deepseek-v4-flash` returned a provider-side `400 "no healthy deployment"` from
the gateway during this run; the profile's model list and route were user-configured
at that time (`/model` still switches models — verified with the two models
above). The profile now ships no model provider/default at all; providers are
configured with DSH's native `/provider` flow.

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
- The auto-check prompt is a non-blocking inline hint plus the existing toast;
  it deliberately does NOT auto-open a modal, so installing requires the
  explicit `/skills-update` command or its completion. The install/later choice
  itself uses the existing managed dialog.
- GitHub Internal reachability was intermittent during the last capture run;
  the TUI dev-branch install was verified with the local `feat/ppt-generation-upstream`
  checkout and exact SHA, while the real remote `check` had succeeded earlier.
- The branding patch is version-pinned to `@deepseek-harness-tui/dsh-tui@0.16.1`;
  upstream drift fails the exact-match build (see `README.md`). A native Cordis
  branding plugin is a follow-up, not part of this distribution.
- The splash intentionally has no logo and no image protocol; there is no
  light/dark logo variant, rim, PNG or sprite to test anymore.
