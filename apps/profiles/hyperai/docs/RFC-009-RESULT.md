# RFC-009 结果报告：启动时强制登录 OpenBayes（v0.2.0-beta.6）

> 关联 RFC：RFC-009（启动时强制登录 OpenBayes）
> 工作分支：`feat/hyperai-internal-beta`（从 `c7e3b1ffad` 往后提交，未新建分支、未强推）

## 结论

TUI 启动时先用 `openbayes-user` 的 `run_graphql.sh --identity` 做离线检查：没有登录或已过期时，用不可取消的阻塞对话框挡住聊天，只能登录或按 Ctrl+D 退出；有效期内直接进入，不弹登录界面。剩余不足 3 天每次启动提醒，使用中到期只提示一次，断网/被吊销只提示一次，`/openbayes logout` 立即回到登录界面。没有修改 skill，没有读 session 文件内容。macOS 与 Ubuntu 的 L1～L13、U1～U3 均通过；升级前后 7 类用户数据哈希不变，已登录用户升级不需要重新登录。

## 实现方式

### 登录界面挂在哪

`Chat` 挂载 `useOpenbayesGate()`；门激活时：

1. 显示阻塞式 `confirm` 对话框（标题「登录 OpenBayes（必需）」，正文说明三步登录和 Ctrl+D 退出），Esc/取消后立即重新打开，不能进入聊天；
2. 挂起输入框（`PromptInput suspended`），并让落地页提交（`refusedAtStartup`）返回拒绝，消息和斜杠命令都发不出去；
3. 登录流程复用 `/openbayes login` 的 `runLoginFlow()`：授权链接 → 确认 → 一次性码（输入框打码）→ 成功提示；码无效时显示错误并回到门，可以重试；skill 缺失时显示手动安装命令，选「重新检测」重试。

关闭登录门要同时满足：`--login --code` 成功、`--identity` 能读到未过期的 session。

### 离线判断与在线确认

- 启动：`resolveOpenbayesContext()` 找 `~/.agents/skills/openbayes-user/scripts/run_graphql.sh`；`--identity --pretty` 只读本地 session。
- `classifySession()`：`missing` / `expired` / `expiring`（剩余 <3 天）/ `valid`；`expires_at` 用 `Date.parse`，按本机时区算整秒，避免时区差一天。
- 有效时后台异步执行 `whoami`（`--query-file …/whoami.graphql`），不阻塞首帧；网络失败提示「连不上」，401/吊销提示「登录已失效」。
- 使用中每 10 秒重新读一次本地 session；到期只提示一次，不打断会话，下次启动才回到登录界面。
- `/openbayes logout` 删除本地登录后调用 `requireLogin()`；成功提示改为通知（toast），不再等用户关闭对话框，所以 logout 后马上回到登录界面。
- 跳过开关只认 `HYPERAI_LOGIN_GATE=off`；跳过时收起落地页，并在输入框上方常驻「测试模式：已跳过 OpenBayes 登录」。

### 补丁点（4 处，已获负责人同意）

RFC 要求渲染/输入改动不超过 3 处，实际 4 处，负责人 2026-11-09 同意：

1. 挂载 `useOpenbayesGate` + 传入 `onLoggedOut`；
2. 门激活时 `setLaunchpadOpen(false)`（否则落地页会盖住对话框）；
3. `PromptInput` 的 `suspended` 增加门状态；
4. `refusedAtStartup` 在门激活时拒绝落地页提交。

原因：只挡对话框不够——落地页和输入框仍能提交，消息会直接发给模型；因此必须同时挂起输入框并拒绝落地页提交。第 2 处是调试中发现的真实遮挡问题。

## L1～L13

| # | 场景 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| L1 | 未登录启动：登录界面挡在聊天前，输入消息/其他命令不能绕过 | 通过 | 通过 | `*/l1*` |
| L2 | 登录成功：浏览器授权 + 一次性码后进入聊天 | 通过 | 通过 | `macos/l2.txt`、`ubuntu/l2b.txt` |
| L3 | 码无效：显示错误，可重新开始且不用重启 | 通过 | 通过 | `*/l3*` |
| L4 | 有效期内重启 3 次：直接进入，不弹界面 | 通过 | 通过 | `*/l4*` |
| L5 | 剩余 <3 天：启动提醒 + status 显示即将到期 | 通过 | 通过 | `*/l5*` |
| L6 | 已过期：启动显示过期原因并挡在聊天前 | 通过 | 通过 | `*/l6*` |
| L7 | 断网：照常进入，提示一次 | 通过 | 通过 | `*/l7*` |
| L8 | 服务端吊销：提示重新登录 | 通过（已进入聊天路径） | 通过 | `*/l8*` |
| L9 | 使用中到期：只提示一次，不打断；下次启动回登录界面 | 通过 | 通过 | `*/l9*` |
| L10 | `/openbayes logout`：立即回到登录界面 | 通过 | 通过 | `*/l10*` |
| L11 | skill 缺失：提示手动安装 + 重新检测 | 通过 | 通过 | `*/l11*` |
| L12 | 跳过开关：精确 `off` 才跳过，界面持续标识；`0` 不跳过 | 通过 | 通过 | `macos/l12a5.txt`、`ubuntu/l12a.txt`、`ubuntu/l12b.txt` |
| L13 | 启动不明显变慢 | 通过 | 通过 | `timings.txt` |

启动耗时（到出现输入提示，秒）：

| 平台 | beta.5 | beta.6 |
|---|---|---|
| macOS | 6.523 / 5.260 / 5.188，平均 5.657 | 2.211 / 1.641 / 1.645，平均 1.832 |
| Ubuntu | 4.405 / 4.183 / 4.207，平均 4.265 | 4.187 / 4.439 / 4.357，平均 4.328（+1.5%） |

macOS 的 beta.5 环境带上一轮的数据，beta.6 是干净环境，绝对值不可直接比；但 beta.6 没有比 beta.5 慢。Ubuntu 两套环境都只装包、不造数据，+1.5% 属于正常波动。

## U1～U3

| # | 场景 | 结果 |
|---|---|---|
| U1 | beta.1 → beta.6：启动要求登录；7 类数据不变 | 通过（`hash=same`，门出现） |
| U2 | beta.5 → beta.6：已登录用户不需要重新登录；7 类数据不变 | 通过（`hash=same`，不弹门） |
| U3 | 7 类数据：provider、API key 哈希、模型、偏好、会话、自建 Skill、内置 Skill 文件 | 两条升级路径前后逐行一致 |

升级提示：覆盖升级场景新增「从这个版本开始，启动时需要登录 OpenBayes 账号（每台电脑登录一次，有效期内启动会直接进入）」。全新安装的首次使用提示也改为先登录再 `/provider`。

## 安装包

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.6.tar.gz` |
| 大小 | 18 483 544 字节 |
| sha256 | `134fe71597a4f9650bc859acdf4284429c4dcf8d420ea30b41d469a3c26514ca` |
| 构建 commit | `326b41a0ea3d0441dea5aa9d0aa9334f1739634d` |
| 构建 | 同一 commit 两次构建，sha256 一致 |
| 服务器 | 已覆盖测试服务器开发测试用户 home 下的 beta.6，beta.5 保留 |

## 测试与自查

- `apps/tui`：verify 15/15、`node --test` 40/40（新增登录门核心用例）。
- `apps/profiles/hyperai`：verify 12/12、`node --test` 102/102。
- 固定自查 4 条：

1. 不提交 `/skills` 列表截屏、内部 Skills 描述：证据目录无 PNG，`git grep -nI "Use when"` = 0。
2. 主机名前缀 `git grep` = 0。
3. 不出现令牌/假 key/一次性码/`/Users/<名字>`/`/home/<测试用户>`：均为 0（证据里的路径替换成 `$HOME`/`$BETA_ROOT`，测试码替换成 `<测试成功码>`/`<测试错误码>`）。
4. 测试 stub 不在安装包里：`tar tzf` 无 `openbayes-stub`；它只在 `apps/tui/tests/fixtures/`。

## 偏离 RFC 的地方

1. **登录界面用阻塞对话框而不是新页面**：仍然是「登录完成前不能进入聊天」，且输入框被挂起、落地页提交被拒；没有新增整屏页面。
2. **补丁点 4 处**（见上），超出 RFC 的 3 处上限，已获负责人同意。
3. **logout 的成功提示改成通知**：原来要等用户关闭成功对话框才触发回门，不满足「立即回到登录界面」；现在先回门，成功信息用 toast。
4. **L10 一开始复现失败**：根因是测试 stub 在 logout 后把 state 重新初始化成有效 session，不是产品时序问题；修正 stub 后稳定复现并通过。产品的 `requireLogin()` 仍然加了「等待在途检查结束」的保护，避免和 10 秒轮询撞车。
5. **Ubuntu L2 第一次失败**：测试脚本没把 Node 20+ 的 PATH 带进 TUI，启动到了系统 Node 18；补 PATH 后通过，不是产品问题。
6. **L8「还没进入聊天时被吊销」**：离线有效时会先进入聊天再异步 whoami，所以这条只测到「已进入聊天」的路径；启动阶段没有强制在线确认。行为上仍会提示重新登录，但没有单独的启动期拦截。

## 风险与未解决问题

1. 服务端在启动瞬间已吊销、但本地 session 未过期时，用户会先进入聊天再收到提示（见偏离 6）；如果要求启动期就必须在线确认，需要再改流程。
2. 门激活时输入框被挂起，但落地页里的已输入草稿仍在内存里；登录成功后可以继续发送（不会丢）。
3. 测试覆盖依赖 stub；真实 skill 的 `--identity` 字段变化会直接影响判断，已在核心单测里锁定字段名。

## fix-1：可以跳过登录（v0.2.0-beta.6 重建）

### 改了什么

- 登录界面从两选项改为三选项：**登录（默认）/ 跳过 / 退出程序**；标题会显示原因（未登录、已过期、已失效），登录选项说明里写了「浏览器确认 + 粘贴一次性码」。选择跳过会收起门、进入聊天。
- 「已跳过」保存在 `~/.dsh-tui-hyperai/login-skip.json`（权限 0600，只有 `skipped` 和 `at`，不含账号信息）。覆盖升级和重装都保留；成功登录（门内或 `/openbayes login`）会清除；`/openbayes logout` 不受影响，仍回登录界面。
- 未登录时输入框上方常驻「未登录 OpenBayes · /openbayes login」；`/openbayes status` 显示「未登录（已跳过登录）」，并提示可以登录。
- 测试开关 `HYPERAI_LOGIN_GATE=off` 不变：不写跳过记录，一直显示「测试模式」。
- 文案：`beta-install.md` 改为「登录 OpenBayes（推荐）」，写明跳过、再登录和需要登录的功能；install.sh 升级提示与首次使用提示改为「可以跳过」。
- 没有新增补丁点，仍是已同意的 4 处。

### K1～K13

| # | 场景 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| K1 | 从没登录：三个选项，默认登录，说明可见 | 通过 | 通过 | `macos/k1z.txt`、`ubuntu/k1` |
| K2 | 选跳过：进入聊天、能发消息、显示未登录标识 | 通过 | 通过 | `macos/k2.txt`、`ubuntu/k2` |
| K3 | 跳过后连续启动 3 次：不弹门、标识一直在 | 通过（3/3 无门、3/3 有标识） | 通过（3/3 无门、3/3 有标识） | `macos/k3d-1.txt`、`ubuntu/k3-*` |
| K4 | 跳过后让 Agent 操作 OpenBayes | **部分通过**：skill 仍加载、没有被隐藏或拦截；没有真实模型，未测到 skill 的登录提示 | 同左 | — |
| K5 | 跳过后 `/openbayes login`：成功、标识消失、记录清除、重启不弹 | 通过 | 通过 | `macos/k5c.txt`、`ubuntu/k5` |
| K6 | 登录过期：门标题说明已过期，有跳过；跳过后重启不弹 | 通过 | 通过 | `macos/k6z.txt`、`ubuntu/k6` |
| K7 | `/openbayes logout`：回门，有跳过 | 通过 | 通过 | `macos/k7.txt`、`ubuntu/k7` |
| K8 | 有效、剩余 2 天：每次启动提示续期 | 通过 | 通过 | `ubuntu/k8b` |
| K9 | `HYPERAI_LOGIN_GATE=off`：只认精确值，常驻测试模式，不写跳过记录 | 通过 | 通过 | `macos/k9.txt`、`ubuntu/k9` |
| K10 | 登录界面不能绕过：输入消息/命令无效 | 通过 | 通过 | `macos/k10.txt`、`ubuntu/k10` |
| K11 | 升级：beta.5→beta.6 已登录不弹门、7 类哈希不变；beta.1→beta.6 首次启动出现带跳过的门 | 通过（beta.5 路径） | 通过（两条路径） | `macos/k11`、`ubuntu/k11`、`k11-before/after` |
| K12 | 跳过记录在覆盖升级后保留 | 通过 | 通过 | `macos/k3d-*`、`ubuntu/k12` |
| K13 | 现有测试 + 新增测试；两次构建一致 | 通过（TUI 44/44、profile 102/102；`f6eac904…` 两次一致） | — | — |

说明：

- K4 只验证到「skill 仍在加载、不被拦截」；让模型真正调用 skill 需要真实模型，stub 只覆盖登录脚本。
- K11 的 beta.1 路径本轮只验证了「升级后出现带跳过的登录界面」；7 类哈希在 RFC-009 的 U1（同一升级路径）已逐项对比为一致。
- 登录界面标题包含原因和登录步骤，是因为 managed `select` 对话框只渲染标题与选项，不渲染 `message`；最初把原因放在 message 里，测试发现界面上看不到。

### 新安装包

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.6.tar.gz`（版本号不变） |
| 大小 | 18 483 230 字节 |
| sha256 | `f6eac9049c3be9c84c8f306c3635185fc58150e51350a953270ede635a98eaca` |
| 构建 commit | `8777e27c29898d94edff38666661b0c84419d102` |
| 构建 | 同一 commit 两次构建，sha256 一致 |
| 服务器 | 已覆盖开发测试用户 home 下的 beta.6，beta.5 保留 |

### 固定自查

1. 无 `/skills` 截屏、无内部 Skill 描述：证据目录 PNG = 0，`Use when` = 0。
2. 主机名前缀 grep = 0。
3. 令牌 / 一次性码 / 假 key / `/Users/<名字>` / `/home/<测试用户>` = 0。
4. 测试 stub 不在安装包里：`tar tzf` 无 `openbayes-stub`。

### 偏离与已知问题

- 登录界面的说明放在标题和选项描述里（原因同 K 说明），没有额外渲染区域。
- K4 的模型侧交互未测，已如实标注。
- 「退出程序」选项调用 Chat 的 `onExit`（和 `/exit` 同一条路径），不是直接 `process.exit`。
