# RFC-004 结果报告（v0.2.0-beta.3）

> 关联 RFC：[RFC-004：集成 OpenBayes Skill 与 `/openbayes` 登录命令](https://github.com/lizhenhhh/jihua/blob/main/RFC-004-openbayes-plugin.md)
> 工作分支：`feat/hyperai-internal-beta`（从 `084ad05d52` 往后提交，未新建分支）

## 结论

`openbayes-user` 已经随 HyperAI 安装包一起装到 `~/.agents/skills/openbayes-user/`，Agent 不需要改配置就能发现它；`/openbayes login`、`/openbayes status`、`/openbayes logout` 在 macOS 和 Ubuntu 上都能用。一次性码和令牌只在 TUI 进程与 skill 之间传递，没有进入对话、会话记录、日志或仓库。

O1～O14 中除 **O7/O8/O11 的 Ubuntu 部分**（需要负责人第二次在浏览器确认，为少签一个令牌没有做）和 **O9**（环境里没有可用的模型 provider）外，全部通过。有一项真实账号登录在 macOS 上完成，令牌有效期 1 天。

## 3.2 的验证结论（先做的这一项）

**不改配置就能发现。** 安装前把真实 `openbayes-user` 放进 `~/.agents/skills/`，启动后 `/skills` 同时列出 `openbayes-user`、`ppt-generation`、`example-verified-skill`（见 `evidence/rfc-004/macos/o2.screen.txt`）。DSH 默认扫描的 `~/.agents/skills`（rank 500）已经覆盖这个位置，profile 的 `customSkillDirs` 不需要改，`packages/` 也没有动。

## 实现

### 安装器（`scripts/install.mjs`、`scripts/install.sh`、`scripts/manage.mjs`）

- 安装最后一步下载 `https://openbayes.com/skills/openbayes-user/latest.tar.gz` 到临时目录，校验后解压到 `~/.agents/skills/openbayes-user/`。
- **已存在就不覆盖**：读取 `VERSION`，输出「已有 openbayes-user vX.Y.Z，保留不动」。
- **失败不阻断**：下载失败时输出中文警告和 `npx skills add https://openbayes.com/skills/openbayes-user`，其余安装照常完成（`install.sh` 的安装结果检查不受影响）。
- **压缩包校验**：根目录只能有 `openbayes-user/`；必须有 `SKILL.md`；拒绝绝对路径、`..`、反斜杠、符号链接和硬链接；下载有 60 秒超时和 20 MB 上限。
- **卸载不删**：`manage.mjs uninstall` 保留 `~/.agents/skills/openbayes-user/`，输出保留路径和手动删除命令（其他 Agent 可能也在用）。
- `--no-openbayes` 可跳过；测试用 `HYPERAI_OPENBAYES_URL` 覆盖下载地址（仅测试用，默认值不变）。

### TUI 命令（`apps/tui/src/hyperaiOpenbayes.js`、`hyperaiOpenbayesCore.js`）

- 三个子命令都在 TUI 进程里本地执行 skill 的 `scripts/run_graphql.sh`，不经过模型、不写会话记录。
- `login`：第一段拿到授权链接 → 确认对话框显示链接与说明 → `kind: 'input'` 输入框收一次性码 → 第二段兑换 → 用 `--identity` 读用户名与到期时间。授权链接、一次性码、令牌都不会拼进任何 `notify` 或对话消息；错误信息在展示前还会对一次性码做一次 `redact`。
- `status`：`--identity --pretty` 解析成用户名 / 到期 / 是否过期；未登录时提示 `/openbayes login`。
- `logout`：先确认，再 `--logout`，最后提示「本地登录已删除，服务端令牌仍然有效」并给出控制台吊销地址与 `CLI · <设备名>`。
- 环境名是参数（`VENDORS.openbayes`），`/hyperai` 以后只需要再提供一个 vendor 描述并注册命令；本次没有注册 `/hyperai`。
- 找不到 skill 时显示中文提示和手动安装方法，不报错刷屏。

实现过程中修了两个只有真机交互才会暴露的问题：`dialogs` 适配器只有 `ask({kind})`（不是 `confirm`/`input` 方法）；上游 `InputDialog` 会展开 `initial`，不传会崩，所以显式传 `initial: ''`。

### 版本与文档

- `0.2.0-beta.3`：安装包文件名、TUI 成品包、铭牌、`beta-install.md`、README 同步更新。
- `beta-install.md` 新增第 6 节「使用 OpenBayes」（能力示例、登录、status/logout、吊销、计费确认、令牌安全、更新与遥测、一次性码不要走对话），并注明**授权链接很长，终端里会折行，复制时要确保是一整行**。

## 真实账号登录是怎么做的（O7 记录）

1. 在测试 HOME 里启动 TUI，执行 `/openbayes login`；TUI 调用 `run_graphql.sh --login --vendor openbayes`，把打印出的授权链接显示在确认对话框里。
2. 把链接（一整行，不带换行/空格）发给负责人；负责人在自己已登录的浏览器里打开、确认，令牌有效期选 **1 天**，把页面给出的一次性码发回来。
3. 用同一个 HOME 执行第二段 `--login --vendor openbayes --code <码>`，兑换成功，session 落在 `~/.config/openbayes-skills/session.openbayes.json`（0600）。
4. 在 TUI 里执行 `/openbayes status`，显示实际用户名与到期时间；O8 的屏幕证据里用户名已打码成 `<负责人账号>`。
5. 测试结束执行 `/openbayes logout` 删除本地 session；服务端令牌需要负责人到控制台吊销（见文末提醒）。

TUI 的输码路径（确认 → 输入框 → 错误码提示）用 O10 单独验证；一次性码与令牌没有写进任何证据。本次的授权链接与兑换日志在 `evidence/rfc-004/macos/o7-login-url.txt`、`o7-exchange.log`（设备名已替换成 `$HOST`，不含码和令牌）。

## 交付物

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.3.tar.gz` |
| 大小 | 18 474 512 字节 |
| sha256 | `cc219d5d96b455def35fbd291b3851069401b30b09542870fbec44a174f1574d` |
| 构建 commit | `283cd7f7007ebc0e3d5a942bbd025a236573f572` |
| 构建命令 | `cd apps/profiles/hyperai && node scripts/build-beta.mjs` |
| TUI 成品包 | sha256 `acbac2b2d6b3e937bb3035f99c51c77b20332c6c52cd06bb55106732324d77e2`，3298 个文件（上游 3287 + 11 个新增） |
| 服务器位置 | 测试服务器 `hyperai-beta` 用户主目录（含 beta.1 / beta.2 / beta.3） |

## 测试结果

| # | 检查 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| O1 | 全新安装后有 skill、安装输出有版本号 | 通过：v0.38.1 | 通过：v0.38.1 | `*/o1-install.log` |
| O2 | `/skills` 里有 openbayes-user，ppt-generation 仍在 | 通过 | 通过 | `*/o2.screen.txt` |
| O3 | 已存在的目录不被覆盖、有提示 | 通过 | 通过 | `*/o3-reinstall.log` |
| O4 | openbayes.com 不可达时安装成功 + 中文警告 + 手动方法 | 通过 | 通过 | `*/o4-download-failure.log` |
| O5 | 删除 skill 后 `/openbayes login` 提示清楚 | 通过 | 通过 | `*/o5.screen.txt` |
| O6 | 未登录时 `/openbayes status` 显示未登录 | 通过 | 通过 | `*/o6.screen.txt` |
| O7 | 真实登录：链接 → 负责人确认 → 输入码 → 显示用户名 | 通过（兑换与状态见 O7/O8） | 未测：需要负责人第二次确认，为少签一个令牌没有做 | `macos/o7-*` |
| O8 | 登录后 status 显示用户名、到期时间 | 通过 | 未测（未登录） | `macos/o8.screen.txt` |
| O9 | 让 Agent 查正在运行的容器 | 未测：没有可用的模型 provider | 未测（同左） | — |
| O10 | 错误的码给出中文错误并提示重新登录 | 通过 | 通过 | `*/o10.screen.txt` |
| O11 | logout 先确认，确认后未登录，有吊销提示 | 通过 | 未测（未登录） | `macos/o11.screen.txt` |
| O12 | 会话/日志/证据里没有码和令牌 | 通过：测试目录 grep 不到码；没有 `eyJ` 形态的令牌；session 只用 `ls` 确认存在性 | 同左（未做真实登录） | `runs-summary.txt` |
| O13 | 卸载后 skill 仍保留、输出有说明 | 通过 | 通过 | `*/o13-uninstall.log` |
| O14 | 从 beta.2 覆盖升级，数据保留，铭牌 beta.3 | 通过 | 通过 | `*/o14-*.log`、`*/o14.screen.txt` |

自动化测试：`apps/tui` verify 15/15、`node --test` 34/34；`apps/profiles/hyperai` verify 12/12、`node --test` 90/90。新增测试覆盖入口符号链接、doctor 双布局、`openbayes-user` 安装的下载/已存在/失败/坏包/符号链接，以及 `/openbayes` 的输出解析、错误分类、码校验与脱敏。

## 可复现构建

- 同 commit `283cd7f7` 构建两次：`cc219d5d…1574d`，18 474 512 B，两次一致；TUI 成品包两次一致（`acbac2b2…77e2`）。
- openbayes-user 是**安装时**下载的，不进入安装包，因此不影响安装包哈希。

## 已知限制

1. O9 未测：本机与测试机都没有可用的模型 provider。
2. Ubuntu 的 O7/O8/O11 未测：真实登录需要负责人在浏览器再次确认，本次只在 macOS 完成，避免多签一个令牌。
3. 输码输入框由上游 `kind: 'input'` 面板渲染，**不遮蔽输入内容**；但它不在聊天区，也不会进入会话记录。RFC 允许「至少不回显到聊天区」，遮蔽需要改上游。
4. 输入框与确认框有 5 分钟超时；负责人确认太慢时需要重新执行 `/openbayes login` 生成新链接。
5. `/hyperai` 未注册（按 RFC 要求本次只做 OpenBayes）。
6. 安装时的下载走 Node 的 `http/https`，不读取 `HTTPS_PROXY`；需要代理的环境目前只能靠 `HYPERAI_OPENBAYES_URL` 或系统级透明代理（这一项不在 RFC 范围，未改）。

## 偏离 RFC 的地方

1. O7 的兑换在同一个 HOME 里用 skill CLI 完成（链接由 TUI 生成并展示）；TUI 的「确认 → 输入码」交互单独用 O10 验证。原因是真实授权必须由负责人在浏览器点击，无法在自动化 PTY 里等待人工操作。
2. O4 用测试专用环境变量 `HYPERAI_OPENBAYES_URL` 指向不可达地址来模拟断网，默认下载地址没有改。
3. Ubuntu 上的 O3/O4 用直接调用 `install.mjs` 复跑（第一次脚本里 `dsh plugin install` 找不到 PATH 上的 pnpm，补上 runtime bin 后通过）。
4. 证据不提交 PNG，只提交屏幕文本与日志。

## 需要负责人处理

**请到 <https://openbayes.com/console/settings/account/personalAccessToken> 吊销本次测试签发的令牌**，名字是 `CLI · <设备名>`（有效期 1 天，到期时间 2026-11-06）。本地 session 已经在 O11 里删除，但服务端令牌仍然有效。

## fix-1：证据清理（RFC-004-fix-1）

只改证据文件和本节，没有改代码，也没有重新构建安装包；安装包仍是 `cc219d5d…1574d`。

- `macos/o2.screen.txt`：`/skills` 列表里 `example-verified-skill`、`ppt-generation` 的 description 行（2 行）替换成 `<描述已移除：内部仓库内容>`，技能名保留；`openbayes-user` 的公开描述保留。
- `ubuntu/o2.screen.txt`：同一份列表的线性屏幕文本，按同样的规则打码 2 段内部描述，技能名保留。
- `ubuntu/o10.screen.txt`：授权链接 `device=` 里的测试服务器主机名替换成 `$HOST`，与 macOS 证据一致。

自查在分支最新版本上执行（主机名与用户名按 RFC 要求不写进报告，用占位符表示）：

1. `git grep -nI "Use when" -- apps/ | grep -v openbayes-user` → 16 行。逐条确认：2 行在 `apps/cli/tests/dsh-badge.expected.e2e.ts`，是上游公开的 dsh-badge 官方描述；14 行在 `apps/profiles/hyperai/tests/`，是 `Use when testing` 之类的测试假数据。**没有内部 Skill 描述**；`apps/profiles/hyperai/docs/` 下 0 行。
2. `git grep -nI -e "<服务器主机名>" -e "/Users/<用户名>" -- apps/` → 0 行。
3. 补充检查：`eyJ…` 形态的令牌 0 行；本次测试的一次性码 0 行。

## fix-2：残留设备名清理与两条说明（RFC-004-fix-2）

### 改了什么

- `evidence/rfc-004/ubuntu/o10.screen.txt`：fix-1 只替换了授权链接里的 `device=`，对话框里的「设备名：…」还带着测试服务器主机名。这次把该值替换成 `$HOST`，两处保持一致。
- `docs/beta-install.md` 第 6.1 节新增两条：
  1. 授权链接本身也会过期：要在几分钟内确认并贴回一次性码；过期就重新执行 `/openbayes login`。
  2. 如果授权链接不是以 `https://openbayes.com/` 开头，说明环境里设置了 `OPENBAYES_GRAPHQL_ENDPOINT`（通常只出现在 OpenBayes 容器里）；先 `unset OPENBAYES_GRAPHQL_ENDPOINT`，再重新登录。
- 因为 `beta-install.md` 会打进安装包作为 `README.md`，按 RFC 要求重新构建了 beta.3（版本号不变）。

### 主机名自查（分支最新版本）

- 用完整的主机名片段搜索：0 行。
- 用主机名前 10 个字符搜索：0 行。
- 用主机名前 12 个字符搜索：0 行。
- 报告与提交信息里没有写入主机名本身。

### 新安装包

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.3.tar.gz` |
| 大小 | 18 474 684 字节 |
| sha256 | `b05173077f728b4f9f4cca13d9b91b3cabe86c26ce55399e1a063fb6f86204cd` |
| 构建 commit | `3e34a9d132f11639a432e5e43f72a25c09ef4c46` |
| 构建 | 同一 commit 两次构建，sha256 一致 |
| 包内 README | 与 `docs/beta-install.md` 的 sha256 相同（`9ec764d8e33a30e4bca74df2d7e8c57f99540050715b243411df56043c52baf6`） |
| 服务器 | 已覆盖 `/home/hyperai-beta/hyperai-harness-0.2.0-beta.3.tar.gz`，`sha256sum -c` 通过 |

### 检查

- `apps/tui` verify 15/15、tests 34/34；`apps/profiles/hyperai` verify 12/12、tests 90/90。
- macOS 全新临时 HOME 安装通过（openbayes-user v0.38.1），启动正常，铭牌 `hyperai-tui v0.2.0-beta.3 · dsh-tui v0.16.1`。
- 本轮只改证据与文档，没有改代码；安装包内容除了 README 之外与上一版一致。
