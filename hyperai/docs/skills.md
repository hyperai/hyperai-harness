# hyperai-skills integration

## What the repository actually contains

Pinned source: `https://github.com/hyperai/hyperai-skills.git` at commit
`24adeeff371290fab0c15691ab2efb7382e2262e` (branch `master`, see
`../skills/hyperai-skills.lock.json`). The repo separates "verified" from
"unverified" **by directory** (`README.md`, `CONTRIBUTING.md`):

| Area | Skill | Status | Runtime needs |
|---|---|---|---|
| `skills/` | `example-verified-skill` | repo-verified (documentation template) | none |
| `inbox/` | `mineru-ocr` | unverified candidate | Python, openpyxl, network, `MINERU_API_KEY` / `MINERU_BASE_URL` |
| `inbox/` | `mineru-ocr-to-xlsx` | unverified candidate (prompt-only walkthrough) | openpyxl + a MinerU JSON input |
| `inbox/` | `playwright-browser` | unverified candidate | Playwright + Chromium (~150 MB), network |

The repo's Hermes tap (`skills.sh.json`, `tools/skills_hub.py`) only serves
`skills/`; it is not used here. The DSH installer reads the lock file, not the
tap.

## How DSH discovers skills

- Service: `dsh-skill` (`ctx.skills`, name pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`).
- Provider: `dsh-skill-filesystem`, configured in the profile's
  `cordis.patch.yml`. Roots and ranks: project `.dsh/skills` (100), project
  `.agents/skills` (200), `customSkillDirs` (300), `$DSH_HOME/skills` (400),
  `~/.agents/skills` (500), bundled (600).
- Layout: exactly one level — `<root>/<name>/SKILL.md` (or `<root>/<name>.md`).
- Frontmatter: required `name` (kebab-case, must match the directory) and
  `description`; optional `whenToUse`, `metadata`, `disable-model-invocation`,
  `user-invocable`. Unknown keys are ignored; Hermes-only keys need no
  adaptation. (Legacy camelCase booleans would drop the skill — the installer
  validates with `validateSkill`.)
- Consumer: the `skill` model tool (`dsh-tool-skill`) exposes the catalog and
  body loader.

The `dsh-tui` bundle disables the host-level skill rows because its agent
presets own per-agent discovery. The HyperAI profile re-enables the **host**
`skill-filesystem` row with a `customSkillDirs` entry (rank 300, global layer);
each agent reads the merged preset + global catalog. Installed skills are
profile-scoped: `<profile>/skills/<name>`.

## Install, update, rollback

```sh
node scripts/install-skills.mjs [--dsh-home <dir>] [--profile hyperai]
                                [--ref <sha>] [--source <checkout>] [--verified-only]
                                [--dry-run] [--rollback] [--json]
```

- Default set: every skill in the lock (verified first, then the three inbox
  candidates, each recorded with `validated: true|false`); `--verified-only`
  installs just `skills/`.
- Source checkout is pinned and verified: `git clone` → `git checkout --detach
  <ref>` → `rev-parse HEAD` must equal the pin. `--source <dir>` installs from an
  existing checkout after checking its HEAD against the pin (offline path; used
  for this machine's installation when the clone network timed out).
- Only each skill's `SKILL.md` plus its `references/ templates/ scripts/ assets/
  examples/` files are copied. `NOTES.md`, `docs/`, `tests/`, and the rest of
  the repository are never copied.
- Manifest: `<profile>/.hyperai-skills/manifest.json` records the ref, the
  `validated` flag, every file's sha256, and the install time. History appends
  to `history.log`.
- Safety: installed skill content that no longer matches the manifest is
  **skipped, never overwritten** (`--rollback` restores the newest backup);
  replaced directories are copied to `.hyperai-skills/backups/<timestamp>/`
  first; the swap is a staging directory renamed into place.
- Update: pass a newer `--ref` (and update the lock after review). Identical
  content reports `noop`.

## Validation performed here

- Repository validator (`scripts/validate_skill.py --all`): 0 errors, 5
  warnings.
- Repository LLM test runner (`tests/run_tests.py --all --dry-run`): 12/12.
- All four `SKILL.md` files parse through the real `dsh-skill` /
  `dsh-skill-filesystem` packages (4/4 model-invocable; body loads).
- The installed profile reports the skills in its loaded-context line — `技能 4`
  on a clean Harness home, `技能 10` on this Mac because the agent preset also
  discovers six pre-existing `~/.agents/skills` entries; a live model turn listed
  every name and loaded `mineru-ocr-to-xlsx` through the `skill` tool.
- `mineru-ocr` conversion script actually executed on a synthetic MinerU
  payload: produced an xlsx with `A3:A4` merged, `m²` LaTeX cleanup, and
  `2,550 → 2550`.

## Not tested / known issues

- **NOT TESTED:** live MinerU OCR API (`MINERU_API_KEY` is absent from the
  environment and from `~/.hermes/.env`), `playwright-browser` (no Playwright
  or Chromium here), and the repository's LLM-judged test suite.
- `mineru-ocr` hardcodes an internal MinerU endpoint and reads
  `~/.hermes/.env`; it is a Hermes-era skill, usable but not DSH-native.
- Duplicate `mineru-ocr` step 6 logic in `mineru-ocr-to-xlsx`.
- Upstream parser bug found while testing: all three MinerU parsers only handle
  `<td>` cells, so `<th>` header cells are silently dropped. This belongs to
  the skills repository, not to this kit.
- `playwright-browser` writes outside the workspace; running it needs a
  wider sandbox than `workspace-write`.
