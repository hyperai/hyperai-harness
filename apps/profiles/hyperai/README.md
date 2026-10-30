# hyperai profile (native DSH profile)

The `hyperai` profile is a **native DeepSeek Harness profile**: the installed
profile is a normal directory under `~/.dsh/profiles/hyperai` with the upstream
manifest fields (`dsh.profile.bundles`, `dependencies`), a
`cordis.patch.yml` patch layer and a profile-local `pnpm` workspace. No custom
profile format or loader is introduced.

This package owns only the profile side:

- the native profile manifest and bundle order (`@deepseek-ai/dsh-base` then the
  branded `@deepseek-harness-tui/dsh-tui`);
- the profile patch layer: the profile-scoped skill root only. Model providers
  and models are **DSH-native user configuration**, not profile defaults;
- profile initialization, validation, TUI patch installation and the HyperAI
  skills install/lock mechanism.

It does **not** contain TUI implementation code. The TUI branding lives in the
independent [`apps/tui`](../../tui) package; this installer copies that package's
generated `pnpm` patch and installs the pinned upstream TUI dependency.

## Install

```sh
cd apps/profiles/hyperai
node scripts/install.mjs            # profile init + TUI patch + skills
node scripts/install.mjs --no-skills
node scripts/install.mjs --dry-run  # print the plan, write nothing
node scripts/verify.mjs             # offline template/installer checks
node --test tests/                  # installer + skills unit tests
```

The installer writes the native profile under `~/.dsh/profiles/hyperai`,
installs dependencies through `dsh plugin --profile hyperai install`, verifies
the branding patch landed, then installs the pinned skills. A profile that the
installer did not create is refused unless `--force` is given; every replaced
managed file is backed up under `<profile>/.hyperai-backups/<timestamp>/` first.
Existing user data (skills content, `~/.dsh-tui-hyperai` UI state, model
selection and user-created `llm-pi-ai`/`insert` rows in `cordis.patch.yml`) is
preserved; re-running the installer backs the file up and merges only the
managed skill-root row, dropping the removed environment-driven preset rows.

## Configure the model (DSH-native, no preset provider)

The profile does **not** ship a provider, endpoint, API-key variable or default
model. It behaves like the original `dsh-tui` profile:

```sh
dsh --profile hyperai
# inside the TUI:
#   /provider  → add/edit an OpenAI-compatible (or catalog) provider, e.g.
#               route `litellm`, base URL https://your-gateway/v1, key saved in
#               ~/.dsh/.credentials.yaml
#   /model     → pick a model from that provider
```

Provider settings are persisted by DSH in this profile's own
`cordis.patch.yml` (an `llm-pi-ai` row with plain values) and in
`~/.dsh/.credentials.yaml` (mode 0600). The `/model` choice is persisted in
`~/.dsh-tui-hyperai/model.json`. All of these survive restarts and are kept by
`scripts/install.mjs` re-runs (it merges user rows instead of replacing the
patch file). No environment-variable credential, endpoint or model is required
or read by the profile.

## Skills

`scripts/install-skills.mjs` installs the pinned `hyperai-skills` commit listed
in [`skills/hyperai-skills.lock.json`](skills/hyperai-skills.lock.json) into
`<profile>/skills/` as the initial/offline baseline. Day-to-day updates use the
independent updater, which `install.mjs` copies into the installed profile:

```sh
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs catalog   # offline
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check     # read-only
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs update --yes
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs rollback --list

# explicit development-branch test (prerelease; never the default):
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check \
  --ref feat/ppt-generation-upstream
```

The updater discovers `skills/**/SKILL.md` recursively, flattens categories to
DSH's one-level layout, skips local-modified/user-installed skills, preserves
user extra files, keeps skills removed upstream, and records backups/rollback
snapshots in `<profile>/.hyperai-skills/`. It never touches model/provider
configuration. The TUI checks it asynchronously after the first frame (at most
once per 24h, silent when up to date) and shows a non-blocking hint; typing
`/skills-update` opens the install/details/later dialog. Installation is always
user-confirmed and pinned to the exact SHA shown by the check. See
[`docs/skills.md`](docs/skills.md) for the full mechanism, manifest schema,
TUI bridge and safety rules.

## Layout

```
apps/profiles/hyperai/
├── package.json          native DSH profile manifest (bundles + pinned TUI dep)
├── cordis.patch.yml      profile-scoped skill root only (model config is user-owned)
├── pnpm-workspace.yaml   hoisted profile workspace + TUI patch wiring
├── README.md
├── scripts/install.mjs          profile init + TUI patch + dependency install
├── scripts/install-skills.mjs   legacy/bootstrap skills install
├── scripts/skills-update.mjs    skills check/update/catalog/rollback CLI
├── scripts/skills-lib.mjs       discovery, digests, transactions, rollback
├── scripts/verify.mjs
├── skills/hyperai-skills.lock.json
├── tests/install.test.mjs
├── tests/skills.test.mjs
├── tests/skills-update.test.mjs
└── docs/skills.md
```

## Maintenance

The TUI is installed as a `pnpm` patch over the pinned upstream
`@deepseek-harness-tui/dsh-tui` version in `apps/tui/src/brand.json`. Bumping
upstream means rebuilding the patch in `apps/tui` and re-running this
installer; see `apps/tui/README.md`. The installed profile itself contains no
checkout paths: it only carries the copied `patches/hyperai-tui.patch`.
