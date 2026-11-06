# RFC-003 结果报告（v0.2.0-beta.2）

> 关联 RFC：[RFC-003：修复 beta.1 的两个已知问题，发布 v0.2.0-beta.2](https://github.com/lizhenhhh/jihua/blob/main/RFC-003-beta2-fixes.md)
> 工作分支：`feat/hyperai-internal-beta`（从 `5cb91145d2` 往后提交，未新建分支）

## 结论

两个已知问题都修好了，`v0.2.0-beta.2` 已构建并通过 T1～T6：符号链接路径下安装不再静默失败，`install.sh` 会在安装没真正完成时报错退出；干净环境照抄说明的 `doctor` 现在返回 OK，不再有误导性的补丁警告。版本号、铭牌、文件名全部更新到 `0.2.0-beta.2`，两个平台都验证了从 beta.1 覆盖升级、用户数据保留。

## 改了什么

### 问题 1：符号链接路径下的静默失败

- **入口判断**：`apps/profiles/hyperai/scripts/` 与 `apps/tui/scripts/` 下所有使用
  `process.argv[1] === fileURLToPath(import.meta.url)` 的脚本（共 6 个）改为
  `invokedDirectly()`：两边先 `realpathSync` 再比较，解析失败返回 false。
  覆盖：`install.mjs`、`install-skills.mjs`、`manage.mjs`、`build-beta.mjs`、
  `build-package.mjs`、`build-patch.mjs`。
- **安装结果检查**：`install.sh` 在打印“安装完成”之前检查
  `<DSH_HOME>/profiles/hyperai` 目录存在、`.hyperai-install.json` 的 `status` 是
  `completed`；不满足时用中文报错并以非 0 退出。`--dry-run` 跳过该检查。
- **测试**：新增 `apps/profiles/hyperai/tests/entrypoint.test.mjs` 与
  `apps/tui/tests/entrypoint.test.mjs`，把脚本软链到临时目录后执行 `--help`，
  断言主流程真的运行（beta.1 下这里会静默 exit 0）。

### 问题 2：`doctor` 在干净环境返回 FAIL

- **自动使用安装记录的运行时**：`doctor` 没收到 `--dsh-bin`/`--pnpm-bin`（或对应环境变量）时，
  直接使用 `<profile>/.hyperai-install.json` 里记录的 dsh/pnpm 绝对路径，不再依赖 PATH；
  显式参数仍然优先。说明文档里的命令因此简化为 `node profile/scripts/manage.mjs doctor`。
- **补丁检查按布局区分**：新增 `usesProductTarball()`，profile 的依赖是
  `@hyperai/hyperai-tui: file:…` 时（安装包布局）跳过 `copied branding patch is missing`
  检查；旧的补丁布局保持原行为。
- **测试**：新增 `tests/doctor.test.mjs`，覆盖 tarball 布局、旧布局缺补丁、旧布局有补丁，
  以及显式 `--dsh-bin` 优先。
- **文档**：`beta-install.md` 排障一节改用不带 `--dsh-bin` 的命令，删掉“升级后 doctor 报
  dsh 版本 warning”这一条。

### 版本号

`apps/tui/package.json` → `0.2.0-beta.2`，重新生成品牌补丁（铭牌与聊天页标题烘入新版本）；
`hyperai-tui` 说明、`docs/compatibility.md`、`docs/verification.md`、`beta-install.md`
（标题、文件名、铭牌例子）同步更新。上游 `0.16.1`、dsh `0.2.0-rc.2`、pnpm `10.28.1`、
Skills 快照 `34f0a1be0c` 均未变。

## 交付物

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.2.tar.gz` |
| 大小 | 18 461 924 字节 |
| sha256 | `5e393a5020c471724e36783f56cfc4e46d8933114e4afc0aaef8ae0ccf762ada` |
| 构建 commit | `7dc323d35a7824b1ba715248cfd654559553a881` |
| 构建命令 | `cd apps/profiles/hyperai && node scripts/build-beta.mjs` |
| TUI 成品包 | `@hyperai/hyperai-tui@0.2.0-beta.2`，sha256 `ef83574688fa34ded28a8236d000ceea3098729942a72f7fccd63312ed0c7412`，3296 个文件 |
| 服务器位置 | 测试服务器上测试用户的主目录（beta.1 保留在同一目录，供复验升级用；具体路径由负责人口头告知） |

## 测试结果

| # | 检查 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| T1 | 现有测试 + 新增测试 | 通过：tui verify 14/14、tui tests 22/22；profile verify 12/12、profile tests 80/80 | —（按 RFC 不做） | `evidence/rfc-003/macos/t1-tests.log` |
| T2 | 同 commit 两次构建 sha256 一致 | 通过：两次都是 `5e393a50…2ada` | — | `evidence/rfc-003/t2-builds.txt` |
| T3 | 解压到 `/tmp`（符号链接）安装 | 通过：install exit 0、profile 存在、状态 completed、`--dump-config` 611 行 / stderr 0、铭牌 `hyperai-tui v0.2.0-beta.2 · dsh-tui v0.16.1` | 通过：自建 `link → real` 符号链接目录后同样通过 | `macos/t3-*`、`ubuntu/t3-*` |
| T4 | 人为制造安装失败 | 通过：exit 1、输出“安装失败”、`安装完成` 出现 0 次；报错为 `refusing to touch … not created by this installer` | —（按 RFC 不做） | `macos/t4-install.log` |
| T5 | 干净环境照抄说明的 `doctor` | 通过：`OK`，补丁警告 0 次 | 通过：`OK`，补丁警告 0 次 | `macos/t5-doctor.log`、`ubuntu/t5-doctor.log` |
| T6 | 从 beta.1 覆盖升级 | 通过：beta.1 安装成功 → 加假 provider + `lang=en` → beta.2 覆盖 exit 0，provider 保留、语言保留、state version `0.2.0-beta.2`、铭牌 beta.2 | 通过：同上 | `macos/t6-*`、`ubuntu/t6-*`、`runs-summary.txt` |

- Ubuntu 使用测试用户；没有触碰验收测试用户与 `/root`。
- Ubuntu 安装按说明使用国内镜像 `HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com`。
- 两个平台的 T6 都确认了覆盖后 `cordis.patch.yml` 里的假 provider 仍在、`~/.dsh-tui-hyperai/settings.json` 的 `lang=en` 仍在。

## 可复现构建

- 同一 commit `7dc323d35a` 构建两次：`5e393a5020c471724e36783f56cfc4e46d8933114e4afc0aaef8ae0ccf762ada`，18 461 924 B，两次一致。
- TUI 成品包两次构建一致：`ef83574688…c7412`。
- 构建仍由 `build-package.mjs` 的断言守护：上游 size/sha256/integrity、豁免文件逐字节、产物清单 = 上游 3287 + 9 个新增、`vendor/` 保留。

## 已知问题与限制

1. 两平台完整回归由验收 agent 执行；本轮只按 RFC 跑了 T1～T6。
2. `doctor` 的自动解析依赖 `.hyperai-install.json` 里记录的运行时路径；如果用户把 `~/.hyperai` 移走，`doctor` 会退回 PATH，并给出环境错误（此时需要重装或显式 `--dsh-bin`）。
3. 同一 `doctor` 运行仍会检查 Node 版本与 DSH Core 已验证列表，这是既有行为。
4. 旧补丁布局下 `copied branding patch is missing` 检查保留，用于源码 checkout 安装。

## 偏离 RFC 的地方

1. RFC 建议“可以新建 `RFC-003-RESULT.md`”，本次采用新建文件，而不是往 `RFC-002-RESULT.md` 末尾追加。
2. T3 在 Ubuntu 上用“自建符号链接目录”模拟 `/tmp` 场景（服务器没有 macOS 的 `/tmp` 映射）；macOS 上用真实 `/tmp` 路径验证。
3. 证据不提交 PNG 截图（含本机路径），只提交屏幕文本与日志；未提交任何 `/skills` 列表截取。
