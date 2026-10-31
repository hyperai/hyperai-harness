# dsh 对 TUI 的支持现状

本文回答一个问题：**今天在 dsh 上做 TUI，手上有什么、缺什么**。结论先行：dsh 没有 TUI 实现，但把 TUI 需要的每个能力都做成了可复用的 seam；缺的是「终端渲染层 + 交互驱动插件」这一层外壳。CLI 文档里的 `dsh --profile tui --resume <id>` 示例（`apps/cli/README.md`）是假设句（"assuming the tui profile is installed"），说明官方预期 TUI 以自定义 profile 形式存在，而非独立程序。

## 1. TUI 需要什么 → dsh 给了什么

| TUI 需求 | dsh 现有机制 | 位置 | 成熟度 |
|---|---|---|---|
| 创建/恢复会话 | `ctx.agents.create` / `ctx.agents.resume({ resumeSessionId })` | `packages/core/agent` | 成熟，Web/headless/SDK 在用 |
| 提交用户输入 | `agent.followup(message)`（排队）/ `agent.steer(message)`（进下一步） | `docs/subsystems/core.md` | 成熟 |
| 实时渲染输出 | `agent/assistant-stream`（start/chunk/end，进程内） | `packages/core/agent-loop` | 成熟；Web 的唯一远端消费者是 Session-follow 适配 |
| 持久事实渲染 | `session/event` 广播（`assistant/message`、`tool/call`、`tool/result`、`turn/*`） | `packages/core/session` | 成熟 |
| 工具调用呈现 | 从原始 `tool/call`/`tool/result` 事件 + 持久 result 元数据派生卡片（Web 侧先例 `packages/client/ui-tool`） | 各 UI 自行呈现 | 呈现约定已文档化 |
| 审批确认 | `ctx.approval.request()` + `approval/request` answerer waterfall；策略 ask/never | `packages/interaction/user-approval` | 成熟；**缺终端 answerer** |
| 结构化提问 | `ctx.userQuestions.ask()/askTimed()` + answerer waterfall | `packages/interaction/user-questions` | 成熟；词汇限「选项 + 自定义文本」 |
| 权限预设切换 | `dsh-permission-presets`、`--permission-mode` | `packages/interaction/permission-presets` | 成熟 |
| 会话恢复/续跑 | headless `--session-id`（cwd/预设/所有权校验）；SDK `resumeSession` | `packages/bundle/headless`、`packages/sdk` | 成熟 |
| 后台任务 | `ctx.jobs` + `job_*` 工具 | `packages/jobs` | 成熟 |
| 命令（斜杠命令） | `ctx.commands` 注册、无模型回合直接派发 | `packages/interaction/commands` | 成熟 |
| 模型/力度选择 | Session 模型选择投影、`ReasoningEffortId` | `packages/core/agent-loop`、`packages/llm` | 成熟 |
| 子 agent | `packages/subagent`（spawn/fork） | 同左 | 成熟 |
| 上下文压缩 | `packages/compaction` | 同左 | 成熟 |
| LSP 诊断 | `packages/lsp` | 同左 | 成熟 |
| 费用/统计 | `token-meter`、`session-stats` | `packages/llm`、`packages/session` | 成熟 |
| 技能 | `packages/skill` | 同左 | 成熟 |

## 2. 三个直接可用的参考驱动

**headless runner（`packages/bundle/headless/src/index.ts`）** — 进程内直接驱动 `ctx.agents` 的完整范例：解析任务/会话身份/权限选项 → 创建或认领 Agent → `followup()` 提交 → 观察 reasoning 流（stderr）→ 等待静默 → 折叠持久区间得出最终文本。它证明了「不走浏览器、不走协议」的最小驱动形态。局限：一次性运行、无交互追问、无实时审批通道（README 明言 "Headless has no live approval-response channel"）、`--json` 事件流是投影而非日志（8 KiB/字段上限）。

**SDK 客户端（`packages/sdk/client`）** — 跨进程驱动范例，且**已支持 TUI 最需要的两个交互回调**：
- `approvalRequests: true` + `client.onRequest(handler)` → 逐次审批决定（`allowed-once` / `rejected` / `cancelled`）；
- `onUserQuestion` 回调 → 回答 `ask_user_question`（`{ answers: [{ id, selected, custom? }] }`）。
另有 `resumeSession`、工作区目录读写、通知订阅（`subscribe` / `subscribeSessionTree`）、`session/wait`。这是一条**今天就能接 OpenTUI** 的路径。

**extension-cookbook 的 UI 插件范式（`docs/cookbook/extension-cookbook.md`）** — 官方给出的 UI 插件写法：订阅 `agent/assistant-stream` 渲染增量，用 `agent.followup()` 回灌输入。这正是 TUI 插件该有的形状。

## 3. 缺口清单（TUI 外壳要补的东西）

1. **终端渲染层**：dsh 无任何终端 UI 库绑定。Web 半边（`packages/client/*`）是 React + 浏览器 Slots 体系，不可复用到终端；终端需要独立呈现层（OpenTUI）。
2. **终端 answerer**：审批与提问的 waterfall 已就绪，但现有 answerer 只有 Web（`ui-approval`、`ui-user-questions`）与 ACP 的机器一次性应答者。TUI 必须提供自己的 `approval/request` 与 user-questions 应答者，否则请求 fail-closed（`unavailable`）。
3. **tui profile / bundle**：出厂 profile 无 `tui`。需要自建 `dsh-tui-app` bundle + `tui` profile（`dsh.profile.bundles` + `cordis.patch.yml`），且只能经 `dsh` 启动器启动。
4. **多轮交互生命周期**：headless 一次即退。TUI 需要长驻进程内的「输入 → 队列 → 渲染 → 再输入」循环，以及空闲/运行中状态呈现（`agent.status`、`whenIdle()`）。
5. **会话列表/恢复 UX**：headless 只有 `--session-id` 精确续跑；TUI 需要会话列举（`sessionQuery`）与恢复交互。
6. **人类可见输出的快照覆盖**：仓库测试策略要求人类可见变更配无密钥录制会话快照；TUI 的 transcript 输出需要规划对应快照层（`snapshots/` 目录当前按 headless/sdk/acp/web 分）。
7. **locale**：产品可见文案需走 locale 字典（Web 侧由 `verify-client-ui-i18n` 强制）；TUI 文案应同样集中管理。

## 4. 与 DeepSeek-TUI 功能基线的差距对照

[DeepSeek-TUI](deepseek-tui-reference.md) 是独立 Rust agent，功能清单可作产品验收基线。dsh 侧能力其实**更全**（seam 化），缺的主要是 TUI 呈现与部分交互体验：

| DeepSeek-TUI 功能 | dsh 能力 | TUI 需补 |
|---|---|---|
| Plan/Agent/YOLO 三模式 | 权限预设 + ask/never + sandbox | 模式切换 UI |
| 思考流式 | `agent/assistant-stream` reasoning delta | 终端渲染 |
| 会话恢复 | session 恢复 + 校验 | 会话列表 UI |
| 工作区回滚（side-git） | 无对应 | 可选特性（非必需） |
| 持久任务队列 | `ctx.jobs` | jobs 面板 |
| runtime API | SDK / ACP / web | 不需要（dsh 已有） |
| MCP / skills / LSP / compaction | 均有 seam | 呈现即可 |
| 费用追踪 | token-meter | 状态栏显示 |
| `doctor` 自检 | 无 | 可选 |
| 多语言 UI | locale 体系 | TUI 文案接入 |

## 5. 结论

dsh（upstream）对 TUI 的支持现状是：**能力层完备、外壳层空白**。所有模型可见语义（工具、审批、会话、子 agent）都应复用 dsh seam；TUI 工作 = 渲染层（OpenTUI）+ 交互驱动（进程内插件或 SDK 客户端）+ 终端 answerer + `tui` profile。路径取舍见 [integration-design.md](integration-design.md)。

**本 fork 的实现现状（2026-10）**：上述外壳已由 `apps/tui/` 补齐——`tui` profile（`dsh-base` + `@hyperai/hyperai-harness-tui` bundle）进程内驱动 `ctx.agents`，OpenTUI `@opentui/core` 渲染，`approval/request` 与 `user-questions/request` 终端 answerer 就位，会话/模型/权限/通知/locale 齐备。本文第 1–4 节列出的缺口已逐项闭合（唯一推迟项：顶层 `snapshots/tui/` 录制场景，需 TUI 帧适配器）。进度账见 [development-plan.md](development-plan.md)。
