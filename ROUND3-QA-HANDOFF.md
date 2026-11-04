# ROUND3 — QA Handoff

## Fixed code SHA

- Round 3 QA target: `f4d6d0c731f830ece866b6bfd5cdc1a10e176edb`
- Round 3 development fix commit: `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`
- Reports are committed separately after the code commit. QA must check out the
  final `feat/hyperai-tui-profile` HEAD reported in Draft PR #1 (not the old
  Round 3 SHA).
- PR: https://github.com/hyperai/hyperai-harness/pull/1
- Branch: `feat/hyperai-tui-profile`; must remain Draft/Open/Unmerged.

## Mandatory targeted re-test

1. Check out the final HEAD; `git status --porcelain` must be empty.
2. `node apps/tui/scripts/verify.mjs` and `node --test apps/tui/tests/`.
3. `node apps/profiles/hyperai/scripts/verify.mjs` and
   `node --test apps/profiles/hyperai/tests/`.
4. Run `node --test apps/profiles/hyperai/tests/crash.test.mjs` repeatedly
   (at least 5 times). It must hit a real child SIGSTOP/SIGKILL MID-SWAP state,
   restore the old tree, preserve all 24 user extras, converge manifest/file
   hashes, and succeed on v2/v3.
5. Re-run the six canonical legacy kill points plus the new MID point with real
   child processes. Do not accept journal-only simulation as the P1 evidence.
6. Validate `install.mjs --json` non-dry-run success and failure; stdout must be
   exactly one JSON document. Validate `skills-update check --json` success and
   git-timeout/auth errors; stdout must remain structured and exit codes stable.
7. Validate two-stage uninstall archive README and failed dependency tree cleanup
   after repair.
8. Re-run real Terminal.app / Orca TUI checks: Splash font label, product title,
   `/update`, Settings labels, 56/80/110/120 widths. 56 columns intentionally
   shows the compact product label only; do not force full upstream version.
9. Re-run Linux on the available OpenBayes environment; Windows remains
   NOT TESTED unless a real Windows host is used.

## Accepted limitations / product decisions

- **QA-002:** `hyperai/hyperai-skills` stays private. Do not change visibility,
  URL, lock ref, auth or distribution. Authorized macOS install/update/rollback
  must still work.
- **QA-014:** private Skills repository LICENSE/ownership remains a company
  decision; Profile MIT license is fixed and installed.
- **QA-020 / QA-024:** tool-ralph warning and provider API-key echo are upstream
  limitations; not forked.
- **QA-017 / 56 columns:** compact `hyperai v0.2.0` is intentional; full
  `hyperai-tui` + `dsh-tui` pair is certified at 80+ columns.
- **R2-16:** Corepack/pnpm may write to HOME; use a disposable HOME/preinstalled
  pnpm; zero-HOME-write is not promised.
- **R2-17 / non-TTY TUI:** TUI requires a real TTY/PTY; headless TUI is upstream
  behavior. Use CLI `--json` for automation.
- **D2 temp clone leak:** SIGKILL can leave `/tmp/hyperai-skills-*`; low-risk,
  not auto-cleaned; do not treat as normal shutdown behavior.
- **Six canonical kill points:** code fixes and tests target the MID state; Agent
  B deep report has external real evidence for canonical points. QA must rerun
  all points on the final SHA.

## Evidence index

### Source repository reports

- `ROUND3-UNIFIED-QA.md`
- `ROUND3-FIX-REPORT.md`
- `ROUND3-REGRESSION-RESULTS.md`
- `ROUND3-SKILLS-CRASH-RECOVERY.md`
- this handoff

### Original QA evidence (read-only, not overwritten)

- Agent B first review: `/Users/zhenhaoli/Downloads/hyperai-round3-b-qa/ROUND3-B/`
- Agent B deep review: `/Users/zhenhaoli/Downloads/hyperai_review/r3b/reports/` and `/Users/zhenhaoli/Downloads/hyperai_review/r3b/evidence/`
- Agent A detailed reports: **not found in the current workspace**; only the
  task-provided summary (READY WITH LIMITATIONS, four P3, no P0/P1/P2) was used.
  QA handoff must not claim Agent A files were read.

### Development commands and observed results

```text
TUI verify            13/13 PASS
TUI tests             13/13 PASS
Profile verify        12/12 PASS
Profile tests         67/67 PASS
MID-SWAP crash test   PASS, repeated 10/10
Linux x86_64 Node 24  TUI 13/13; profile 64 pass/0 fail/2 skipped
Actual full install   exit 0; completed/done; LICENSE; 1 verified skill
Actual --json stdout  1576 bytes, valid JSON, no pnpm Progress on stdout (final isolated run)
```

## Final QA status

**PENDING.** This handoff requests an independent final targeted QA round by
Agent A and Agent B. Development self-test is not acceptance. Agent B deep
NOT READY/BUG-R3B-01 remains the historical conclusion for SHA `f4d6d0c`;
the new code commit is not READY until both QA agents re-test it independently.
