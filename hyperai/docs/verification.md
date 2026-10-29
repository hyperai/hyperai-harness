# Verification procedure and evidence

Everything below was run on this Mac on 2026-10-29. Environment:
`dsh 0.2.1-rc.2`, `@deepseek-harness-tui/dsh-tui 0.16.1` (upstream), Node
`v26.9.0`, macOS 26.1 arm64. The DeepSeek Harness installation lives at
`~/.local/lib/node_modules/@deepseek-ai/dsh`; profiles live under `~/.dsh/profiles`.

## Automated (offline)

```sh
cd hyperai/hyperai-tui
node scripts/generate-logo-art.mjs   # regenerates the committed art
node scripts/build-patch.mjs         # rebuilds + self-applies the patch
node scripts/verify.mjs              # 11/11 checks
node --test tests/                   # 17/17 tests
```

`verify.mjs` covers: brand data, the canonical SVG digest, both whale-format
letter grids (wide 40×40 + compact 26×26, white + SVG-rose palette, no dark
entry), patch file set + the whale renderer reused by `hyperaiLogo.js` + the
dynamic splash-art height, the title gradient palette, profile-template
consistency, skills-lock pin/classification, generator determinism, installer
dry-run plan, and the foreign-profile refusal.

## Profile composition (no TTY needed)

```sh
dsh --profile hyperai --dump-config | grep -A6 'id: skill-filesystem'
dsh --profile hyperai --dump-config | grep -A4 'id: llm-pi-ai'
```

Confirmed: `llm-pi-ai` has the env-driven `hyperai` route; the `dsh-tui` row
carries `provider: !!js process.env.HYPERAI_PROVIDER ?? 'hyperai'`; the host
`skill-filesystem` row is enabled with the profile `customSkillDirs` root.
(`dsh: patch: entry "tool-ralph" not found` is an upstream bundle warning that
the unmodified `dsh-tui` profile prints as well.)

## Interactive (PTY)

The TUI requires a TTY. Captures were taken with a small Python harness:
`pty.fork()` + `TIOCSWINSZ` (110×40), timed key events, and `pyte` to rebuild
the final screen (colored ANSI stripped to text in the artifacts below).

```sh
# launchpad (no key events)
dsh --profile hyperai

# chat splash + live model reply
#   Enter at t=3s to open the chat, then the prompt at t=6s
dsh --profile hyperai
```

Evidence files:

- `screenshots/launchpad.png` / `.txt` — 120×50 launchpad: the wide 40×40
  SVG-derived mark and the pink gradient title, `hyperai-tui v0.16.1` plate,
  `gpt-4o-mini` deployment route (dark background).
- `screenshots/launchpad-light.png` / `.txt` — the same screen on a light
  terminal background.
- `screenshots/launchpad-compact.png` / `.txt` — 110×40 terminal: automatic
  degradation to the compact 26×26 mark.
- `screenshots/chat-splash.png` / `.txt` — `✦ hyperai-tui`, wide mark, tagline
  `HyperAI Harness`, loaded-context line.
- `screenshots/chat-reply.png` / `chat-splash-and-reply.txt` — live
  OpenAI-compatible reply (`SVG_LOGO_OK`) plus a bash tool call
  (`SVG_TOOL_OK`) under the pink title.
- `screenshots/real-terminal-{dark,light,small}.png` — real Terminal.app window
  captures (ANSI fallback; see below).
- `screenshots/ghostty-hd-logo.png`, `ghostty-chat-splash.png`,
  `ghostty-small-window.png`, `ghostty-resized-back.png`,
  `ghostty-ansi-fallback.png`, `terminal-ansi-logo.png`,
  `logo-hd-vs-ansi.png`, `logo-detail-2x.png`, `hyperai-logo-512.png`,
  `ghostty-protocol-probe.json` — Ghostty/Kitty HD mode evidence (see below).
- `screenshots/logo-clarity-svg.png` / `.md` — real-terminal 26/40/48 comparison
  from the SVG source.
- `screenshots/real-profile-skills-and-tool.txt` — earlier real-profile capture
  proving the agent listed the skill catalog and executed a bash tool call.

The PNGs from the PTY harness are rendered by `pyte` + Pillow, and the renderer
paints half-block cells (`▀`/`▄`/`█`) as exact cell rectangles instead of font
glyphs, so block-art seams from the screenshot tool are not mistaken for product
defects. The real-terminal PNGs below come from ScreenCaptureKit window
captures, not from the Python renderer.

## Canonical SVG -> terminal art

`brand/hyperai-logo.svg` is the only logo source (`51961168.png` is retired).
The generator parses the SVG (white circle path, icon rect, pattern matrix,
embedded `271x267` PNG), composites it analytically at 512×512 with 4×4
supersampling, and downsamples the result to the two whale-format letter grids:

```sh
node scripts/generate-logo-art.mjs   # SVG -> brand/generated/hyperai-logo.js
node scripts/build-patch.mjs         # -> patches/dsh-tui@0.16.1.patch
node scripts/install.mjs --no-skills # -> ~/.dsh/profiles/hyperai
```

Independent validation of the analytic composite against `rsvg-convert` at
1024×1024: alpha-mask IoU **0.9996**, composited mean absolute difference
**1.18/255**.

Clarity experiment (real Terminal.app captures, same 48×24-cell box and
background; RMSE vs the rsvg-rendered SVG, lower = closer):

| grid | display cells | mark on screen | colors | edge energy | RMSE |
|---|---|---|---|---|---|
| 26×26 | 26×13 | 163×163 px | 1440 | 18.9 | 58.3 |
| 40×40 | 40×20 | 248×248 px | 1533 | 13.6 | 46.4 |
| 48×48 | 48×24 | 291×288 px | 1620 | 11.5 | 31.3 |

Production uses **40×40 as the main mark** and **26×26 as the small-window
fallback** (`HYPERAI_LOGO_WIDE_MIN_ROWS = 44` terminal content rows, shared by
the logo component and the launchpad layout budget). The 48×48 grid is sharper
but needs a 24-row slot and is deliberately not adopted.

## Real Mac terminal (Terminal.app)

The splash was also captured from the actual macOS terminal, not just the PTY
harness:

- The Terminal window (Basic profile) was launched with a small `.command`
  script; the terminal background was set through OSC 11 (`#101014` for the dark
  shot, `#FAF7F2` for the light shot) so both contrast directions are real
  Terminal.app rendering, not a Python simulation.
- The window was resized to ≈168×53 cells, the TUI was allowed to settle, and
  the window was captured at native resolution through ScreenCaptureKit
  (`get_window_state`), giving PNG screenshots without JPEG/scale artifacts.
- Evidence: `screenshots/real-terminal-dark.png` (169×55, wide 40×40 mark),
  `screenshots/real-terminal-light.png` (168×54, same wide mark) and
  `screenshots/real-terminal-small.png` (139×40, compact 26×26 mark).
- Checks: the dark/light captures' dominant cell colors are the OSC backgrounds
  (`#101014` / `#FAF7F2`); the mark area contains only the SVG's white circle,
  rose icon and their blend edges, with transparent pixels showing the terminal
  background — **no ink/black plate**. The small-window capture confirms the
  automatic degradation to 26×26 and that the splash still fits.
- Terminal.app supports neither the Kitty graphics protocol nor Sixel (see the
  protocol probe in the experiment notes), and the implementation deliberately
  uses neither: the splash mark is pure ANSI true-color half blocks, exactly
  like the whale, so it renders identically in any ANSI true-color terminal.

## Ghostty + Kitty Graphics Protocol (HD logo mode)

Machine probe on 2026-10-29 (real terminal, not `$TERM` guessing):

```sh
open -na Ghostty.app --args -e <probe-script>   # Ghostty 1.4.0, macOS 26.1 (arm64)
```

Raw replies recorded in `screenshots/ghostty-protocol-probe.json`:

| query | reply | meaning |
|---|---|---|
| `CSI c` (DA1) | `CSI ? 62 ; 22 ; 52 c` | no parameter 4 → no Sixel advertised |
| Kitty Graphics query | `ESC _ G i=31 ; OK ESC \` | **Kitty Graphics Protocol available** |
| `CSI 16 t` (cell size) | `CSI 6 ; 17 ; 8 t` | 8x17 px cells |
| `CSI 14 t` (window px) | `CSI 4 ; 595 ; 792 t` | window pixel size |
| `CSI > 0 q` (XTVERSION) | `DCS > | ghostty 1.4.0 ST` | Ghostty 1.4.0 |

The HyperAI TUI's HD path uses the upstream renderer's own capability probe
(`useTerminalImages` → kitty query + DA1 + cell metrics) and paints the embedded
512x512 PNG through the upstream `Image` component. Observed rendering in real
Ghostty:

- `ghostty-hd-logo.png` — 1198x918 window, initial launchpad: smooth HD logo on
  `#101014`, transparent background (terminal bg through the circle's outside),
  no black rectangle, no color fringes;
- `ghostty-chat-splash.png` — chat splash, same HD mark;
- `ghostty-small-window.png` — window shrunk to 1001x622: the image follows the
  fixed art slot (compact 13-row height) and does not overlap the title or
  composer; `ghostty-resized-back.png` — enlarged back: one placement only, no
  ghost image (single rose cluster in the capture, same pixel count as the first
  capture);
- `ghostty-ansi-fallback.png` — same terminal with
  `DSH_TUI_DISABLE_TERMINAL_IMAGES=1`: the ANSI sprite path is used;
- `terminal-ansi-logo.png` — Terminal.app (no Kitty/Sixel): ANSI sprite
  fallback, unchanged;
- PTY without any terminal replies: the ANSI sprite renders immediately and no
  Kitty payload is emitted (fallback is the first frame, detection never blocks
  startup).

HD vs ANSI measured on the same real captures (`logo-hd-vs-ansi.png`,
`logo-detail-2x.png`): the HD image shows **thousands of distinct colors with
smooth edges** versus the sprite's 5-color cell blocks; the HD capture contains
**0 black pixels** in the logo area (transparency = terminal background).

`node scripts/verify.mjs` (11/11) now also checks the embedded 512x512 PNG
payload, its sha256, and that the patch wires the `Image` component with the
Upstream renderer.

## Title gradient color check

The big title uses raw true-color SGR, so the captured stream is checked
directly (pyte rebuilds the screen and exposes each cell's foreground):

- `HYPERAI` rows: `#FF6096` → `#FFA3C2` (pink → light pink)
- `HARNESS` rows: `#FFA6C4` → `#FFF4F8` (light pink → near white)
- blue-ish title cells (`b > r + 8`): **0** (the previous mist-blue theme accent
  was `#7DA1DE`)

The light-theme ladder (`#D6336C` → `#FF6699` → `#FFB3CC`) is covered by the
generated palette data and by the real light-terminal capture
(`real-terminal-light.png`).

Live model calls used an environment-only OpenAI-compatible credential (an
internal gateway reachable from this machine). No credential is stored in this
repository or in the profile files.

## Skill execution

```sh
python3 <profile>/skills/mineru-ocr/scripts/mineru_to_xlsx.py \
  /tmp/dsh-skill-test/mineru_demo.json /tmp/dsh-skill-test/skill-out.xlsx
```

Result: sheet `OCR结果`, merged range `A3:A4`, `m²` LaTeX cleanup,
`2,550 → 2550`. This exercises the installed skill's own code path (not a mock).
The live MinerU OCR API was **NOT TESTED** (no `MINERU_API_KEY` available).

## Impact on the existing environment

```sh
# before/after hashes must be IDENTICAL
shasum -a 256 ~/.dsh/profiles/dsh-tui/{package.json,cordis.patch.yml,cordis.yml,pnpm-workspace.yaml,pnpm-lock.yaml}
shasum -a 256 ~/.dsh-tui/{model.json,settings.json,home.json}

# and the upstream package copy must not carry the patch
grep -c HYPERAI ~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/branding.js  # 0
```

The HyperAI profile writes its UI state under `~/.dsh-tui-hyperai`; the
existing `dsh-tui` profile keeps `~/.dsh-tui`.

## Not tested

- live MinerU OCR API and `playwright-browser` (no key / no Playwright install);
- permission-approval prompt flow (verification turns ran with
  `DSH_PERMISSION_MODE=danger-full-access`);
- Claude/Codex backend kernels under the HyperAI profile;
- a live light-terminal capture (the light art variant is covered by tests).
