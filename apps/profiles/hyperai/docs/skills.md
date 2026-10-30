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

## Legacy installer (bootstrap and offline baseline)

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

This installer remains useful for the first install and for offline/reproducible
baselines. It is **not** the normal update path: its skill list comes from the
lock file, so a new upstream skill requires editing the lock and re-running the
installer. Use the updater below for discovery/update.

## Independent updater (`scripts/skills-update.mjs`)

`install.mjs` copies `scripts/skills-update.mjs` and `scripts/skills-lib.mjs`
into `<profile>/scripts/`, so after one install the user can update skills
without keeping the Harness checkout:

```sh
# from the installed profile (or from this checkout with --dsh-home ~/.dsh)
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs catalog
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs update --yes
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs rollback --list
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs rollback --yes

# test a development branch (explicit opt-in; marked prerelease/test)
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check \
  --ref feat/ppt-generation-upstream
```

Behavior:

- `check` is read-only. It resolves the requested ref to a commit (default
  `master`), scans `skills/**/SKILL.md` (recursively; `inbox/`, `.git`,
  `node_modules`, hidden/`_` dirs excluded), parses frontmatter, validates the
  package, and compares content digests with the manifest. It exits `2` when
  installable changes exist, `0` when there are none, `1` on an error.
- Nested categories are discovered recursively and flattened on install:
  `skills/productivity/excel/SKILL.md` becomes `<profile>/skills/excel/SKILL.md`
  because DSH only scans one level. Duplicate skill names in the remote tree are
  a hard error, never a silent overwrite.
- `update` re-resolves the ref, prints the plan, asks for confirmation unless
  `--yes`, then stages, verifies, backs up and atomically renames each skill;
  `--dry-run` prints without writing. `--skill <name>` limits one run.
- `catalog` is offline: it lists managed, legacy (from the old installer) and
  local-only skills, plus user-modified/managed-missing states.
- `rollback [--to <snapshot>]` restores a snapshot; the current state is backed
  up first. Added skills are removed only when unmodified; local-only and
  user-modified skills are kept.
- The source is pinned per operation to the resolved SHA; a non-`master` ref is
  recorded as `prerelease` in the manifest. Defaults never use a dev branch.

### Local file protection

- A manifest entry whose managed file digest changed is **skipped**
  (`local-modified`), never overwritten.
- A directory present without a manifest entry is `local-same-name` and is
  skipped (no silent overwrite).
- Files the user added inside a managed skill are preserved on update; a user
  file that collides with a new package path skips the update with
  `extra-file-conflict` rather than overwriting it.
- Skills removed upstream are kept (`remote-missing`), not deleted.
- The legacy 3 `inbox/` skills are reported as `legacy-unverified` and are left
  alone; the updater only reads upstream `skills/`.
- Installs are staged and renamed atomically with a journal under
  `.hyperai-skills/pending/`; `catalog`/`update` recover an interrupted swap
  before doing anything else. Backups under `.hyperai-skills/backups/` include
  a manifest snapshot and the previous skill directories.

### Manifest compatibility

The on-disk manifest deliberately stays **schema 1**, so the legacy
`install-skills.mjs` keeps working as an offline baseline. The updater only adds
optional fields to each managed entry: `managedBy`, `sourcePath`, `version`,
`digest`, `bytes` and `source {repo, requestedRef, resolvedRef, channel,
fetchedAt}` alongside the legacy `files`/`installedAt`. A schema-2 manifest
(written by development builds of the updater) is still read and normalized back
to schema 1 on the next write. Entries with `validated: false` that have no
`managedBy` are the old `inbox/` installs and are treated as protected legacy
content (kept, never auto-updated or deleted).

## Validation performed here

- Repository validator (`scripts/validate_skill.py --all`): 0 errors, 5
  warnings.
- Repository LLM test runner (`tests/run_tests.py --all --dry-run`): 12/12.
- All four `SKILL.md` files parse through the real `dsh-skill` /
  `dsh-skill-filesystem` packages (4/4 model-invocable; body loads).
- `tests/skills-update.test.mjs`: 19 updater tests cover master/dev scanning,
  nested discovery/flattening, add/update/noop, local-modified skip, user-local
  and extra-file preservation, extra-file collision, duplicate names,
  missing-resource validation, remote-deleted keep, network/repository errors,
  interrupted add/update recovery, rollback, legacy-manifest compatibility,
  dry-run/--skill, rejected-update preservation, and real DSH loading/watcher
  refresh.
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
