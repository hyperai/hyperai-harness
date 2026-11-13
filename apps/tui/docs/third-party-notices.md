# Third-Party Notices — HyperAI TUI

This file records the upstream project and third-party material used by the
HyperAI TUI distribution under `apps/tui/`. It is an engineering compliance
record, not a substitute for legal review.

## 1. Upstream project

| Field | Verified value |
| --- | --- |
| Project | dsh-TUI |
| Repository | <https://github.com/ccch1mneyyy/dsh-TUI> |
| Version used | `v0.16.1` |
| Tag commit | `73ff99fbed56563bf154d719effd09f9f9725349` |
| npm package | `@deepseek-harness-tui/dsh-tui@0.16.1` |
| npm `license` field | `MIT` |
| Upstream copyright | Copyright (c) 2026, chimney (ccch1mneyyy) |
| Upstream license | MIT — full text in [`licenses/dsh-tui-0.16.1-LICENSE.txt`](licenses/dsh-tui-0.16.1-LICENSE.txt) |

The npm package metadata, its tarball (including `package/LICENSE`), and the
GitHub `LICENSE` at tag `v0.16.1` were checked against each other. The tarball
carries `package/LICENSE` for the upstream project and license files for its
bundled dependency/vendor subtrees. It does **not** contain the repository-level
`THIRD_PARTY_LICENSES` file (the BSD-3-Clause dsh-ui-whale and MIT
dsh-anchored-standard notices); that omission is why those notices are
reproduced independently in this directory.

### Upstream third-party portions

The upstream project's `THIRD_PARTY_LICENSES` (fetched from tag `v0.16.1`)
records derived material:

- **dsh-ui-whale** — Copyright (c) 2026 lhh010, BSD-3-Clause; pixel-whale
  frames and settled-header idle behaviors.
- **dsh-anchored-standard** — Copyright (c) 2026 xiaobright; portions
  Copyright (c) 2026 DeepSeek; MIT.

The full upstream notice text is preserved verbatim in
[`licenses/dsh-tui-0.16.1-THIRD_PARTY_LICENSES.txt`](licenses/dsh-tui-0.16.1-THIRD_PARTY_LICENSES.txt).

The upstream `tui-profile/` directory carries its own MIT notice for the dsh
ecosystem community contributors; it is preserved in
[`licenses/dsh-tui-0.16.1-tui-profile-LICENSE.txt`](licenses/dsh-tui-0.16.1-tui-profile-LICENSE.txt).

### Bundled MathJax

Upstream's npm tarball contains the `@dsh-tui-vendor/mathjax-tex-svg` bundle.
It is Apache-2.0-licensed and carries this attribution:

- MathJax (`mathjax-full` 3.2.2) — Copyright (c) 2009-2022 The MathJax
  Consortium — Apache-2.0.
- mhchemParser (`mhchemparser` 4.2.1) — Copyright (c) 2015-2023 Martin Hensel —
  Apache-2.0.

The upstream notice is preserved in
[`licenses/mathjax-tex-svg-NOTICE.txt`](licenses/mathjax-tex-svg-NOTICE.txt)
and the full Apache-2.0 text carried by the package is preserved in
[`licenses/mathjax-tex-svg-LICENSE.txt`](licenses/mathjax-tex-svg-LICENSE.txt).
The upstream `lib/index.mjs.LEGAL.txt` remains inside the installed npm package;
HyperAI does not relicense or modify that bundle. The vendor source is not
copied into this repository; the profile installs the pinned npm package, which
retains its license/notice files.

## 2. Direct runtime dependencies of dsh-tui 0.16.1

These are declared by the upstream package and are installed with it. The
audit of the installed profile found only the following license families:

| License | Packages |
| --- | --- |
| MIT | `@alcalzone/ansi-tokenize`, `auto-bind`, `bidi-js`, `chalk`, `cli-boxes`, `code-excerpt`, `emoji-regex`, `figures`, `get-east-asian-width`, `indent-string`, `lodash-es`, `marked`, `react`, `react-reconciler`, `sixel`, `stack-utils`, `strip-ansi`, `supports-hyperlinks`, `usehooks-ts`, `wrap-ansi`, `ws`, `zod` |
| ISC | `cli-highlight`, `semver`, `signal-exit`, `yaml` |
| BSD-3-Clause | `diff`, `dsh-working-activity`, `highlight.js` |
| Apache-2.0 | `lovely-mermaid` |
| MIT OR CC0-1.0 | `type-fest` |

All of these are permissive and compatible with the repository's MIT license.
Their own license files are installed with the packages; the profile's pnpm
lockfile records the exact resolved versions and the npm tarball carries the
bundled-vendor licenses. No GPL/AGPL/SSPL or other copyleft-only dependency was
found in the upstream runtime dependency set.

The upstream `devDependencies` are not part of the HyperAI patch or of the
installed runtime and are not redistributed by this repository.

## 3. DeepSeek Harness and HyperAI code

- DeepSeek Harness itself is MIT-licensed; Copyright (c) 2026 DeepSeek. The
  repository root [`LICENSE`](../../../LICENSE) remains authoritative.
- HyperAI's own TUI bridge, brand configuration, patch builder, tests and
  documentation are distributed under the same MIT terms; the app-local
  [`LICENSE`](../LICENSE) is provided for installations that copy this directory
  out of the monorepo.
- HyperAI additions are limited to brand strings/colors, splash-layout
  adjustments, the Skills update presentation bridge, and the reproducible
  patch builder. The chat renderer, agent loop, tools, model providers,
  sessions and upstream image features are not reimplemented.

## 4. Modification and redistribution obligations

The HyperAI TUI patch modifies upstream MIT-licensed source. MIT requires the
upstream copyright and permission notice to accompany copies or substantial
portions of the software. Accordingly this repository redistributes:

- the full upstream MIT license text;
- the upstream third-party notice text (BSD-3-Clause and MIT portions);
- the upstream `tui-profile` MIT notice; and
- the MathJax/mhchem attribution notice carried by the upstream package.

The patch and the upstream license texts are shipped together under
`apps/tui/docs/licenses/`. Upstream copyright is not removed or replaced, and
HyperAI does not claim authorship of the original dsh-TUI code. The upstream
GitHub and npm links are also listed in [`../README.md`](../README.md).

## 5. Review record

- Reviewed on: 2026-11-02 (Asia/Shanghai).
- Sources checked: GitHub repository metadata and tag `v0.16.1`, raw upstream
  `LICENSE`/`THIRD_PARTY_LICENSES`/`tui-profile/LICENSE`, npm metadata for
  `@deepseek-harness-tui/dsh-tui@0.16.1`, and the published npm tarball.
- Result: source-code license review passes for MIT-compatible modification and
  redistribution, subject to retaining the notices above and to normal legal
  review before a public release.
- Known upstream packaging observation: the 0.16.1 npm tarball includes
  `package/LICENSE` and bundled dependency/vendor licenses, but not the
  repository-level `THIRD_PARTY_LICENSES` file. That notice is therefore
  preserved here independently.
