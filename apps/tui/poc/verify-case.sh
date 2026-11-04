#!/usr/bin/env bash
# RFC-001 PoC (T4): run the runtime checks against an already installed case.
#
# Produces, under <case>/pty/: the raw PTY stream, a replay of the final screen
# (text + PNG) and the --dump-config output. The checks themselves are greps in
# the report; this script only captures evidence, it does not decide pass/fail.
#
# Usage: verify-case.sh <case-root> [profile-name]
set -euo pipefail

ROOT=${1:?case root}
PROFILE=${2:-hyperai}
HERE=$(cd "$(dirname "$0")" && pwd)
# pyte/Pillow live in an isolated venv; override with PYTHON=... if needed.
PYTHON=${PYTHON:-python3}
PTY="$ROOT/pty"
mkdir -p "$PTY"

export HOME="$ROOT/home"
export DSH_HOME="$ROOT/dsh-home"
export TERM=xterm-256color
export COLORTERM=truecolor
export COLUMNS=120
export LINES=40

cd "$DSH_HOME/profiles/$PROFILE"

dsh --profile "$PROFILE" --dump-config > "$ROOT/dump-config.txt" 2> "$ROOT/dump-config.err"
echo "dump-config: $(wc -l < "$ROOT/dump-config.txt") lines, stderr $(wc -c < "$ROOT/dump-config.err") bytes"

capture() {
  local name=$1
  shift
  "$PYTHON" "$HERE/pty-capture.py" --out "$PTY/$name" --cols 120 --rows 40 "$@" -- dsh --profile "$PROFILE" >/dev/null
}

capture startup --seconds 12
capture update --seconds 16 --send '5:/update' --send '6.2:\r'
capture provider --seconds 12 --send '5:/provider' --send '6.2:\r'
capture model --seconds 12 --send '5:/model' --send '6.2:\r'

for name in startup update provider model; do
  "$PYTHON" "$HERE/pty-screen.py" "$PTY/$name.raw" "$PTY/$name" --cols 120 --rows 40
done
echo "captures written to $PTY"
