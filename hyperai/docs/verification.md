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

- `screenshots/launchpad.txt` — `HYPERAI`/`HARNESS` block title, official mark,
  `hyperai-tui v0.16.1` plate, `gpt-4o-mini` deployment route.
- `screenshots/chat-splash-and-reply.txt` — `✦ hyperai-tui`, mark, tagline
  `HyperAI Harness`, and a live OpenAI-compatible model reply
  (`FINAL_BRAND_OK`).
- `screenshots/real-profile-skills-and-tool.txt` — real `~/.dsh` profile:
  the agent listed the skill catalog (the four installed skills plus the six
  pre-existing `~/.agents/skills` entries) and a bash tool call returned
  `REAL_PROFILE_OK`.

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
