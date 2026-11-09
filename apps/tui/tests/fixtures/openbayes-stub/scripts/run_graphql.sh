#!/bin/bash
# Test stub for openbayes-user's run_graphql.sh. Never shipped in the package.
set -u
STATE="${HOME:?}/.ob-stub-state"
MODE="${OB_STUB_MODE:-valid}"
NOW=$(node -p 'Math.floor(Date.now()/1000)')

init_state() {
  [ -f "$STATE" ] && return 0
  case "$MODE" in
    valid) echo $((NOW + 10*86400)) > "$STATE" ;;
    expiring) echo $((NOW + 2*86400)) > "$STATE" ;;
    expired) echo $((NOW - 3600)) > "$STATE" ;;
    expiremid) echo $((NOW + 5)) > "$STATE" ;;
    missing) return 0 ;;
    *) echo $((NOW + 10*86400)) > "$STATE" ;;
  esac
}

has=0; code=""; identity=0; login=0; logout=0; whoami=0
for arg in "$@"; do
  case "$arg" in
    --identity) identity=1 ;;
    --login) login=1 ;;
    --code) has=1 ;;
    --logout) logout=1 ;;
  esac
done
prev=""
for arg in "$@"; do
  if [ "$prev" = "--code" ]; then code="$arg"; fi
  if [ "$prev" = "--query-file" ]; then whoami=1; fi
  prev="$arg"
done

if [ "$logout" = 1 ]; then
  rm -f "$STATE"
  touch "${HOME:?}/.ob-stub-loggedout"
  echo "Logged out (stub)"
  exit 0
fi

if [ "$login" = 1 ] && [ "$has" = 0 ]; then
  echo "Vendor: openbayes"
  echo "Endpoint: https://openbayes.com/gateway/graphql"
  echo "Device: stub-device"
  echo "1. 在浏览器打开下面的授权页："
  echo "   https://openbayes.com/console/settings/account/cli/authorize?code_challenge=stub&device=stub-device"
  exit 0
fi

if [ "$login" = 1 ] && [ "$has" = 1 ]; then
  if [ -n "$code" ] && [ "$code" != "WRONG" ]; then
    rm -f "${HOME:?}/.ob-stub-loggedout"
    echo $((NOW + 30*86400)) > "$STATE"
    echo "Logged in as vendor \"openbayes\" (token name: CLI · stub, expires: 2099-01-01T00:00:00Z)."
    exit 0
  fi
  echo "[LOGIN_EXCHANGE_FAILED] 授权码无效或已过期" >&2
  exit 1
fi

if [ "$whoami" = 1 ]; then
  case "${OB_STUB_WHOAMI:-ok}" in
    revoked) echo "401 Unauthorized: token revoked" >&2; exit 1 ;;
    network) echo "getaddrinfo ENOTFOUND openbayes.com" >&2; exit 1 ;;
    *) echo '{"data":{"me":{"username":"stub-user"}}}'; exit 0 ;;
  esac
fi

if [ "$identity" = 1 ]; then
  init_state
  if [ -f "${HOME:?}/.ob-stub-loggedout" ] || [ ! -f "$STATE" ]; then
    echo "[MISSING_TOKEN] Not logged in. Run --login --vendor openbayes" >&2
    exit 1
  fi
  exp=$(cat "$STATE")
  node -e '
    const exp = Number(process.argv[1]);
    const now = Math.floor(Date.now()/1000);
    const iso = new Date(exp*1000).toISOString().replace(".000Z","Z");
    process.stdout.write(JSON.stringify({vendor:"openbayes",endpoint:"https://openbayes.com/gateway/graphql",token_source:"session:stub",sub:"stub-user",kind:"pat",jti:"stub",expires_at:iso,expired:exp<=now,verified:false})+"\n");
  ' "$exp"
  exit 0
fi

echo "stub: unsupported arguments" >&2
exit 2
