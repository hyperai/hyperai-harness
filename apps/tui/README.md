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
dsh --profile hyperai
```

Configure the model with DSH's native commands inside the TUI: `/provider` to
add an API provider and `/model` to pick a model. The profile does not preset a
provider, endpoint, API-key variable or default model.

`dsh --profile hyperai` is the only entry point; there is no extra launcher CLI.

## Runtime compatibility

HyperAI TUI is pinned to upstream `@deepseek-harness-tui/dsh-tui@0.16.1` and
validated against the DSH Core lines listed in
[`src/brand.json`](src/brand.json) (`core.validated`; currently the
`0.2.0-rc.2` tested line plus older mapped lines). The profile installer refuses
a DSH Core line outside that set before writing; there is no accept-risk bypass.
Upgrading DSH Core or dsh-tui requires rebuilding this patch and updating the
compatibility list/test evidence; see [`docs/compatibility.md`](docs/compatibility.md).

The upstream `/update` command is intentionally disabled in the branded build:
it would replace the patched package with an unbranded upstream release. The
runtime update-check entry point also returns before contacting npm or GitHub,
so the branded build neither shows the upstream “new version available” notice
nor performs its background version request. This is separate from HyperAI
Skills updates. `/update`
now points at the HyperAI profile installer/release flow. `/restart` and the
normal upstream session/chat/tool features remain available.

`/settings` retains a few upstream compatibility toggles (header art, maid
portrait, welcome animation, splash font). They are explicitly labelled as not
used by HyperAI; the branded splash is always the solid pixel wordmark. The
version plate distinguishes the HyperAI product version (`hyperai-tui v0.2.0-beta.4`)
from the pinned upstream TUI version (`dsh-tui v0.16.1`), and the terminal title
carries no upstream whale glyph. Very narrow terminal windows keep upstream's
plain-title fallback rather than a cropped pixel wordmark.

## Product build (internal beta)

`node scripts/build-package.mjs --upstream <pinned tarball> --out <dir>` turns the
pinned upstream package into a finished, installable `@hyperai/hyperai-tui`
tarball: the branding patch is applied, every runtime self-reference is renamed,
and the product is repacked deterministically. The internal-beta installation
package (`apps/profiles/hyperai/scripts/build-beta.mjs`) calls it and embeds the
result.

Two guarantees are enforced by assertions, not convention:

- **Exempt material is byte-identical.** `LICENSE*`, `licenses/`, the upstream
  README/guide and every copyright line are never rewritten; upstream
  repository/author URLs are compared before and after the build.
- **The file set is explicit.** The product must contain exactly the upstream
  tarball's files plus `LICENSE-HYPERAI.txt`, `HYPERAI.md` and `licenses/`. This
  is why `vendor/` is now preserved: RFC-001 lost it because `npm pack` decided
  the file set from upstream's `files` field.

`upstream.json` pins the input by size, sha256 and npm integrity; the builder
refuses any other bytes before unpacking. The product `version` is the HyperAI
release (`0.2.0-beta.4`), while `hyperai.upstreamVersion` keeps `0.16.1` for the
`dsh-tui v…` half of the plate and for update/version-drift logic.

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

## Splash font

The upstream renderer rotates through nine splash fonts daily (`bold`, `square`,
`bevel`, `wide`, `dot`, `stencil`, `classic`, `slab`, `shadow`). `stencil` and
`classic` are hollow/outline faces. HyperAI therefore pins its splash to the
upstream solid `bold` glyph table; `/settings` can still choose another face
explicitly. The words, spacing and `#FF6096` colour come from the existing
renderer.

## HyperAI Skills updates

`dsh --profile hyperai` starts checking the profile's HyperAI Skills updater
asynchronously after the first frame. When new or updated skills exist, the
chat/launchpad shows a non-blocking hint:

```text
● HyperAI Skills 有 1 项可安装更新 · 输入 /skills-update
```

Clicking the hint line, typing `/skills-update`, or using its command completion opens the existing managed dialog. Manual checks keep a persistent `正在检查…` notice and show the up-to-date/failure result in that dialog until dismissed, so a slow GitHub check cannot disappear as a transient toast
with **安装更新 / 查看详情 / 稍后再说**. Nothing is installed until the person
confirms; installation then runs the profile's updater with the exact SHA that
`check` resolved, so a moving branch cannot silently change the batch. The
query layer, manifest, backups and rollback stay in
`apps/profiles/hyperai/scripts/skills-update.mjs`; this package only renders
the prompt and choices.

Automatic checks are silent when there is no change, at most once per 24 hours
(`check --auto`), and a dismissed batch is not shown again. A manual
`/skills-update` bypasses the interval. Network failures are silent for the
automatic path (the chat remains usable) and become a short toast for the
manual path. The TUI never starts a second skills scanner.

Test-only source injection (never persisted, no effect on normal launches):

```sh
HYPERAI_SKILLS_TUI_REF=feat/ppt-generation-upstream HYPERAI_SKILLS_TUI_SOURCE=/path/to/hyperai-skills-checkout   dsh --profile hyperai
```

Screenshots: [`docs/screenshots/skills-update-prompt-dark.png`](docs/screenshots/skills-update-prompt-dark.png),
[`...-light.png`](docs/screenshots/skills-update-prompt-light.png),
[`...-small.png`](docs/screenshots/skills-update-prompt-small.png) and
[`skills-update-dialog-light.png`](docs/screenshots/skills-update-dialog-light.png).

## Brand contract

| Item | Value |
|---|---|
| Product name | `HyperAI Harness` |
| TUI plugin name | `hyperai-tui` |
| Splash words | `HYPERAI` / `HARNESS` |
| Splash colour | `#FF6096` (255, 96, 150) — solid, identical in dark and light themes |
| Splash artwork | none: no logo, mascot, whale, PNG, sprite or image protocol |
| Pixel font | upstream big-font renderer; HyperAI defaults to the solid `bold` face (daily hollow fonts are not used) |

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

## Known limitations

- Narrow terminals stack the workspace/version footer instead of shrinking it
  into collision; the checked-in 120/110/80/56-column PTY captures under
  [`docs/screenshots/real/`](docs/screenshots/real/) show the product version
  remains readable. At 56 columns the footer intentionally shows the compact
  `hyperai v0.2.0-beta.4` product label and omits the upstream `dsh-tui` version rather
  than squeezing or overlapping text; 80 columns is the comfortable minimum for
  the full pair. Exact terminal certificates remain QA-owned.


- `/settings` keeps upstream fields for header art, maid portrait, welcome
  animation and splash font for compatibility; they are labelled “not used by
  HyperAI”.
- Upstream provider-form API-key echo and the upstream `tool-ralph` warning are
  outside this branding patch and are tracked as upstream issues.
- 56/80/120-column behavior and Windows/Linux terminals still require the QA
  matrix; the current bundled screenshots cover macOS/Orca and Terminal.app.

## Upstream and license

HyperAI TUI is **based on the upstream dsh-TUI project**; it is not a
from-scratch TUI:

- Repository: <https://github.com/ccch1mneyyy/dsh-TUI>
- Version: [`@deepseek-harness-tui/dsh-tui@0.16.1`](https://www.npmjs.com/package/@deepseek-harness-tui/dsh-tui/v/0.16.1), tag `v0.16.1` (commit `73ff99fbed56563bf154d719effd09f9f9725349`)
- Upstream license: MIT, Copyright (c) 2026, chimney (ccch1mneyyy)
- Upstream third-party portions: BSD-3-Clause (dsh-ui-whale) and MIT (dsh-anchored-standard); bundled MathJax/mhchem are Apache-2.0
- DeepSeek Harness: MIT, Copyright (c) 2026 DeepSeek

Only branding strings, the splash art slot, the profile-state path and a
read-only Skills-update presentation bridge are patched. Chat, streaming,
tools, sessions, approvals, model pickers, keyboard handling and all image
features stay upstream. Upstream copyright is retained.

Full upstream license and notice texts are in
[`docs/licenses/`](docs/licenses/), with provenance and dependency-license
details in [`docs/third-party-notices.md`](docs/third-party-notices.md). The
app-local [`LICENSE`](LICENSE) reproduces the repository MIT terms.

## Layout

```
apps/tui/
├── src/brand.json          single brand-data source (words, pink, upstream pin)
├── src/hyperaiSkills.js    TUI bridge: async check + managed-dialog install
├── src/hyperaiSkillsCore.js offline copy/fingerprint helpers
├── scripts/build-patch.mjs build the pnpm patch from src/brand.json
├── scripts/verify.mjs      offline distribution checks
├── patches/                committed generated patch
├── tests/                  branding contract tests
├── LICENSE                 MIT terms for the HyperAI additions
├── docs/branding.md        brand decisions and splash layout behaviour
├── docs/verification.md    automated + real-terminal verification record
├── docs/compatibility.md   DSH Core / dsh-tui compatibility and upgrade policy
├── docs/third-party-notices.md  upstream / dependency compliance record
└── docs/licenses/          upstream MIT, third-party and MathJax notices
```
