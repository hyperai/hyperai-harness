# 项目概览

本 fork（`hyperai/hyperai-harness`）基于 DeepSeek Harness（`dsh`）`0.2.2-alpha.2`，目标是引入 OpenTUI 定制 HyperAI 的 TUI。本文梳理 dsh 的架构与包布局，作为后续开发的共同底图。契约细节以仓库内 `docs/architecture.md`、`AGENTS.md` 与各包 README 为准。

## 1. dsh 是什么

dsh 是 DeepSeek AI 的开源 agent harness，建立在 **everything-is-a-plugin** 架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动：模型适配器、工具注册表、会话日志、agent loop 本身都是插件，都可以从配置替换。没有特权内核可打补丁——扩展方式是把插件挂到同一棵树旁，注册即 effect，插件卸载即回滚。

当前处于 *developer preview*，公开 API 与会话格式都会有破坏性变更。

## 2. 仓库布局

```
vendor/      Cordis 等 vendored 源码（vendor/README.md 管同步）
packages/    @deepseek-ai/dsh-<pkg> 工作区，按组划分
  core/        agent / session / system-prompt / tools / agent-loop / scope
  api/         远端 BFF（session/workspace/terminal/settings/job controller, gateway）
  llm/         模型提供方（llm-deepseek 等）
  shell/ subprocess/ ssh/ terminal/   命令与进程执行
  session/ session-query/             会话持久化、格式、投影、检索
  interaction/                        user-approval / user-questions / commands / permission-presets
  sandbox/ fs/ lsp/ skill/ mcp/ web/ computer-use/ browser-use/
  subagent/ jobs/ workflow/ todo/ plan/ goal/ schedule/ preset/ guard/
  bundle/     profile 分发层（base / web-app / headless / sdk-app / sdk-minimal / acp-app）
  boot/       app-boot / cmdline / hmr / plugin-manager
  sdk/        JSON-RPC 协议 + TS client/server（python/ 是 Python SDK）
  acp/        automation-only ACP stdio 服务
  client/     Web GUI 浏览器半边（React，~50 个 ui-* 包）
  host/       Web 服务端半边
  experimental/  无产品支持承诺的实验能力
apps/
  cli         dsh 启动器（唯一受支持的 Node 应用入口）
  web         Web 应用
  desktop / desktop-host   Electron 桌面
python/ native/ benchmarks/ .agents/ docs/ scripts/ website/ snapshots/
```

## 3. Profile 与 Bundle：运行时是组合出来的

- **Profile** = Harness home 下的命名组合（`$DSH_HOME/profiles/<name>`），列出它堆叠的 bundle、树外插件与用户 `cordis.patch.yml`。出厂模板：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`。
- **Bundle** = Cordis 配置行 + 其挂载代码的分发格式，声明在包的 `package.json` 的 `dsh.bundle`；profile 的 `dsh.profile.bundles` 按序堆叠它们。
- 组合顺序（作用于空列表）：profile 的 bundles → profile 的 `cordis.patch.yml` → home patch → `--patch` overlay。patch 按 `id` 整行替换 config 或插入新行。
- `dsh --profile <name> --dump-config` 可查看本机实际启动树；任何一行都可被 patch 替换。

[`dsh-base`](../packages/bundle/base/README.md) 是 web/headless/sdk/acp 共享的第一层（模型适配、工具、持久化、沙箱与审批策略、设置、凭据、遥测）；`dsh-web-app` 加浏览器应用，`dsh-headless` 加一次性运行器，`dsh-sdk-app` 加 JSON-RPC 服务，`dsh-acp-app` 加 ACP 服务。

**应用启动规则**：受支持的 Node 应用只能通过命名 `dsh` profile 启动（`dsh --profile <name>`）；包 bin、demo、树内可执行文件都被 [`verify-application-entrypoints`](../scripts/verify-application-entrypoints.ts) 拒绝。**HyperAI TUI 必须以 profile 形式落地，不能是独立 bin。**

## 4. 核心概念

- **Session 日志**：append-only `SessionEvent` 日志是模型可见上下文的唯一来源；`deriveMessages()` 从它投影模型历史。**模型可见 ⟺ 已记录**：任何进入模型请求的内容都必须能从日志重建，新的模型可见输入需要新增 session 事件。
- **Turn / Step**：step = 一次模型请求 + 其工具调用；turn = 零或多 step，从认领第一条输入开始到无欠账为止。
- **三类事件域**：session 事件（持久事实，`session/event` 广播）、agent 事件（`agent/*`，在飞工作）、capability 事件（`fs/*`、`tools/*` 等，挂策略/适配器）。waterfall 监听器必须调 `next()` 委派。
- **Capability seam**：可替换能力 = Service Definition / Provider / Consumer 三角色。换一个 provider 即可整体切换（如文件系统+子进程换到远端沙箱）。
- **Projection seam**：`ctx.sessionProjections` 折叠已提交事件，供客户端视图 `snapshot()` 读取。

关键扩展点（完整表见 [architecture.md](../docs/architecture.md#where-new-behavior-goals)）：

| 目标 | 机制 |
|---|---|
| 新 UI / 编辑器集成 | 驱动 `ctx.agents`，从 `session/event` 渲染 |
| 输入回灌 | `agent.followup()`（排队）/ `agent.steer()`（进入下一步） |
| 审批门 | `approval/request` waterfall（`ctx.approval`） |
| 结构化提问 | `ctx.userQuestions` 的 answerer waterfall |
| 拦截请求/工具/回合 | `agent/*`、`tools/*` 事件；`agent/turn-stopping` 停回合 |

## 5. 现有界面与 TUI 现状

| 表面 | 形态 | 交互性 |
|---|---|---|
| Web GUI | 浏览器 React 应用（`packages/client/*` + `apps/web`） | 全功能多轮交互 |
| Desktop | Electron 包 Web 应用 | 同 Web |
| headless | `dsh --profile headless "task"` | 一次性，无交互追问（`--json` 事件流） |
| SDK | `dsh --profile sdk` + JSON-RPC stdio | 程序化，可审批/提问回调 |
| ACP | `dsh --profile acp` | 自动化协议 |
| **TUI** | **不存在** | CLI 文档中的 `dsh --profile tui` 仅为假设示例 |

详细的 TUI 接入面与缺口分析见 [tui-support-status.md](tui-support-status.md)。

## 6. fork 侧必守的仓库约定

- ESM everywhere（`"type": "module"`）；Node ≥ 24.9；pnpm workspace；包名 `@deepseek-ai/dsh-<name>`。
- 注册即 effect：`ctx.effect()` / `ctx.on()`，注册返回 disposer。
- 类型化事件用 declaration merging；waterfall 监听必须 `next()`。
- 新行为进插件/文档化扩展点，不改 `agent-loop`。
- 无硬编码可调参数：部署相关选择必须是可配置 `Config` 字段。
- 不透明跨边界 id 用 `Branded<B>`；禁止新增 `as unknown`。
- 人类可见变更需同 PR 更新无密钥录制会话快照（`snapshots/`）。
- 应用启动只能走 `dsh` profile。
- 严格测试门禁：`pnpm run test`（单元）、`test:coverage`（per-file 100%）、`build` + `build:check`、`typecheck`、`lint`；提交前按 [dsh-pre-push-checks](../.agents/skills/dsh-pre-push-checks/SKILL.md) 选最小集合。

## 7. 常用命令

```sh
pnpm install && pnpm run build      # 构建产物（TUI 开发前必做）
pnpm dsh --profile headless "task"  # 一次性任务（需 DEEPSEEK_API_KEY）
pnpm dsh --profile web              # Web UI
pnpm dsh --profile web --dump-config  # 查看组合树
pnpm run test | test:coverage | typecheck | lint | build
```
