# HyperAI Harness — Unified QA Fix Report

- **QA baseline:** `85b5cde463cb9e178f7cc57849b02e86927e2541`
- **Repair branch:** `fix/hyperai-unified-qa`
- **Fix commit:** `89b416406`
- **Base:** `feat/hyperai-tui-profile` / PR #1 (Draft, not modified by this branch)
- **Scope:** `apps/tui/` and `apps/profiles/hyperai/` only. No push / no PR / no merge was performed by this repair branch; no real `~/.dsh` user data or credentials were modified.
- **Evidence:** local fixture tests, fake-runtime tests for version refusal, and actual Orca/TUI checks on macOS. QA original reports were used only as the unified index; no QA evidence was rewritten.

## Status by QA-ID

| ID | Priority | Status | Short result |
|---|---|---|---|
| QA-001 | P1 | FIXED | DSH Core validated-version preflight refuses unsupported lines (e.g. `0.2.1-rc.5`) before writing; no bypass flag |
| QA-002 | DEFERRED | ACCEPTED LIMITATION | Private Skills repository untouched: no visibility, URL, lock-ref, auth or distribution changes |
| QA-003 | P1 | FIXED | `installSkills` normalizes partial installer options; default path no longer throws undefined `skillsDir`; full local-fixture install exits successfully |
| QA-004 | P1 | FIXED | Legacy rollback restores manifest together with files; backup snapshots carry manifest |
| QA-005 | P1 | FIXED | Node/pnpm preflight before writes; Node 18/20/23 and missing pnpm produce actionable errors |
| QA-006 | P2 | FIXED | Legacy updates preserve files not owned by the manifest, including files inside `references/` |
| QA-007 | P2 | FIXED | Fingerprint comparison only considers manifest-owned files; user extras no longer block updates |
| QA-008 | P2 | FIXED | Legacy/updater backups share manifest+meta format; old no-meta snapshots are migrated on rollback |
| QA-009 | P2 | FIXED | Installer writes `.hyperai-install.json` phases; failed phase is diagnosable and `repair` can retry |
| QA-010 | P2 | FIXED | `/update` no longer invokes the upstream updater; it points to the HyperAI installer/release flow |
| QA-011 | P2 | FIXED (code) | `core.validated` matrix + installer guard + compatibility doc; CI alarm remains a follow-up |
| QA-012 | P2 | FIXED (minimal) | Added `manage.mjs status/doctor/repair/uninstall`; default uninstall archives data and preserves shared credentials |
| QA-013 | P2 | FIXED | Legacy clone/checkout has a bounded timeout and actionable error; updater already had one |
| QA-014 | P2 | PARTIAL / NEEDS COMPANY | TUI upstream notices and Profile MIT license added; private `hyperai-skills` repository has no LICENSE file and must be confirmed before public distribution |
| QA-015 | P2 | FIXED | Profile lock/upgrade policy documented; `--frozen-lockfile` opt-in + `dependencyInstallArgs` test; user config merge preserved |
| QA-016 | P3 | FIXED (labels/title) | Removed whale terminal-title glyph; settings labels explicitly mark upstream mascot/brand controls as not used; version plate distinguishes product/upstream |
| QA-017 | P3 | PARTIAL / NEEDS QA | Version plate now shows `hyperai-tui v0.2.0 · dsh-tui v0.16.1`; exact 56/80/120-column matrix not independently rerun |
| QA-018 | P3 | FIXED | Repeated `mergeCordisPatch` normalizes trailing blank lines; regression test added |
| QA-019 | P3 | FIXED | README/docs updated with prerequisites, verified-only default, lifecycle, isolation, lock and update policy |
| QA-020 | P3 | NOT FIXED / upstream | `tool-ralph` entry is an upstream dsh-tui/package boundary; recorded as known limitation |
| QA-021 | P3 | FIXED (prior commit) | Persistent `/skills-update` checking/result dialogs remain; this branch keeps the tests |
| QA-022 | P3 | FIXED | Default installer is verified-only; `--include-unverified` is explicit for experimental inbox candidates |
| QA-023 | P3 | FIXED | README documents `HOME` + `DSH_HOME` double isolation and per-profile UI state |
| QA-024 | P3 | ACCEPTED LIMITATION / upstream | Provider API-key echo is upstream UI behavior; recorded, not forked |

## Key implementation details

### QA-001 / QA-005 — environment gate

- New [`apps/profiles/hyperai/scripts/preflight.mjs`](apps/profiles/hyperai/scripts/preflight.mjs)
  - Node range `^22.19 || >=24`
  - executable `dsh --version` probe
  - executable `pnpm --version` probe
  - `brand.core.validated` allow-list from
    [`apps/tui/src/brand.json`](apps/tui/src/brand.json)
- `install.mjs` runs the gate before `mkdir`, staging or `dsh plugin`.
- Fake-runtime tests cover `0.2.1-rc.5` refusal and a supported `0.2.0-rc.2`.
- No `--accept-risk` or silent version bypass exists.

### QA-003 / QA-004 / QA-006 / QA-007 / QA-008 / QA-013 — legacy skills path

- [`install-skills.mjs`](apps/profiles/hyperai/scripts/install-skills.mjs) now:
  - normalizes partial options (`dshHome`/`profile` → `skillsDir`, `stateDir`, `manifestPath`);
  - compares only manifest-owned files when deciding if a user modified a managed skill;
  - preserves extra files during the staged directory swap;
  - plans a pre-change snapshot with manifest + `meta.json`;
  - delegates rollback to the shared manifest-aware implementation;
  - uses bounded git timeouts.
- [`skills-lib.mjs`](apps/profiles/hyperai/scripts/skills-lib.mjs) migrates old
  snapshots that lack `meta.json`/`manifest.json` instead of rejecting them.
- Tests: local git fixture for install → update with user extra → rollback;
  legacy snapshot compatibility; timeout injection; missing-resource safety.

### QA-009 / QA-012 — lifecycle

- `install.mjs` writes atomic `.hyperai-install.json` phases
  (`files` → `dependencies` → `verify` → `skills` → `done`, or `failed` with phase/error).
- New [`manage.mjs`](apps/profiles/hyperai/scripts/manage.mjs):
  - `status` — read-only profile/TUI/core/skills summary
  - `doctor` — Node/pnpm/Core/managed profile/patch/skills/pending journal diagnostics
  - `repair --yes` — reruns the idempotent installer
  - `uninstall [--yes] [--purge]` — archives user data before removing installer-owned files;
    shared credentials are never touched.
- Real profile check: `status` reports managed/completed; `doctor` returns OK.

### QA-010 / QA-016 / QA-017 — TUI boundary and branding

- `/update` now returns an explicit HyperAI message instead of running the upstream updater.
- Terminal title no longer contains the whale glyph.
- `/settings` labels upstream header-art, maid-portrait, welcome-animation and
  brand-look controls as not used by HyperAI; splash-font hint explains the
  solid-bold pin.
- Version plate distinguishes HyperAI product version from upstream dsh-tui.
- Actual Orca checks: fresh profile showed `/update` message, settings labels,
  solid wordmark and version plate; full-width footer remained readable.
- 56/80/120-column exact matrix remains a QA follow-up.

### QA-014 / QA-019 / QA-022 / QA-023 — compliance and docs

- Added Profile [`LICENSE`](apps/profiles/hyperai/LICENSE) and `"license": "MIT"`.
- TUI upstream MIT/BSD/MathJax notices were already added on the QA baseline;
  Profile README now records the missing private Skills repo license as a blocker
  for public distribution.
- Default install is verified-only; `--include-unverified` opts into inbox
  candidates; docs state the private-repository limitation explicitly.
- README documents `HOME` + `DSH_HOME` isolation; uninstall archiving and
  shared-credential boundary.
- `QA-002` remains untouched as required: repository visibility/URL/lock ref/
  authentication/distribution were not changed.

## Verification commands and results

```text
node apps/tui/scripts/verify.mjs              -> 12/12 PASS
node --test apps/tui/tests/                   -> 13/13 PASS
node apps/profiles/hyperai/scripts/verify.mjs -> 12/12 PASS
node --test apps/profiles/hyperai/tests/      -> 49/49 PASS
```

- Deterministic patch build:
  `build-patch.mjs` exit 0; patch SHA256
  `ea68d6b2ed3a3cfb01ef2f55f80439b769ffc6e682c55798718203712a08ba99`.
- Full install integration with a local skills fixture + stubbed `dsh`:
  success, verified-only default, manifest, skill files and `completed` state.
- Failed install integration: `.hyperai-install.json` records `failed` phase/error.
- Real profile: `manage.mjs status` → managed/completed; `doctor` → OK.
- Actual Orca TUI: `/update` disabled message, branded settings labels,
  solid wordmark, version plate. No real user Skills install/update was run in
  this repair round (QA-002 private-repo authorization still user-owned).

## Remaining blockers / NEEDS QA

- **QA-014:** private `hyperai/hyperai-skills` has no LICENSE file; company must
  confirm/add the license and attribution before any public redistribution of
  installed skills. Current private/Internal use remains within the accepted
  limitation.
- **QA-017:** exact 56/80/120-column matrix on all target terminals is not yet
  independently rerun; current evidence is full Orca/ Terminal.app and the
  documented upstream fallback.
- **QA-020 / QA-024:** upstream `tool-ralph` warning and provider API-key echo
  remain upstream responsibilities; documented, not silently patched.
- QA-001/005 tests use a fake `dsh` executable for the version combinations; a
  real Node 18 and real rc.5 binary environment is still a QA-environment task.
- End-to-end real private Skills default install/update on the user's logged-in
  Mac and OpenBayes Linux, plus Windows/Linux compatibility, remain for the two
  independent QA agents.
- No change to the Draft PR #1; this repair branch has not been pushed.
