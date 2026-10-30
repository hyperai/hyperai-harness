# hyperai-tui

HyperAI Harness branding for the DeepSeek Harness terminal UI: the startup
splash shows the large pixel wordmark **HYPERAI HARNESS** in the product pink
`#FF6096`, and nothing else. There is no logo, mascot, PNG, ANSI sprite or image
protocol in the HyperAI startup path.

This package owns **only the TUI plugin/branding layer**:

- the brand words, product name and terminal-visible copy;
- the single brand colour used for the splash title, wordmark and welcome line;
- the layout decision that the splash hero is the wordmark alone;
- the `pnpm` patch that rebrands the pinned upstream `dsh-tui`;
- TUI build, offline verification and unit tests.

It does **not** own the model provider, API keys, skills installation or profile
initialization. Those live in the independent profile package at
[`apps/profiles/hyperai`](../profiles/hyperai).

## Install and run

The profile installer owns installation (it copies this package's patch into the
managed profile and installs the pinned upstream dependency):

```sh
cd apps/profiles/hyperai
node scripts/install.mjs            # profile init + TUI patch + skills
export HYPERAI_API_KEY=<your key>
export HYPERAI_BASE_URL=https://your-openai-compatible-gateway/v1
dsh --profile hyperai
```

`dsh --profile hyperai` is the only entry point; there is no extra launcher CLI.

## Commands

Run from this directory (the package is intentionally outside the repository's
root pnpm workspace: it is a self-contained distribution, not part of the DSH
build graph):

```sh
node scripts/build-patch.mjs        # rebuild patches/dsh-tui@<version>.patch
node scripts/verify.mjs             # offline distribution self-check
node --test tests/                  # unit tests
```

`build-patch.mjs` unpacks the pinned upstream package (`npm pack`), applies the
exact-match brand edits and self-tests the result by applying the generated
patch to a fresh copy. `--from <dir>` builds from a local pristine package
instead of the registry.

## Brand contract

| Item | Value |
|---|---|
| Product name | `HyperAI Harness` |
| TUI plugin name | `hyperai-tui` |
| Splash words | `HYPERAI` / `HARNESS` |
| Splash colour | `#FF6096` (255, 96, 150) — solid, identical in dark and light themes |
| Splash artwork | none: no logo, mascot, whale, PNG, sprite or image protocol |
| Pixel font | upstream big-font renderer, unchanged |

The brand data lives in one place: [`src/brand.json`](src/brand.json). The build
derives the patched palette from `titleColor`, so the colour is not duplicated in
the patch source.

## Patch maintenance

The branding is a `pnpm` patch of `@deepseek-harness-tui/dsh-tui` (`0.16.1`),
pinned by `src/brand.json` → `upstream`. Every edit is an exact-match
replacement: when upstream changes a target line, `build-patch.mjs` fails instead
of silently producing a half-branded patch. To bump the upstream version:

1. update `upstream.version` in `src/brand.json`;
2. run `node scripts/build-patch.mjs` and fix any exact-match drift it reports;
3. re-run `node scripts/verify.mjs && node --test tests/`;
4. reinstall the profile (`apps/profiles/hyperai/scripts/install.mjs`).

This pinning is the maintenance limitation of the patch approach. A native
Cordis branding plugin that upstream supports would remove it; that is recorded
as a follow-up, not part of this distribution.

Upstream `@deepseek-harness-tui/dsh-tui` is MIT-licensed
(https://github.com/ccch1mneyyy/dsh-TUI); only branding strings, the splash art
slot and the profile-state path are patched. Chat, streaming, tools, sessions,
approvals, model pickers, keyboard handling and all image features stay upstream.

## Layout

```
apps/tui/
├── src/brand.json          single brand-data source (words, pink, upstream pin)
├── scripts/build-patch.mjs build the pnpm patch from src/brand.json
├── scripts/verify.mjs      offline distribution checks
├── patches/                committed generated patch
├── tests/                  branding contract tests
├── docs/branding.md        brand decisions and splash layout behaviour
└── docs/verification.md    automated + real-terminal verification record
```
