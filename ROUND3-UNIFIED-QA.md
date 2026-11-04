# ROUND3 — Unified QA Analysis

## 1. Scope and evidence availability

- Repository: https://github.com/hyperai/hyperai-harness
- Draft PR: https://github.com/hyperai/hyperai-harness/pull/1
- Branch: `feat/hyperai-tui-profile`
- Round 3 tested SHA: `f4d6d0c731f830ece866b6bfd5cdc1a10e176edb`
- Round 3 development fix commit: `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`
- This document consolidates the available Round 3 evidence. It does not overwrite any original QA report.

### Reports actually read

- **QA Agent B, first review**: `FINAL-REPORT-ROUND3-B.md`, `BUGS-ROUND3-B.md`, `FIX-VERIFICATION-ROUND3-B.md` and companion reports in `/Users/zhenhaoli/Downloads/hyperai-round3-b-qa/ROUND3-B/`. Conclusion: **INSUFFICIENT EVIDENCE**.
- **QA Agent B, deep review**: `/Users/zhenhaoli/Downloads/hyperai_review/r3b/reports/` (`FINAL-REPORT-ROUND3-B.md`, `BUGS-ROUND3-B.md`, `SKILLS-RESULTS-ROUND3-B.md`, etc.). Conclusion: **NOT READY**, BUG-R3B-01.

### Reports not accessible

- Agent A's detailed files (`FINAL-REPORT-ROUND3-A.md`, `BUGS-ROUND3-A.md`, `FIX-VERIFICATION-ROUND3-A.md`, `INSTALLATION-ROUND3-A.md`, `LIFECYCLE-ROUND3-A.md`, `LINUX-RESULTS-ROUND3-A.md`, `MACOS-RESULTS-ROUND3-A.md`, `VERSION-COMPATIBILITY-ROUND3-A.md`) were **not found** in the current workspace or the searched QA directories.
- Only Agent A's summary supplied with the task is used here: **READY WITH LIMITATIONS**, four P3 findings, no P0/P1/P2. No Agent A detail is invented.
- This is recorded as an evidence-access limitation, not as agreement or disagreement with Agent A.

## 2. Why Agent A passed R2-08 while Agent B failed it

- Agent A tested the six canonical legacy-Skills interruption points and found them safe.
- Agent B additionally froze the **two-rename MID window**: old `<skill>` renamed to `staging/<skill>-old-*`, new staging not yet renamed to `<skill>`, process SIGKILLed.
- In that state the target is absent, the only complete old tree is `oldPath`, and the old code's recovery called `digestSkill(target)`; ENOENT was swallowed, the journal was skipped, `planSkill` treated the skill as a fresh install, extras were not carried over, and `staging` was later deleted. User extras were lost with exit 0.
- Agent A's canonical-point result remains true for its tested scope. Agent B's evidence adds a real boundary defect. The correct reclassification was **R2-08 = FAIL** until the MID state was repaired; that is why the unified Round 3 status was NOT READY.
- After the fix in this round, R2-08 is **FIXED — pending independent re-test**, not self-certified PASS.

## 3. Consolidated issue status

| Issue | Source | Severity | Development status |
|---|---|---|---|
| BUG-R3B-01 legacy MID-SWAP silent user-file loss | Agent B deep | **P1 release blocker** | **FIXED** (real SIGKILL regression added) |
| BUG-R3-01 / BUG-R3B-02 `install.mjs --json` pnpm progress on stdout | Agent A/B | P3 | **FIXED** (stdout JSON-only, explicit failure envelope) |
| BUG-R3-04 `skills-update check --json` unstructured errors | Agent B | P3 | **FIXED** (stable error envelope, nonzero exit) |
| BUG-R3-02 uninstall archive lacks restore instructions | Agent A/B | P3 | **FIXED** (archive README + user docs) |
| BUG-R3-03 failed dependency tree not cleaned after repair | Agent A/B | P3 | **FIXED** (cleanup only after verified success; doctor warning) |
| BUG-R3B-03 Splash font not labeled/fixed | Agent B deep | P3 | **FIXED** (label + visible option text + hint; real PTY check) |
| BUG-R3B-04 title glyph/node-path noise | Agent B deep | P3 | **FIXED (small scope)** title now `HyperAI Harness · <session>`; shell integration may still add process text |
| D3 updater recovers after planning (one-run lag) | Agent B deep | Low | **FIXED** (recover before planning) |
| D2 temp clone leak after SIGKILL | Agent B deep | Low | **NOT FIXED / accepted low risk**; evidence preserved, document only |
| 56-column full upstream version disappears | Agent B deep | P3 | **ACCEPTED LIMITATION**; compact product label is intentional and documented |
| Non-TTY TUI hangs silently | Agent A/B | P3 upstream boundary | **DOCUMENTED / upstream**; TUI requires PTY |
| QA-002 private Skills | both | Accepted | unchanged |
| QA-014 Skills repository LICENSE | both | Company decision | unchanged |
| QA-020 tool-ralph | both | Accepted upstream | unchanged |
| QA-024 provider-key echo | both | Accepted upstream | unchanged |

## 4. Status of the original 17 R2 items after this round

| ID | Unified status | Note |
|---|---|---|
| R2-01 | FIXED, QA re-test required | prior real default install and file:// regression; no new defect |
| R2-02 | PARTIAL / accepted width limit | 120/110/80 pass; 56 compact product label |
| R2-03 | FIXED | dry-run retest |
| R2-04 | FIXED | SIGINT diagnostics |
| R2-05 | FIXED | doctor dsh-bin |
| R2-06 | FIXED | comment correction |
| R2-07 | FIXED | two-stage uninstall + archive instructions |
| R2-08 | **FIXED — independent re-test mandatory** | BUG-R3B-01 repaired; real MID-SWAP test |
| R2-09 | PASS/PARTIAL | compact payload; >8 MB TUI path still not dynamically certified |
| R2-10 | FIXED | profile LICENSE |
| R2-11 | FIXED with lifecycle cleanup | old tree restored; quarantines cleaned after successful retry |
| R2-12 | FIXED (developer evidence) | header/version/whales/Settings; Splash fix added |
| R2-13 | PARTIAL | timeout/auth guidance; no new code required |
| R2-14 | PASS | comments/provider config |
| R2-15 | PASS | frozen lock precheck |
| R2-16 | ACCEPTED LIMITATION | pnpm/Corepack HOME side effect |
| R2-17 | PARTIAL / upstream | JSON install fixed; non-TTY TUI remains upstream |

## 5. Original QA-001…QA-024 after this round

- QA-001, 003, 004, 005, 006, 007, 008, 009, 010, 012, 013, 015, 018, 019, 021, 022, 023: no new defect found in the available evidence; unchanged PASS from prior QA reports.
- QA-011: PASS per Agent B deep real version matrix; this developer round did not rerun every environment.
- QA-014: **NEEDS COMPANY DECISION**; private `hyperai-skills` LICENSE/ownership remains unresolved.
- QA-016: Splash font fixed; no whale/old brand; **QA re-check required**.
- QA-017: 120/110/80 fixed; 56 compact label accepted as a documented limitation.
- QA-020/024: accepted upstream limitations.
- QA-002: accepted private-Skills limitation; no visibility/URL/lock/auth/distribution change.

## 6. Development conclusion

All confirmed **reproducible, in-scope** defects, including the P1 data-loss boundary, have code changes and regression tests in commit `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`. This is **development self-test, not independent QA acceptance**. The two original QA reports remain untouched; the final status is for the next targeted QA round to determine.
