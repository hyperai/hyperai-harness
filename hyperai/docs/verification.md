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
node --test tests/                   # 14/14 tests
```

`verify.mjs` covers: brand data, logo digest, the whale-format letter grid
(26×40 letters, white/pink palette, no dark entry), patch file set + the whale
renderer reused by `hyperaiLogo.js`, the title gradient palette,
profile-template consistency, skills-lock pin/classification, generator
determinism, installer dry-run plan, and the foreign-profile refusal.

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

- `screenshots/launchpad.png` / `.txt` — `HYPERAI`/`HARNESS` block title in the
  pink → white gradient, the whale-mechanism mark generated from the local
  canonical `/Users/zhenhaoli/Downloads/51961168.png`, `hyperai-tui v0.16.1`
  plate, `gpt-4o-mini` deployment route (dark terminal background).
- `screenshots/launchpad-light.png` / `.txt` — the same launchpad rendered on a
  light terminal background.
- `screenshots/chat-splash.png` / `.txt` — `✦ hyperai-tui`, mark, tagline
  `HyperAI Harness`, and the loaded-context line (`Skills 10`).
- `screenshots/chat-reply.png` / `chat-splash-and-reply.txt` — live
  OpenAI-compatible reply (`LOGO_WHALE_STYLE_OK`) plus a bash tool call
  (`TOOL_WHALE_STYLE_OK`) under the pink title.
- `screenshots/real-profile-skills-and-tool.txt` — earlier real-profile capture
  proving the agent listed the skill catalog and executed a bash tool call.

The PNGs from the PTY harness are rendered by `pyte` + Pillow, and the renderer
paints half-block cells (`▀`/`▄`/`█`) as exact cell rectangles instead of font
glyphs, so block-art seams from the screenshot tool are not mistaken for product
defects. The real-terminal PNGs below come from ScreenCaptureKit window
captures, not from the Python renderer.

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
- Evidence: `screenshots/real-terminal-dark.png`,
  `screenshots/real-terminal-light.png`,
  `screenshots/real-terminal-dark-logo.png` (mark detail), and
  `screenshots/real-terminal-whale-dark.png` /
  `real-terminal-whale-dark-logo.png` — the upstream DeepSeek whale rendered
  in the same window with the same `renderSpriteRows` for comparison.
- Checks: the dark capture's dominant cell color is the OSC background; the mark
  area contains only the original white plate + pink pattern + terminal
  background (transparent pixels), with **no `#1A1A20`/black plate and no black
  ring**. The light capture shows the same mark over a light background (the
  white plate is white-on-white by design — it is never darkened). The whale
  reference capture shows the same half-block quality on the same background,
  validating that the mark uses the upstream mechanism.
- Terminal.app supports neither the Kitty graphics protocol nor Sixel, and the
  implementation deliberately uses neither: the splash mark is pure ANSI
  true-color half blocks, exactly like the whale, so it renders identically in
  any ANSI true-color terminal.

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
