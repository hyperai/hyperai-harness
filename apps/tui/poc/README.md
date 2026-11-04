# RFC-001 PoC：TUI 发布包三条路径的复现说明

这个目录是 RFC-001（TUI 发布包可行性验证）的 PoC 交付物：构建脚本、路径模板、验证脚本和证据。它**不是产品代码**，不需要达到可合并质量。

结论见 [`RFC-001-RESULT.md`](./RFC-001-RESULT.md)。

## 组成

```
apps/tui/scripts/build-package.mjs   T2：原包 + 补丁 → 可安装 tarball（p1 / p2 / p3 三种产物）
apps/tui/poc/
├── upstream.json        原包的 size / sha256 / integrity 记录（原包本身不入库）
├── profiles/p1/         P1 的最小 profile（改名包，bundles 用新名）
├── profiles/p2a/        P2 的最小 profile（别名安装，bundles 用别名旧名）
├── profiles/p2b/        P2 的反例：bundles 写包的真实新名
├── profiles/p3/         P3 的最小 profile（tarball URL）
├── run-path.sh          T3：隔离 HOME/DSH_HOME 安装，安装期间把仓库改名藏起来
├── verify-case.sh       T4：--dump-config + 三次 PTY 交互捕获
├── pty-capture.py       PTY 录制（可编排按键）
├── pty-screen.py        用 pyte 回放成屏幕文本 + PNG（半块字符画成像素）
└── evidence/            每条路径的证据（安装日志、dump-config、屏幕文本、截图）
```

## 前置条件

- Node `^22.19 || >=24`（本次用 `v26.9.0`）
- `pnpm` 在 `PATH` 上（本次 `10.28.1`）
- `dsh` **0.2.0-rc.2**（RFC 3.3 要求统一用它，不要用仓库源码构建的 dsh）
- 全程使用临时 `HOME` 与 `DSH_HOME`，不要碰真实的 `~/.dsh`、`~/.dsh-tui-*`、`~/.dsh/.credentials.yaml`
- `pty-capture.py` / `pty-screen.py` 需要能分配 PTY 的权限；`pty-screen.py` 依赖 `pyte` 和 `Pillow`

```sh
export BASE=/tmp/rfc-001
export HOME="$BASE/home"
export DSH_HOME="$BASE/dsh-home"
export npm_config_cache="$BASE/npm-cache"
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
python3 -m venv "$BASE/venv" && "$BASE/venv/bin/pip" install pyte pillow
```

## T1：原包离线保存与可复现构建

```sh
npm pack @deepseek-harness-tui/dsh-tui@0.16.1 --pack-destination "$BASE"
# 核对 size/sha256/integrity 与 poc/upstream.json 一致，再解包：
tar -xzf "$BASE"/deepseek-harness-tui-dsh-tui-0.16.1.tgz -C "$BASE/upstream"
cd <repo>
node apps/tui/scripts/build-patch.mjs --from "$BASE/upstream/package"
cmp <已提交补丁> apps/tui/patches/dsh-tui@0.16.1.patch
```

断网重建：把 registry 与 proxy 指向不可达地址，重复上面最后一步：

```sh
npm_config_registry=http://127.0.0.1:9/ HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
  node apps/tui/scripts/build-patch.mjs --from "$BASE/upstream/package"
```

`build-package.mjs` 会自己按 `poc/upstream.json` 校验 `--upstream`，校验不过直接失败。

## T2：构建成品包

```sh
node apps/tui/scripts/build-package.mjs --upstream "$BASE"/deepseek-harness-tui-dsh-tui-0.16.1.tgz \
  --mode p1 --out "$BASE/products"
node apps/tui/scripts/build-package.mjs ... --mode p2 --out "$BASE/products"
node apps/tui/scripts/build-package.mjs ... --mode p3 --out "$BASE/products"
```

三种产物的差别只有包名和自引用处理：

| mode | 包名 | 自引用 | 文件名 |
|---|---|---|---|
| p1 | `@hyperai/hyperai-tui` | 全部改写成新名 | `hyperai-hyperai-tui-0.16.1-p1.tgz` |
| p2 | `@hyperai/hyperai-tui` | 保持原样，靠安装别名解析 | `hyperai-hyperai-tui-0.16.1-p2.tgz` |
| p3 | `@deepseek-harness-tui/dsh-tui` | 保持原样 | `deepseek-harness-tui-dsh-tui-0.16.1-p3.tgz` |

产物里同时保留上游 `LICENSE`、`licenses/` 下的第三方许可证和 `LICENSE-HYPERAI.txt`；`package.json` 新增 `hyperai` 字段记录 HyperAI 版本 `0.2.0` 与上游版本 `0.16.1`。

## 模拟发布渠道（PoC 专用）

P1 / P2 用本地 Verdaccio 模拟私有 registry，P3 用本地静态 HTTP 服务模拟 Release 附件。

```sh
npm install -g verdaccio@6
# 每个路径一个实例，避免同名同版本互相覆盖；max_body_size 必须调大（包约 18 MB）
verdaccio --config "$BASE/verdaccio/p1/config.yaml" &   # 127.0.0.1:4873
verdaccio --config "$BASE/verdaccio/p2/config.yaml" &   # 127.0.0.1:4875
python3 -m http.server 4874 --bind 127.0.0.1 --directory "$BASE/products" &   # P3

# Verdaccio 需要账号才能发布：先拿 token（legacy couchdb 用户接口），写进 npmrc
curl -X PUT http://127.0.0.1:4873/-/user/org.couchdb.user:poc \
  -H 'Content-Type: application/json' \
  -d '{"name":"poc","password":"<本地测试口令>","email":"poc@example.com"}'
npm publish "$BASE/products/hyperai-hyperai-tui-0.16.1-p1.tgz" \
  --registry http://127.0.0.1:4873/ --userconfig "$BASE/verdaccio/p1/npmrc"
```

Verdaccio 配置要点：`max_body_size: 100mb`、`publish: $all`、uplink 指到 `https://registry.npmjs.org/`。P3 的 profile 依赖 URL 固定为 `http://127.0.0.1:4874/deepseek-harness-tui-dsh-tui-0.16.1-p3.tgz`。

## T3：隔离安装

```sh
PATH="$BASE/home/.npm-global/bin:$PATH" \
  bash apps/tui/poc/run-path.sh p1 "$BASE/cases/p1" http://127.0.0.1:4873
```

脚本做四件事：准备最小 profile（`package.json` + `pnpm-workspace.yaml` + `apps/profiles/hyperai/cordis.patch.yml` 的副本 + `.npmrc`）、**把整个 checkout 改名藏起来**、在 profile 目录执行 `dsh plugin --profile hyperai install --no-frozen-lockfile`、恢复 checkout。安装期间 `test -e <repo>` 必须为假，日志里会记录。

`p2a/p2b/p3` 同理；`p2a` 与 `p2b` 用同一个 registry（4875），`p3` 传 `https://registry.npmjs.org`（只有依赖走公共源，TUI 包本身走本地 URL）。

## T4：运行验证

```sh
PATH="$BASE/home/.npm-global/bin:$PATH" PYTHON="$BASE/venv/bin/python" \
  bash apps/tui/poc/verify-case.sh "$BASE/cases/p1"
```

脚本产出 `<case>/dump-config.txt`、`<case>/dump-config.err` 和 `pty/{startup,update,provider,model}.{raw,txt,screen.txt,screen.png}`。检查项与判定见结果报告的对比矩阵。

T4.7（仅 P1）另需两个场景，见 `evidence/compat/`：先用原包名安装并产生会话与偏好，再把同一个 profile 换成改名包，检查旧会话能否 `--resume`、`~/.dsh-tui-hyperai` 是否仍被使用。

## 已知环境限制

- 本机沙箱默认拒绝分配 PTY（`openpty: Operation not permitted`），所有 TUI 运行都在更大权限下执行；这不是方案问题。
- 真实 `~/.npm` 缓存里有 root 所有的文件，`npm` 直接跑会 EPERM；本次全部使用临时 `HOME` 和 `npm_config_cache`，没有修复或写入真实缓存。
- 没有 API key，所以会话里的模型轮次会以 `turn error` 结束；会话日志与索引仍是真实生成的。
