#!/usr/bin/env bash
# RFC-001 PoC (T3): install one distribution path in a fully isolated HOME.
#
# The user machine is simulated by:
#   - a fresh HOME and DSH_HOME per case (the real ~/.dsh and ~/.dsh-tui-* are
#     never touched);
#   - a minimal profile: package.json + pnpm-workspace.yaml + the profile patch
#     layer copied out of apps/profiles/hyperai;
#   - the source checkout renamed away for the whole install, so any read of the
#     repository during installation fails instead of silently working.
#
# Usage: run-path.sh <p1|p2a|p2b|p3> <case-root> <registry-url>
set -euo pipefail

MODE=${1:?mode: p1|p2a|p2b|p3}
ROOT=${2:?case root}
REGISTRY=${3:?registry url}

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
BASELINE_PROFILE="$REPO/apps/profiles/hyperai"
TEMPLATE="$HERE/profiles/$MODE"
HIDDEN="$REPO.hidden-$MODE"
PROFILE_NAME=hyperai

HOME_DIR="$ROOT/home"
DSH_HOME_DIR="$ROOT/dsh-home"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE_NAME"
LOG="$ROOT/install.log"

mkdir -p "$HOME_DIR" "$PROFILE_DIR"
: > "$LOG"

log() { printf '%s\n' "$*" | tee -a "$LOG"; }

if [ ! -f "$TEMPLATE/package.json" ]; then
  log "missing profile template $TEMPLATE/package.json"
  exit 2
fi

cp "$TEMPLATE/package.json" "$PROFILE_DIR/package.json"
cp "$TEMPLATE/pnpm-workspace.yaml" "$PROFILE_DIR/pnpm-workspace.yaml"
cp "$BASELINE_PROFILE/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"
# The profile-scoped registry (a private server for p1/p2, the public one for p3).
cat > "$PROFILE_DIR/.npmrc" <<EOF
registry=$REGISTRY/
auto-install-peers=false
EOF

log "# case $MODE"
log "# HOME=$HOME_DIR"
log "# DSH_HOME=$DSH_HOME_DIR"
log "# registry=$REGISTRY"
log "# profile package.json:"
sed 's/^/  /' "$PROFILE_DIR/package.json" | tee -a "$LOG" >/dev/null
log "# dsh version: $(dsh --version 2>&1 | head -1)"

restore_repo() {
  if [ -d "$HIDDEN" ]; then mv "$HIDDEN" "$REPO"; fi
}
trap restore_repo EXIT

# Proven isolation: the checkout does not exist while the install runs.
mv "$REPO" "$HIDDEN"
log "# isolation: checkout moved to $HIDDEN"
if [ -e "$REPO" ]; then
  log "ISOLATION FAILED: $REPO still exists"
  exit 3
fi
log "# isolation check: test -e $REPO -> absent"

cd "$PROFILE_DIR"
set +e
HOME="$HOME_DIR" DSH_HOME="$DSH_HOME_DIR" npm_config_cache="$HOME_DIR/.npm-cache" \
  dsh plugin --profile "$PROFILE_NAME" install --no-frozen-lockfile \
  >>"$LOG" 2>&1
status=$?
set -e
log "# dsh plugin install exit=$status"

# Copy the install's own stdout/stderr out of the hidden checkout's log is not
# needed: $LOG is outside the repository, so it survives the rename.
restore_repo
trap - EXIT

if [ "$status" -ne 0 ]; then
  log "INSTALL FAILED"
  exit "$status"
fi

log "# installed tree:"
find "$PROFILE_DIR/node_modules" -maxdepth 3 -name package.json -path '*dsh-tui*' 2>/dev/null | sed 's/^/  /' | tee -a "$LOG" >/dev/null
log "# node_modules/@deepseek-harness-tui present: $([ -e "$PROFILE_DIR/node_modules/@deepseek-harness-tui/dsh-tui" ] && echo yes || echo no)"
log "# node_modules/@hyperai present: $([ -e "$PROFILE_DIR/node_modules/@hyperai/hyperai-tui" ] && echo yes || echo no)"

exit 0
