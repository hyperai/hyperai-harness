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
node scripts/verify.mjs              # 9/9 checks
node --test tests/                   # 14/14 tests
```

`verify.mjs` covers: brand data, logo digest, art grid shape, patch file set,
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
  pink → white gradient, mark generated from the local canonical
  `/Users/zhenhaoli/Downloads/51961168.png`, `hyperai-tui v0.16.1` plate,
  `gpt-4o-mini` deployment route.
- `screenshots/chat-splash.png` / `.txt` — `✦ hyperai-tui`, mark, tagline
  `HyperAI Harness`, and the loaded-context line (`Skills 10`).
- `screenshots/chat-reply.png` / `chat-splash-and-reply.txt` — live
  OpenAI-compatible reply (`PINK_BRAND_OK`) plus a bash tool call
  (`BRAND_TOOL_OK`) under the pink title.
- `screenshots/real-profile-skills-and-tool.txt` — earlier real-profile capture
  proving the agent listed the skill catalog and executed a bash tool call.

## Title gradient color check

The big title uses raw true-color SGR, so the captured stream is checked
directly (pyte rebuilds the screen and exposes each cell's foreground):

- `HYPERAI` rows: `#FF6096` → `#FFA3C2` (pink → light pink)
- `HARNESS` rows: `#FFA6C4` → `#FFF4F8` (light pink → near white)
- blue-ish title cells (`b > r + 8`): **0** (the previous mist-blue theme accent
  was `#7DA1DE`)

The light-theme ladder (`#D6336C` → `#FF6699` → `#FFB3CC`) is covered by the
generated palette data; a live light-terminal capture was not taken.

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
