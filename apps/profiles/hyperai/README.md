# hyperai profile (native DSH profile)

The `hyperai` profile is a **native DeepSeek Harness profile**: the installed
profile is a normal directory under `~/.dsh/profiles/hyperai` with the upstream
manifest fields (`dsh.profile.bundles`, `dependencies`), a
`cordis.patch.yml` patch layer and a profile-local `pnpm` workspace. No custom
profile format or loader is introduced.

This package owns only the profile side:

- the native profile manifest and bundle order (`@deepseek-ai/dsh-base` then the
  branded `@deepseek-harness-tui/dsh-tui`);
- the profile patch layer: OpenAI-compatible model route (environment-driven
  key/endpoint/model), the TUI default route, and the profile-scoped skill root;
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
selection) is preserved.

## Configure the model (no credentials in the repo)

```sh
export HYPERAI_API_KEY=<your key>                    # name overridable via HYPERAI_API_KEY_ENV
export HYPERAI_BASE_URL=https://your-gateway/v1      # any OpenAI-compatible endpoint
export HYPERAI_MODEL=<model id>                      # comma-separated HYPERAI_MODELS also works
dsh --profile hyperai
```

`cordis.patch.yml` reads these at load time; it never stores a key. `/model`
inside the TUI can switch between the configured models, and the choice is
persisted under the profile's own `~/.dsh-tui-hyperai` state directory (separate
from the original `dsh-tui` profile's `~/.dsh-tui`).

## Skills

`scripts/install-skills.mjs` installs the pinned `hyperai-skills` commit listed
in [`skills/hyperai-skills.lock.json`](skills/hyperai-skills.lock.json) into
`<profile>/skills/`, records digests in `<profile>/.hyperai-skills/manifest.json`
and refuses to overwrite user-modified skills. See
[`docs/skills.md`](docs/skills.md) for the full mechanism, rollback and flags.

## Layout

```
apps/profiles/hyperai/
├── package.json          native DSH profile manifest (bundles + pinned TUI dep)
├── cordis.patch.yml      provider route + TUI default route + skill root
├── pnpm-workspace.yaml   hoisted profile workspace + TUI patch wiring
├── README.md
├── scripts/install.mjs   profile init + TUI patch + dependency install
├── scripts/install-skills.mjs
├── scripts/verify.mjs
├── skills/hyperai-skills.lock.json
├── tests/install.test.mjs
├── tests/skills.test.mjs
└── docs/skills.md
```

## Maintenance

The TUI is installed as a `pnpm` patch over the pinned upstream
`@deepseek-harness-tui/dsh-tui` version in `apps/tui/src/brand.json`. Bumping
upstream means rebuilding the patch in `apps/tui` and re-running this
installer; see `apps/tui/README.md`. The installed profile itself contains no
checkout paths: it only carries the copied `patches/hyperai-tui.patch`.
