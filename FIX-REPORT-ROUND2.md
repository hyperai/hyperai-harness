# HyperAI Harness — Round 2 QA Fix Report

- **Round 2 QA baseline:** `0d98839a532dc5f2b6be47acaa210540296dbb6c`
- **Branch:** `feat/hyperai-tui-profile`
- **Round 2 fix commit:** `528010eaf`
- **Report commit:** this file's commit
- **Scope:** `apps/tui/` and `apps/profiles/hyperai/` only; original Round 1 report and QA evidence untouched.
- **Conclusion:** Developer self-test completed. **NOT independent QA acceptance.** Round 3 remains PENDING with the original QA Agent A/B.

## Status by Round 2 ID

| ID | Priority | Status | Result |
|---|---|---|---|
| R2-01 | P1 | FIXED | `execFileSync` with ignored stdout no longer calls `.trim()` on `null`; real authenticated default install in an isolated `DSH_HOME` completed with `completed/done`, a managed LICENSE, one verified Skill and a valid manifest. Added a `file://` bare-remote test that does not use `--source`. |
| R2-02 | P3 | FIXED (developer evidence) | 120/110/80/56-column real PTY evidence in `apps/tui/docs/screenshots/real/terminal-width-*.txt`: workspace/version rows stack at <110 columns; product version stays readable and no longer collides. Exact QA terminal certificate remains for Round 3. |
| R2-03 | P2 | FIXED | CLI dry-run now exits 0 with and without `--json`; regression test checks no profile write. |
| R2-04 | P2 | FIXED | Installer state records pid/runtime; `doctor` reports `installing` + dead pid as interrupted and points to `repair`. Real SIGINT regression test added. |
| R2-05 | P3 | FIXED | `doctor` uses the explicit `--dsh-bin`; last install records the chosen binary and warns when it differs. Test added. |
| R2-06 | P3 | FIXED | Plugin comment now says provider/model setup is native `/provider` and `/model`, not environment-config. |
| R2-07 | P2 | FIXED | Two-stage uninstall: first removes managed runtime files and writes `.hyperai-uninstall.json`; second `--purge` is allowed and removes the profile. Test added. |
| R2-08 | P2 | FIXED | Legacy skill swap now writes a per-skill journal before rename; next run recovers/repairs stale manifest and preserves user extras. Test simulates SIGKILL between rename and manifest, then installs v3. |
| R2-09 | P2 | FIXED | `check --json` no longer includes the full plan; TUI child stdout cap is 8 MB with an explicit too-large error instead of silent truncation. Real private check returned a 273-byte compact payload. |
| R2-10 | P2 | FIXED | `LICENSE` is staged into the managed profile and checked by `verifyInstall`; real isolated cold install contains `LICENSE` with the MIT/DeepSeek notice. |
| R2-11 | P2 | FIXED | Dependency install snapshots previous `node_modules`, restores it on failed branding verification, and quarantines the failed tree. Test added. |
| R2-12 | P3 | FIXED (developer evidence) | Chat header version is `v0.2.0`; whale intro/click Tips removed; Settings labels mark upstream art/brand toggles as HyperAI-inactive. QA Round 3 must recheck. |
| R2-13 | P3 | FIXED (code) | Updater git timeout/permission errors now include network/proxy/auth/retry/`--source` guidance. |
| R2-14 | P3 | FIXED | YAML comments immediately above a user block are retained through merge; round-trip idempotency test added. |
| R2-15 | P3 | FIXED | Cold `--frozen-lockfile` without a profile lock fails before writes with the initialization order; no silent fallback. Test added. |
| R2-16 | P3 | ACCEPTED LIMITATION | `pnpm --version` may bootstrap a Corepack shim into `HOME`; documented as a host toolchain side effect. Use preinstalled pnpm or disposable HOME; zero-HOME-write is not promised. |
| R2-17 | P3 | PARTIAL / SUPPORT BOUNDARY | `install.mjs --json` keeps dependency progress off stdout; non-TTY TUI startup remains upstream dsh-tui behavior. Documented; no upstream fork. |

## Verification evidence

Development self-test (not QA acceptance):

```text
node apps/tui/scripts/verify.mjs              -> 13/13 PASS
node --test apps/tui/tests/                   -> 13/13 PASS
node apps/profiles/hyperai/scripts/verify.mjs -> 12/12 PASS
node --test apps/profiles/hyperai/tests/      -> 59/59 PASS
```

- Real authenticated default install in an isolated `DSH_HOME` (real user HOME only for existing git credentials):
  - exit 0;
  - managed profile state `completed` / `done`;
  - `LICENSE` present;
  - one verified Skill installed with manifest and pinned SHA `24adeeff...`;
  - real private-repo `skills-update.mjs check --json` returned a compact 273-byte payload, no full plan.
- Generated TUI patch:
  `78,614 bytes / 72,577 code points / 15 upstream files`.
- Real PTY width evidence: `apps/tui/docs/screenshots/real/terminal-width-{56,80,110,120}.txt`.
- Real Orca checks from Round 2 development: `/update` disabled message, branded Settings labels, solid wordmark and product version.
- No user provider, credentials or sessions were modified in the isolated install; only the real managed TUI patch/package was refreshed during actual-terminal validation, with backups under `~/.dsh/profiles/hyperai/.hyperai-backups/`.

## Remaining for Round 3 / QA

- **R2-01 real private-Skills default install** was executed successfully on this Mac in an isolated `DSH_HOME`; QA must repeat independently with their own HOME/credential setup.
- **R2-02 exact 56/80/110/120 terminal matrix** is developer PTY evidence; QA must verify no overlap/product-version readability on their terminals.
- **R2-07 two-stage uninstall**, **R2-08 real process SIGKILL** (this round used injected journal state plus real SIGINT for the installer), **R2-11 real wrong-patch install**, **R2-13 real network timeout**, and **R2-17 non-TTY TUI** still need independent QA evidence.
- QA-002 remains an accepted private-Skills limitation; no auth/visibility/URL/lock/distribution changes.
- QA-014 Skills repository license remains a company decision; R2-10 Profile LICENSE is fixed separately.
- QA-020 tool-ralph and QA-024 API-key echo remain upstream limitations.
- No merge, no Ready-for-review, no new PR.
