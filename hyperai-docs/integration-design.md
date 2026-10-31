# OpenTUI 集成设计

本文给出 HyperAI TUI 的两条接入路径、取舍与推荐，并给出 OpenTUI 侧的工程约束。代码骨架与目录规范见 [development-guide.md](development-guide.md)；产品功能基线见 [deepseek-tui-reference.md](deepseek-tui-reference.md)。

## 1. OpenTUI 是什么

[OpenTUI](https://github.com/anomalyco/opentui)（MIT）是终端 UI 库：Zig 内核 + TypeScript 直接编写或经 React / Solid 渲染，flexbox 布局，内置 select/input/scrollbox 的键盘与鼠标支持，可显示图片甚至 3D。OpenCode 在生产中使用（数百万用户）。

npm 包：
- `@opentui/core` — 原生终端 UI 库与 TS 绑定
- `@opentui/react` — React 渲染器（**与本仓库 React 专长匹配，推荐**）
- `@opentui/solid` — Solid 渲染器
- `@opentui/keymap` / `qrcode` / `three` / `ssh` — 键位路由、二维码、WebGPU、SSH 服务

工程约束：
- **原生依赖**：Zig 内核以预编译原生模块随 npm 分发；需验证 Node ≥ 24.9 与 macOS/Linux/Windows 目标平台的 ABI 兼容与 `pnpm` 安装链路（`pnpm-workspace.yaml`、`patches/`）。
- **运行时形态**：OpenTUI 接管 stdin/stdout 与终端 raw mode。与 dsh 的日志/stderr 输出、`dsh` 启动器的退出控制需明确分工（TUI 独占 tty，诊断走文件或 TUI 内面板）。
- **ESM**：本仓库 ESM everywhere；OpenTUI 各包需确认 ESM 导出面。
- 开发依赖：OpenTUI 上游用 Bun + Zig；我们只消费 npm 产物，不引入 Bun。

## 2. 路径 A：进程内插件 + `tui` profile（推荐主交付）

仿 `dsh-headless` / `dsh-web-app`：新增 `dsh-tui-app` bundle（`packages/bundle/tui-app`）+ `tui` profile 模板，TUI 驱动与渲染作为 Cordis 插件挂在 `dsh-base` 之上。

```
dsh --profile tui
  └─ bundles: dsh-base → dsh-tui-app
       ├─ tui-startup     注入 cmdlineArgs，提供 ctx.tuiStartup（--resume/--session-id/模型选项）
       ├─ tui-runtime     OpenTUI 渲染进程生命周期（独占 tty）
       ├─ tui-driver      驱动 ctx.agents：followup/steer、订阅 assistant-stream / session/event
       ├─ tui-approval    approval/request 终端 answerer
       └─ tui-questions   user-questions 终端 answerer
```

数据流：
```
用户键盘 → OpenTUI 组件 → tui-driver → agent.followup()
agent/assistant-stream chunk → tui-driver → OpenTUI 流式渲染
session/event（tool/call, tool/result, turn/*）→ 折叠 → 工具卡片/回合状态
approval/request waterfall → tui-approval → 审批对话框 → allowed-once/rejected
userQuestions ask() → tui-questions → 选项/文本回答
```

**优点**
- 能力全：直接持有 `ctx.agents` / `ctx.approval` / `ctx.userQuestions` / `ctx.jobs` / `ctx.commands`，无协议映射损耗。
- 延迟低：`agent/assistant-stream` 是进程内帧，token 级流式无跨进程序列化。
- 与 headless 同构：`packages/bundle/headless` 是现成的直接驱动参考，profile/bundle 组合机制原生支持。
- 遵守「应用只能经 `dsh` profile 启动」的仓库规则；`verify-application-entrypoints` 天然放行。

**缺点/成本**
- 必须遵守仓库插件与构建规则（ESM、tsconfig 工程面、`verify-export-jsdoc`、依赖声明门禁、快照策略）。
- OpenTUI 原生模块进入 pnpm 安装链，平台矩阵风险由本仓库承担。
- TUI 崩溃面与 harness 同进程（需做好 tty 恢复与 effect 回滚）。

## 3. 路径 B：SDK 子进程驱动

TUI 作为**独立进程/独立仓库**的 OpenTUI 应用，经 `@deepseek-ai/dsh-sdk-client`（或 Python SDK）驱动 `dsh --profile sdk` 子进程。

```
HyperAI TUI 进程（OpenTUI 渲染 + 交互逻辑）
   │  stdio JSON-RPC
   ▼
dsh --profile sdk   （完整 harness：工具/审批/会话/子 agent …）
```

SDK 已具备 TUI 所需交互面：
- `harness.run(prompt)` / `HarnessClient.prompt()` 提交输入；
- `approvalRequests: true` + `onRequest` → 逐次审批（`allowed-once`/`rejected`/`cancelled`）；
- `onUserQuestion` → 回答 `ask_user_question`；
- `subscribe` / `subscribeSessionTree` → 通知流（含 session 事件与 agent 状态）；
- `resumeSession(id)`、工作区目录读写。

**优点**
- 解耦干净：TUI 是普通 Node/Bun 程序，构建、测试、发布独立于 dsh 仓库门禁。
- 崩溃隔离：TUI 渲染崩溃不带倒 harness。
- 便于并行原型：不碰 dsh 源码即可验证交互设计。
- 天然支持远端/容器化 harness（SDK 带 `dshHome` 与 workspace 配置）。

**缺点/成本**
- 事件是协议投影：流式增量、工具事件经 JSON-RPC 通知转发，需自建折叠层还原 UI 视图；延迟与带宽多一跳。
- 审批/提问是请求-响应回调形状，需自己排队与超时管理。
- 每个新交互能力（jobs、commands、模型切换等）都要先在 SDK 协议面暴露；协议缺口需回改 dsh（双仓协调）。
- 双进程生命周期管理（启动、崩溃、升级、版本匹配）归 TUI 侧。

## 4. 取舍与推荐

| 维度 | A 进程内插件 | B SDK 子进程 |
|---|---|---|
| 流式延迟 | 最优（进程内帧） | 多一跳序列化 |
| 交互能力覆盖 | 全量 seam 直取 | 受协议面限制，逐步补齐 |
| 仓库/构建约束 | 必须遵守 dsh 门禁 | 独立自由 |
| 崩溃隔离 | 同进程 | 隔离 |
| 参考实现 | headless runner | SDK client + ACP |
| 长期演进 | 与 harness 同版本演进 | 协议兼容负担 |
| 适合 | 产品主交付 | 原型、远端 harness、嵌入第三方宿主 |

**推荐（分阶段）**：
1. **阶段 0 原型用 B**：独立 OpenTUI 小程序 + `dsh-sdk-client`，快速验证终端交互设计（对话流、工具卡片、审批弹层），不阻塞于 dsh 构建门禁。
2. **主交付走 A**：产品化的 HyperAI TUI 落成 `dsh-tui-app` bundle + `tui` profile，进程内驱动，能力全、延迟低。
3. **B 保留为嵌入形态**：远端 harness、第三方宿主集成继续用 SDK 路径，两条路径共享同一套 TUI 呈现组件（渲染层与驱动层解耦，见下）。

**渲染层与驱动层解耦**：无论 A/B，OpenTUI 组件只消费「视图模型」（流式文本、工具卡片、审批请求、问题、会话列表），驱动层负责从 seam（A）或协议（B）填充。这样阶段 0 的原型代码可平移到阶段 1。

## 5. 交互能力映射（两路径对照）

| 交互 | A 进程内 | B SDK |
|---|---|---|
| 审批 | `ctx.on('approval/request', …)` 返回 outcome | `onRequest` 回调返回 outcome |
| 结构化提问 | `ctx.userQuestions` answerer | `onUserQuestion` 回调 |
| 流式渲染 | `agent/assistant-stream` chunk | 通知流（提交点事件，非逐 token）* |
| 输入 | `agent.followup()` / `steer()` | `prompt()` / `run()` |
| 会话恢复 | `ctx.agents.resume` | `resumeSession` |
| 停止 | `agent.cancel()` / `turn-stopping` | 协议 cancel |

\* SDK 的 `text`/`thinking` 是提交点投影（step 提交时到达），逐 token 实时流是 A 路径优势之一；B 路径若需 token 级流式，需扩展协议或改走 A。

## 6. 渲染层设计（OpenTUI + React）

- 采用 `@opentui/react`：与仓库 React 经验一致；组件模型与 Web `ui-*` 的呈现思路（工具卡片、思考折叠、输入框、审批弹层）可平移为终端尺寸的设计。
- 布局：flexbox 分区——会话滚动区 / 输入区 / 状态栏（模型、费用、模式）/ 弹层（审批、问题、命令面板、帮助）。
- 流式渲染策略：对 `text-delta`/`reasoning` 增量做节流重绘（终端帧率有限），回合边界整卡刷新。
- 文案走 locale 字典（对齐仓库「产品可见文案 locale-owned」规则）。
- 工具卡片呈现遵循仓库约定：**从原始事件派生，不入日志**；未知工具回退通用形态（Web 侧先例 `docs/cookbook/adding-a-tool.md` 的 UI 呈现章节）。

## 7. DeepSeek app（Web/Desktop）走的是哪条路

dsh 官方产品 app 的实际接线是：**路径 A 的组合模型 + 被迫分离的渲染进程**，不是路径 B。

- **驱动层 = 路径 A**：`dsh-web-app` bundle 骑在 `dsh-base` 上，`packages/api/*-controller` 的 Host 半边与 harness 同进程，直接驱动 `ctx.agents`、裁决审批、持有权威状态。
- **呈现层 = 独立进程**：`packages/client/*` 是浏览器里的另一个 Cordis 应用，经内部 API Gateway（Typert Remote，WebSocket/SSE）连接 Host；依赖方向为 Host 状态 → Remote 传输 → Client 模型（React-free 镜像）→ UI 适配 → Slots → React（`docs/subsystems/web-client.md`）。
- **Desktop 只是换载体**：Electron Host 跑同一 CLI profile runner 与 Web 应用，窗口加载打包 Web 资产、走 IPC 桥（`docs/architecture.md` Desktop 节）。
- **路径 B 形状（跨进程协议驱动）是程序化表面**：SDK/ACP/Python SDK 用它，不是产品 app 的做法。

对 TUI 的启示：
1. `dsh-tui-app` bundle 进 profile 树、进程内驱动，与官方 app 同构，是"正统"做法。
2. Web 的 RPC 分离层是浏览器所迫；OpenTUI 可同进程渲染，TUI 无需 API Gateway 那套 Client 镜像，比 Web 更轻。
3. 仅当需要"远端 harness + 本地 TUI"时才引入 host/controller + wire + client model 分离（参照 web-client.md 的分层与重连设计），此时不要退回 SDK 协议——其流式是提交点投影，token 级体验掉档。

## 8. 多表面并用（web / Desktop / TUI）的相互影响

进程拓扑上 A/B 等价：每个表面各起自己的 harness 进程（B 只是 TUI 多带一个 sdk 子进程），内存与 agent loop 互不相干。真正的共享面与对策：

| 共享面 | 风险 | 现有防护 | 对策 |
|---|---|---|---|
| 工作区文件 | 多 agent 改同一批文件 | 无（Session 记录 cwd 但不限制） | 各表面不同目录 / git worktree |
| Harness home（`$DSH_HOME`） | 设置/凭据并发写覆盖（storage-json 无跨进程锁，last-write-wins；storage-sqlite 明言跨进程协调 out of scope） | 弱 | 每表面独立 `DSH_HOME`（仓库明文推荐的隔离方式） |
| 会话日志 | 两会话写者冲突 | **内核锁单写者**（`session.lock` 的 flock / Windows 信号量），跨进程排除第二写入方；崩溃锁随进程释放 | 同一时刻一个驱动者，后到者获拒绝；共享 home 时可用于跨表面续聊 |
| tty / 端口 | TUI 占前台 tty；web/Desktop 各占端口 | 互不冲突 | 一 tty 一 TUI |

结论：**避免相互影响的杠杆是部署隔离（独立 `DSH_HOME` + 独立工作区），不是选 B**；B 仅把显式 home 变成启动参数更顺手。隔离需求不构成选 B 的理由；B 的适用场景仍是"薄客户端 + 远端/容器 harness"。

## 9. DeepSeek-TUI 经验的落位

- 功能验收基线（三模式、推理力度、思考流、费用、回滚等）取自 [deepseek-tui-reference.md](deepseek-tui-reference.md) 的清单；其中「工作区 side-git 回滚」「doctor 自检」列为可选特性。
- 其 ratatui 实现不可移植（技术栈不同），但**键位设计、审批对话框、草稿/暂存、命令面板**等终端 UX 模式直接参考。
- 其独立 agent 栈不采纳：能力一律复用 dsh seam，避免两套模型可见语义。
