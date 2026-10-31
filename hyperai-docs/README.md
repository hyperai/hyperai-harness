# HyperAI Harness 文档

本目录是 HyperAI fork（`hyperai/hyperai-harness`）的项目概览与开发手册，服务于一个目标：**在 DeepSeek Harness（`dsh`）之上引入 [OpenTUI](https://github.com/anomalyco/opentui)，定制 HyperAI 的终端交互界面（TUI）**。

本目录是 fork 自有的团队文档，不进入 upstream 文档门禁（`verify-doc-budgets`、双语配对、`docs/` 层级规则不适用于此处）；upstream 现状与契约一律以仓库内 `docs/`、`AGENTS.md` 和各包 README 为准，本文档只做索引、现状梳理与 fork 侧决策。

## 阅读顺序

| 文档 | 内容 | 适合谁 |
|---|---|---|
| [overview.md](overview.md) | 项目概览：架构、包布局、Profile/Bundle 组合、Turn 流、现有界面 | 所有人，第一篇 |
| [tui-support-status.md](tui-support-status.md) | dsh 对 TUI 的支持现状：已有接入面、缺口、headless/SDK 能力对照 | 决定 TUI 方案前必读 |
| [deepseek-tui-reference.md](deepseek-tui-reference.md) | DeepSeek-TUI（Rust/ratatui 独立 agent）的资料、开发方法与借鉴取舍 | 产品/UX 对照与工程参考 |
| [dsh-tui-ccch-reference.md](dsh-tui-ccch-reference.md) | dsh-TUI（ccch1mneyyy，官方首推 TUI 插件）功能特点整理与 P3 分层依据 | 产品功能清单 |
| [integration-design.md](integration-design.md) | OpenTUI 集成设计：进程内插件 vs SDK 子进程两条路径、取舍与推荐 | 架构评审 |
| [development-guide.md](development-guide.md) | 开发手册：目录规范、包/Bundle/Profile 骨架、构建与测试门禁 | 动手开发 |
| [development-plan.md](development-plan.md) | HyperAI TUI 开发计划与 TODO（方案 A、apps/tui、分支 hyperai-tui） | 开发执行 |
| [keymap.md](keymap.md) | TUI 键位表（v1 初稿） | 开发执行 |
| [roadmap.md](roadmap.md) | 执行进度（P0–P4 达成）与剩余路线、风险清单 | 排期与管理 |
| [next-plan.md](next-plan.md) | 下一步计划：斜线指令对比（MiMo-Code/Pi/dsh-TUI）与模型供应商支持分层 | 规划评审 |

## 当前状态速览（P0–P4 已完成，2026-10 更新）

**HyperAI TUI 已可用**：`apps/tui/`（包名 `@hyperai/hyperai-harness-tui`，分支 `hyperai-tui`，未提交），经 `dsh --profile tui` 启动的进程内 OpenTUI 终端界面。

- **能力**：流式对话（text + reasoning 折叠）、工具卡、审批/提问弹层、会话列表与恢复（`/resume` `/new` `--resume`）、模型/力度（`/model` `/effort`）、权限预设切换（Shift+Tab）、上下文指标、OSC 9 完成通知、markdown-lite、中英双语（`/settings`）、持久化输入历史、双 Ctrl+C 优雅退出。
- **模型配置**：仓库根 `.env`（`HYPERAI_BASE_URL/API_KEY/MODEL`，git 忽略）走 **HyperAI OpenAI-compatible 供应商**（pi-ai `hyperai` 路由，非 DeepSeek）；启动：`pnpm dsh --profile tui --patch apps/tui/config/examples/hyperai-provider.patch.yml`。安全纪律：`.env` 值永不进入模型输入。
- **质量面**：单测 26 项 + 无密钥 e2e（mock + node-pty 全流程）+ lint/typecheck/build 全绿；覆盖率按上游设计豁免（gate 只圈 `packages/*/*/src`）。
- **待办**：T4.5 提交/PR（待授权）；`snapshots/tui/` 顶层快照（需帧适配器）与 v2 体验项见 [roadmap.md](roadmap.md)。
- upstream dsh 本身仍无 TUI（Web/Desktop/headless/SDK/ACP 五表面）；本 fork 的 `apps/tui` 即是文档所述「自定义 profile + 树外插件」路线的实现，设计见 [integration-design.md](integration-design.md)，进度账见 [development-plan.md](development-plan.md)。

## 术语

| 术语 | 含义 |
|---|---|
| `dsh` | DeepSeek Harness 的 CLI 与产品名，本仓库唯一的 Node 应用启动器 |
| Cordis | dsh 的插件框架：插件向共享 `ctx` 贡献服务、类型化事件与可撤销 effect |
| Profile | 命名的插件组合，存在 `$DSH_HOME/profiles/<name>`；`web`/`headless`/`sdk`/`sdk-minimal`/`acp` 为出厂模板 |
| Bundle | Cordis 配置行与其挂载代码的分发格式，profile 按序堆叠 bundle |
| OpenTUI | Zig 内核 + TypeScript/React/Solid 绑定的终端 UI 库（MIT），OpenCode 生产在用 |
| TUI | Terminal User Interface，终端交互界面 |
