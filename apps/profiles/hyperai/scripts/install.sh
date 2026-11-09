#!/bin/sh
# HyperAI Harness 内测版安装入口（macOS / Ubuntu）。
#
# 同事只需要：解压安装包，运行 ./install.sh。这个脚本负责：
#   1. 检查 Node.js 版本（不满足就给出中文安装指引并退出，不写任何文件）；
#   2. 把固定版本的 dsh 与 pnpm 装到 ~/.hyperai/runtime（不碰系统全局环境）；
#   3. 用安装包内的成品 TUI 包和 Skills 快照安装 hyperai profile；
#   4. 生成启动命令 ~/.hyperai/bin/hyperai。
#
# 可用环境变量：
#   HYPERAI_HOME         HyperAI 自己的安装目录（默认 ~/.hyperai）
#   DSH_HOME             Harness home（默认 ~/.dsh）
#   HYPERAI_NPM_REGISTRY npm 源（默认官方源；国内可换成镜像）
#   HYPERAI_DSH_VERSION  仅测试用，覆盖固定的 dsh 版本
#   HYPERAI_PNPM_VERSION 仅测试用，覆盖固定的 pnpm 版本
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HYPERAI_HOME=${HYPERAI_HOME:-"$HOME/.hyperai"}
DSH_HOME=${DSH_HOME:-"$HOME/.dsh"}
REGISTRY=${HYPERAI_NPM_REGISTRY:-https://registry.npmjs.org}
PROFILE_NAME=hyperai
ALLOW_DOWNGRADE=0
PREV_ARG=""
for arg in "$@"; do
  case $PREV_ARG in --profile) PROFILE_NAME=$arg ;; esac
  case $arg in
    --profile=*) PROFILE_NAME=${arg#*=} ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1 ;;
  esac
  PREV_ARG=$arg
done

say() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
fail() { say ""; say "安装失败：$*"; exit 1; }

say "HyperAI Harness 内测版安装程序"
say "  安装包：$HERE"
say "  HyperAI 目录：$HYPERAI_HOME"
say "  Harness home：$DSH_HOME"
say ""

# ── 1. Node.js 检查（任何写入之前） ───────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  say "没有找到 Node.js。HyperAI Harness 需要 Node.js ^22.19 或 >=24。"
  say ""
  say "macOS（Homebrew）："
  say "  brew install node@24 && brew link --overwrite node@24"
  say "Ubuntu / Linux（nvm，推荐装到当前用户目录）："
  say "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  say "  nvm install 24 && nvm use 24"
  say "官方下载：https://nodejs.org/zh-cn/download"
  say ""
  say "装好后重新打开终端，再运行本脚本。没有写入任何文件。"
  exit 1
fi

NODE_VERSION=$(node -p 'process.versions.node' 2>/dev/null || echo unknown)
if ! node -e '
const [major, minor] = process.versions.node.split(".").map(Number)
process.exit(major === 22 ? (minor >= 19 ? 0 : 1) : (major >= 24 ? 0 : 1))
' 2>/dev/null; then
  say "当前 Node.js 版本是 ${NODE_VERSION}，不满足要求（^22.19 或 >=24）。"
  say ""
  say "macOS（Homebrew）："
  say "  brew install node@24 && brew link --overwrite node@24"
  say "Ubuntu / Linux（nvm）："
  say "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  say "  nvm install 24 && nvm use 24"
  say "官方下载：https://nodejs.org/zh-cn/download"
  say ""
  say "装好后重新打开终端，再运行本脚本。没有写入任何文件。"
  exit 1
fi

command -v npm >/dev/null 2>&1 || fail "找到 Node.js（${NODE_VERSION}）但没有找到 npm，请重新安装完整的 Node.js。"

[ -f "$HERE/MANIFEST.json" ] || fail "安装包不完整：缺少 MANIFEST.json，请重新下载。"

DSH_VERSION=${HYPERAI_DSH_VERSION:-$(node -p 'require(process.argv[1]).components.dsh.version' "$HERE/MANIFEST.json")}
PNPM_VERSION=${HYPERAI_PNPM_VERSION:-$(node -p 'require(process.argv[1]).components.pnpm.version' "$HERE/MANIFEST.json")}
PRODUCT_VERSION=$(node -p 'require(process.argv[1]).version' "$HERE/MANIFEST.json")

say "Node.js ${NODE_VERSION} 检查通过；准备安装 HyperAI Harness ${PRODUCT_VERSION}。"

# ── 1.5 识别安装场景（只读，先于任何写入） ───────────────────────────────────
SCENARIO_FLAGS=""
[ "$ALLOW_DOWNGRADE" = "1" ] && SCENARIO_FLAGS="--allow-downgrade"
set +e
SCENARIO_TEXT=$(node "$HERE/profile/scripts/install.mjs" --detect-scenario \
  --dsh-home "$DSH_HOME" --profile "$PROFILE_NAME" $SCENARIO_FLAGS)
SCENARIO_STATUS=$?
set -e
[ -n "$SCENARIO_TEXT" ] && printf '%s\n' "$SCENARIO_TEXT"
if [ "$SCENARIO_STATUS" -eq 3 ]; then
  say ""
  say "安装已停止：检测到降级。没有写入任何文件。"
  say "确认要降级时，加 --allow-downgrade 重新运行；降级不做保证。"
  exit 1
fi
[ "$SCENARIO_STATUS" -eq 0 ] || fail "安装场景识别失败（退出码 ${SCENARIO_STATUS}）。请把上面的输出发给负责人。"

SCENARIO_MODE=$(node "$HERE/profile/scripts/install.mjs" --scenario-field mode --dsh-home "$DSH_HOME" --profile "$PROFILE_NAME" $SCENARIO_FLAGS)
SCENARIO_FROM=$(node "$HERE/profile/scripts/install.mjs" --scenario-field from --dsh-home "$DSH_HOME" --profile "$PROFILE_NAME" $SCENARIO_FLAGS)
SCENARIO_TO=$(node "$HERE/profile/scripts/install.mjs" --scenario-field to --dsh-home "$DSH_HOME" --profile "$PROFILE_NAME" $SCENARIO_FLAGS)

case " $* " in
  *" --dry-run "*)
    say ""
    say "dry-run：以上是安装场景识别结果，没有写入任何文件。"
    exit 0
    ;;
esac

# ── 2. 隔离的运行时（dsh + pnpm） ───────────────────────────────────────────
RUNTIME="$HYPERAI_HOME/runtime"
BIN_DIR="$HYPERAI_HOME/bin"
mkdir -p "$RUNTIME" "$BIN_DIR"

say "安装 dsh@${DSH_VERSION} 与 pnpm@${PNPM_VERSION} 到 ${RUNTIME}（不会改动系统全局环境）……"
if ! npm install --prefix "$RUNTIME" --registry "$REGISTRY" --no-audit --no-fund --loglevel=error \
  "@deepseek-ai/dsh@$DSH_VERSION" "pnpm@$PNPM_VERSION"; then
  fail "下载 dsh/pnpm 失败。请检查网络，或用 HYPERAI_NPM_REGISTRY 指定可用的 npm 镜像后重试。"
fi

DSH_BIN="$RUNTIME/node_modules/.bin/dsh"
PNPM_BIN="$RUNTIME/node_modules/.bin/pnpm"
[ -x "$DSH_BIN" ] || fail "dsh 安装后没有找到可执行文件：$DSH_BIN"
[ -x "$PNPM_BIN" ] || fail "pnpm 安装后没有找到可执行文件：$PNPM_BIN"

# ── 3. 安装 profile（成品包 + Skills 快照，不访问 GitHub） ──────────────────
say "安装 hyperai profile……"
if ! env \
  HYPERAI_DIST_ROOT="$HERE" \
  DSH_HOME="$DSH_HOME" \
  PATH="$RUNTIME/node_modules/.bin:$PATH" \
  npm_config_registry="$REGISTRY" \
  node "$HERE/profile/scripts/install.mjs" \
    --dsh-home "$DSH_HOME" \
    --dsh-bin "$DSH_BIN" \
    --pnpm-bin "$PNPM_BIN" \
    "$@"; then
  fail "profile 安装失败。请把上面的错误信息发给负责人。"
fi

# ── 4. 确认安装真的成功 ─────────────────────────────────────────────────────
# Silent no-ops are worse than failures: a skipped installer used to print
# "安装完成" while no profile existed. Only a completed install may get a launcher.
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
INSTALL_STATE="$PROFILE_DIR/.hyperai-install.json"
case " $* " in
  *" --dry-run "*)
    say "dry-run：跳过安装结果检查。"
    ;;
  *)
    [ -d "$PROFILE_DIR" ] || fail "安装没有生成 profile 目录：$PROFILE_DIR。请把上面的输出发给负责人。"
    [ -f "$INSTALL_STATE" ] || fail "安装没有写入状态文件：$INSTALL_STATE。请把上面的输出发给负责人。"
    if ! node -e 'const s = require(process.argv[1]); process.exit(s.status === "completed" ? 0 : 1)' "$INSTALL_STATE" 2>/dev/null; then
      fail "安装未完成（状态不是 completed）：$INSTALL_STATE。请把上面的输出发给负责人。"
    fi
    ;;
esac

# ── 5. 启动命令 ─────────────────────────────────────────────────────────────
LAUNCHER="$BIN_DIR/hyperai"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
# HyperAI Harness 启动命令（由 install.sh 生成）。
set -eu
HYPERAI_HOME="\$(CDPATH= cd -- "\$(dirname -- "\$0")/.." && pwd)"
DSH_HOME="\${DSH_HOME:-$DSH_HOME}"
export DSH_HOME
# 内测版默认关闭 Skills 自动检查：同事通常没有 hyperai-skills 仓库权限。
export HYPERAI_SKILLS_TUI_AUTO="\${HYPERAI_SKILLS_TUI_AUTO:-0}"
exec "\$HYPERAI_HOME/runtime/node_modules/.bin/dsh" --profile hyperai "\$@"
EOF
chmod +x "$LAUNCHER"

cat > "$HYPERAI_HOME/.hyperai-launcher.json" <<EOF
{
  "launcher": "$LAUNCHER",
  "runtime": "$RUNTIME",
  "dshHome": "$DSH_HOME",
  "productVersion": "$PRODUCT_VERSION",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

finish_report() {
  say ""
  case "$SCENARIO_MODE" in
    upgrade) say "已从 ${SCENARIO_FROM} 升级到 ${SCENARIO_TO}，你的配置和对话记录已保留。" ;;
    reinstall) say "已重新安装 ${SCENARIO_TO}。" ;;
    fresh) say "已全新安装 ${SCENARIO_TO}。" ;;
    interrupted) say "已修复上次未完成的安装，当前版本 ${SCENARIO_TO}。" ;;
    uninstalled) say "已重新安装 ${SCENARIO_TO}（之前的卸载归档不会自动恢复）。" ;;
    upgrade-unknown) say "已从旧版本（未知）升级到 ${SCENARIO_TO}。" ;;
    downgrade) say "已降级到 ${SCENARIO_TO}（降级不做保证）。" ;;
    *) say "已安装 HyperAI Harness ${SCENARIO_TO}。" ;;
  esac
  say ""
  say "启动："
  say "  $LAUNCHER"
  say ""
  if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
    say "如果希望直接输入 hyperai 启动，把下面一行加进 shell 配置（~/.zshrc 或 ~/.bashrc）："
    say "  export PATH=\"$BIN_DIR:\$PATH\""
    say ""
  fi
  case "$SCENARIO_MODE" in
    fresh|uninstalled)
      say "首次使用：启动时会提示登录 OpenBayes（推荐，可跳过；以后可用 /openbayes login 登录），再用 /provider 添加模型服务、/model 选择模型。"
      say "API key 由 DSH 保存在 $DSH_HOME/.credentials.yaml（权限 0600），不会写进安装包。"
      ;;
    *)
      say "你原来的模型配置可以直接使用。"
      ;;
  esac
  say ""
  say "注意：ppt-generation 技能需要 Python 3 和 python-pptx，本脚本不会自动安装："
  say "  python3 -m pip install python-pptx"
  say ""
  say "卸载：见安装包里的 README.md（使用 profile/scripts/manage.mjs uninstall）。"
}

finish_report
