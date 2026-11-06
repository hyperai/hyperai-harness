# RFC-005 结果报告（v0.2.0-beta.4）

> 关联 RFC：[RFC-005：beta.3 遗留的四个小修复](https://github.com/lizhenhhh/jihua/blob/main/RFC-005-beta4-fixes.md)
> 工作分支：`feat/hyperai-internal-beta`（从 `4a1f289574` 往后提交，未新建分支）

## 结论

四个问题都修好了：`/openbayes login` 的一次性码输入框现在遮蔽显示（粘贴可用、提交原文），上游其他输入界面保持明文；文档和证据里不再有测试服务器路径与测试用户名；安装失败时只有中文提示；`install.sh` 的结果检查跟随 `--profile`。`v0.2.0-beta.4` 已构建并通过 T1～T8（macOS 全测，Ubuntu 测了 T3/T5/T7）。

## 2.1 一次性码输入框遮蔽

- 先查上游：`TuiDialogInputRequest` 和 `ExtensionDialog.js` 里没有 `mask` / `secret` / `password` 之类的现成选项。
- 用 `build-patch.mjs` 对 `lib/types/components/ExtensionDialog.js` 做一处精确替换：`dialog.mask === true` 时，`SearchBox` 的 `query` 用 `•` 按码点重复显示，`cursorOffset` 直接用光标码点位置；其它情况完全走原表达式。默认关闭，上游没有任何调用方传 `mask`。
- 粘贴走原来的 `insertChunk`，`value` 始终是原文；提交时 `dialogs` 返回的也是原文（`normalizeCode` 只做 trim/长度/控制字符校验）。
- `/openbayes` 的 input 请求加 `mask: true`，并保留 `initial: ''`（上游 `InputDialog` 会展开 `initial`）。
- 测试：`maskedInput()` 单测（字符数一致、无明文、提交值仍是原文）、桥接源码只在 `/openbayes` 传 `mask: true`、补丁包含 `dialog.mask === true` 条件。

## 2.2 测试服务器路径与用户名

- 改了 4 个文件：`RFC-002-RESULT.md`、`RFC-003-RESULT.md`、`RFC-004-RESULT.md`、`evidence/rfc-002/README.md`。
- `/home/<测试用户>/…` → `$HOME/…`；测试用户名 → 「测试用户」/「验收测试用户」。
- `beta-install.md` 面向同事的 `~/…` 没有改。

## 2.3 安装失败时的英文拒绝信息

- `install.mjs` 的拒绝分支改成中文并说明处理办法：
  「目标目录已存在，并且不是 HyperAI 安装器创建的：…。请先备份该目录；确认要覆盖时，加 --force 重新运行安装。」
- `--json` 输出结构、退出码不变（失败仍是 exit 1，`install.sh` 仍打印「安装失败」）。
- 同一条路径上**其它用户可见的英文报错**（本轮只列不改）：
  1. `cannot run dsh --version: dsh was not found on PATH` / `dsh --version failed: …`（preflight）；
  2. `refusing to overwrite <file>: it was not created by this installer (missing marker …)`（`cordis.patch.yml` 或受管文件冲突）；
  3. `install verification failed: …`（许可证/品牌补丁/旧 logo 模块等 6 条）；
  4. `dsh plugin install exited <status>; dependency output was written to stderr`；
  5. `unknown argument …`；
  6. `profile template is not a top-level YAML list` / `installed cordis.patch.yml is not a top-level YAML list`；
  7. `install-skills.mjs` 的锁文件/`SKILL.md` 校验错误（如 `unsupported skills lock schema`、`SKILL.md is missing`）；
  8. `dsh` 自身的 `pnpm was not found; install pnpm and make it available on PATH` 与 `plugin command failed; diagnostics: …`（外部程序输出）。

## 2.4 `install.sh` 的 profile 名

- `install.sh` 现在解析 `--profile <name>` 与 `--profile=<name>`，默认 `hyperai`；结果检查用 `$DSH_HOME/profiles/$PROFILE_NAME`。
- 支持现状：`install.mjs` 和 `manage.mjs` 本来就支持 `--profile`；`install.sh` 生成的启动器仍写死 `--profile hyperai`，本轮**没有**新增「启动器跟随 --profile」的行为（按 RFC 要求只修检查）。
- 测试：新增 `tests/install-sh.test.mjs` 固定 shell 契约；T6 用 `--profile alt` 实测安装成功、检查不误报。

## 版本

`0.2.0-beta.4`：安装包文件名、TUI 成品包、铭牌、`beta-install.md`、README 同步更新；上游 `0.16.1`、dsh、pnpm、Skills 快照、openbayes-user 安装逻辑不变。

## 交付物

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.4.tar.gz` |
| 大小 | 18 474 567 字节 |
| sha256 | `795f21aeeec83c61fc231deb13450070841a8275171128e171ad0e631226e30b` |
| 构建 commit | `9ec5f6633a903b0bb6bbfdded8b057dad2c1eab9` |
| TUI 成品包 | sha256 `b17db21fad109e5aca3a08ff0a9f91885dd0bdd145653444e27ea5ede51ea1d2`，3298 个文件 |
| 服务器 | 测试服务器测试用户主目录（beta.1～beta.3 保留，beta.4 新增） |

## T1～T8

| # | 检查 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| T1 | 现有测试 + 遮蔽/profile 新测试 | 通过：tui verify 15/15、tests 36/36；profile verify 12/12、tests 91/91 | — | 命令输出见本节 |
| T2 | 同 commit 构建两次 | 通过：两次都是 `795f21ae…e30b` | — | `runs-summary.txt` |
| T3 | PTY 粘贴假码：只显示遮蔽、提交后中文错误 | 通过：明文 0、遮蔽 13 字符、错误提示 1 | 通过（同左） | `*/t3-*.screen.txt` |
| T4 | 上游原有输入仍明文 | 通过：`/provider` 自定义流程的文本输入显示 `visible-plain-123`；且上游无调用方设置 `mask` | — | `macos/t4-upstream-input.screen.txt` |
| T5 | 人为失败：无英文拒绝、中文说明、exit 非 0、无「安装完成」 | 通过 | 通过 | `*/t5-failure.log` |
| T6 | `--profile alt` 安装成功、不误报 | 通过 | — | `macos/t6-profile-alt.log` |
| T7 | 从 beta.3 升级：数据保留、skill 在、铭牌 beta.4、doctor OK | 通过 | 通过 | `*/t7-*` |
| T8 | 文档里没有测试服务器路径/用户名 | 通过：绝对 `/home/<用户>` 0 行、`hyperai-*` 用户名 0 行 | — | 自查第 1 条 |

## 包内 README 与仓库一致

`hyperai-harness-0.2.0-beta.4/README.md` 与 `docs/beta-install.md` 的 sha256 都是 `c749501ba120fd62a2eca22b19382193ca4f3811c8387f8a1388c8d823ea8aef`。

## 固定自查

1. 新增/修改文件里没有 `/skills` 列表截取或内部 Skills 描述：
   `git grep -nI "Use when" -- apps/profiles/hyperai/docs/evidence/rfc-005` → **0 行**；`find … -name '*.png'` → **0**。
2. 主机名前缀自查：`git grep -nI "<主机名前 10 个字符>" -- apps/` → **0 行**（完整主机名/前缀不写进报告）。
3. 令牌/一次性码/本机用户路径：
   `git grep -nIE "eyJ[A-Za-z0-9_-]{30,}" -- apps/` → **0**；
   `git grep -nI -e "<本次一次性码>" -e "<T3 假码>" -- apps/` → **0**；
   `git grep -nI "/Users/<用户名>" -- apps/` → **0**。

## 偏离 RFC 的地方

1. **T4 的“上游 input 对话框”**：上游 TUI 除本项目的 `/openbayes` 桥接外，没有其它 `ctx.tuiDialogs.input` 调用点；`/provider` 的文本字段走的是提问面板（另一个组件）。因此 T4 用 `/provider` 自定义流程的文本输入证明上游输入仍明文，并用代码检查确认补丁只在 `dialog.mask === true` 时生效、上游没有调用方传 `mask`。
2. **补丁大小上限**：遮蔽改动给上游 `ExtensionDialog.js` 的一行加了条件，补丁从约 96 KB 增到约 98 KB，超过原来的 96 KB 断言。把 `verify.mjs` 与 `branding.test.mjs` 的上限调到 100 KB（仍保持“补丁必须小”的约束）。
3. **Ubuntu 的 T3/T5/T7 用开发测试用户执行**；没有触碰验收测试用户与 `/root`。

## 已知问题与限制

1. 遮蔽只覆盖 `/openbayes` 的 input 对话框；上游将来若新增 input 调用点，默认仍是明文，需要显式传 `mask: true`。
2. `install.sh` 生成的启动器仍写死 `--profile hyperai`；用 `--profile` 安装其它名字时，检查不会误报，但启动命令需要手动指定 profile（本轮按 RFC 不新增该支持）。
3. 安装器其它英文报错（见 2.3 列表）本轮未改。
4. 测试环境中 openbayes-user 下载在无网沙箱下会打一条中文警告（EPERM/网络），不影响安装与测试结论。
