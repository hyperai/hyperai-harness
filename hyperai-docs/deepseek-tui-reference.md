# DeepSeek-TUI 参考资料与开发方法

> 项目链接：<https://github.com/Hghrry/DeepSeek-TUI>（fork 自 `codewhale-hq/Codewhale`；主线发行方为 `Hmbown/DeepSeek-TUI`，npm 包 [`deepseek-tui`](https://www.npmjs.com/package/deepseek-tui)，crates.io `deepseek-tui-cli`）

DeepSeek-TUI 是一个**完整、独立的终端 coding agent**，面向 DeepSeek V4 模型，与本 fork 计划的「在 dsh 上加 OpenTUI」是两条不同技术路线。本文整理它的资料与开发方法，作为 HyperAI TUI 的**产品功能清单、终端 UX 与工程组织参考**，并说明哪些可以直接借鉴、哪些不应照搬。

## 1. 它是什么

- 单一二进制分发（npm 全局包装预编译 Rust 二进制；也可 `cargo install`），**不需要 Node/Python 运行时**。
- Rust 编写，TUI 层是 **ratatui**（不是 OpenTUI）。Rust 1.85+ / edition 2024，Cargo workspace。
- 绕 DeepSeek V4（`deepseek-v4-pro` / `deepseek-v4-flash`）的 1M 上下文与前缀缓存设计；走 OpenAI 兼容 Chat Completions 流式接口。
- 自带 MCP 客户端、macOS 沙箱、持久任务队列、LSP 诊断、子 agent、HTTP/SSE runtime API。
- 与 DeepSeek Inc. 无关（README 自述）。

## 2. 技术架构（来自 docs/ARCHITECTURE.md，v0.8.6 边界）

```
UI 层      TUI(ratatui) / One-shot / Config-CLI
             │
核心引擎    core/engine.rs — Agent Loop：Session / Turn 管理 / 工具编排
             │             turn_loop.rs 流式回合，capacity_flow.rs 容量护栏
工具扩展层  tools / skills / hooks(pre,post) / MCP Servers
             │
运行时层    HTTP/SSE Runtime API (runtime_api.rs) + 持久任务管理 (task_manager.rs)
             │
LLM 层      llm_client.rs 抽象（重试）→ DeepSeek client.rs / 兼容客户端
```

Crate 划分（正在从 `crates/tui` 逐步抽出，`crates/tui` 目前仍是主运行时）：

| Crate | 职责 |
|---|---|
| `tui` | `deepseek-tui` 二进制：交互 TUI + runtime API + 任务/工具循环 |
| `cli` | `deepseek` 调度器二进制 |
| `app-server` | HTTP/SSE + JSON-RPC 传输 |
| `core` | agent loop / session / turn / 容量护栏 |
| `protocol` | 请求响应帧与协议类型 |
| `config` | 配置、profile、环境变量优先级 |
| `state` | SQLite 线程/会话持久化 |
| `tools` | 类型化工具规格与生命周期 |
| `mcp` | MCP 客户端 + stdio server |
| `hooks` | 生命周期钩子（stdout/jsonl/webhook） |
| `execpolicy` | 审批/沙箱策略引擎 |
| `agent` | 模型/提供方注册表 |
| `tui-core` | 事件驱动 TUI 状态机脚手架 |

关键数据流：流式回合 → 工具调用（pre-hook → 审批 → 执行 → post-hook）→ **LSP 编辑后诊断注入**（`edit_file`/`apply_patch`/`write_file` 成功后收集诊断，下次 API 请求前以合成 user 消息注入）→ 结果回灌模型。崩溃恢复靠 `~/.deepseek/sessions/checkpoints/`，工作区回滚靠 side-git 快照（`/restore` / `revert_turn`，不动用户 `.git`）。持久化记录内嵌 `schema_version`，加载时拒绝更新的版本。

## 3. 功能清单（对 HyperAI TUI 的产品验收基准）

| 能力 | DeepSeek-TUI 做法 | dsh 对应能力 |
|---|---|---|
| 三种执行模式 | Plan（只读探索）/ Agent（带审批）/ YOLO（自动批准） | 权限预设 + `approval/policy`（ask/never）+ sandbox |
| 推理力度切换 | Shift+Tab 循环 off → high → max | `ReasoningEffortId` / `agent.request` 模型选择 |
| 思考流式显示 | thinking-mode 流式展开 | `agent/assistant-stream` 的 reasoning/text-delta |
| 会话保存/恢复 | checkpoint + `--resume` / `Ctrl+R` | Session 持久化 + `ctx.agents.resume` / headless `--session-id` |
| 工作区回滚 | side-git 前后快照、`/restore` | 无直接对应（deliverables/workspace-changes 是只读呈现） |
| 后台持久任务队列 | task_manager + 重启存活 | `ctx.jobs` / `job_*` 工具 |
| HTTP/SSE runtime API | `deepseek serve --http` | SDK JSON-RPC / ACP / `dsh web` |
| MCP | 内置客户端 + stdio server | `packages/mcp` |
| 子 agent | `agent_spawn`；RLM `rlm_query` 并行 1–16 个 flash 子查询 | `packages/subagent`（spawn/fork） |
| 上下文压缩 | 自动智能 compaction、前缀缓存感知 | `packages/compaction` |
| LSP 诊断 | rust-analyzer/pyright/tsc/gopls/clangd 编辑后注入 | `packages/lsp` |
| 技能系统 | `SKILL.md` 目录 + GitHub 安装 | `packages/skill`（`.agents/skills`） |
| 费用追踪 | 回合/会话 token 与缓存命中成本 | `token-meter` / session-stats |
| 本地化 | en / ja / zh-Hans / pt-BR | 客户端 locale 字典（Web 侧） |
| 用户记忆 | 可选持久 note 注入 system prompt | context / agent-instructions |
| 诊断自检 | `deepseek doctor [--json]` | 无直接对应 |

## 4. 开发方法（来自 CONTRIBUTING.md / docs/）

**环境**：Rust 1.85+、Cargo、Git。`cargo build` / `cargo test` / `cargo run` 起步。

**代码风格与门禁**：提交前 `cargo fmt --check`、`cargo clippy --workspace --all-targets --all-targets --all-features`、`cargo check`；测试全量 `cargo test --workspace --all-features`。单元测试与被测代码同文件（`#[cfg(test)]`），集成测试放所属 crate 的 `tests/`；仓库根 `tests/` 不用。

**提交约定**：conventional commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）。

**PR 形状**（项目明确要求，值得借鉴）：一个 PR 只做一件事；典型改动 1–3 个新文件 + 2–5 个接线文件（注册表、dispatch、本地化）+ 测试；相关但独立的工作开新 issue，不扩大 PR 范围。范例 PR：`/init` 命令、内联 LSP 诊断、自更新、`/share` 会话 URL。

**扩展点**（决定其可扩展性）：
- 新工具：`tools/` 加 handler → `tools/registry.rs` 注册 → 补 tool spec（name/description/input schema）
- MCP server：`~/.deepseek/mcp.json` 配置，启动自动发现，工具自动暴露给模型
- Skill：`~/.deepseek/skills/<name>/SKILL.md`（frontmatter `name` + `description`）
- Hooks：`~/.deepseek/config.toml` 的 `[[hooks]]`（`tool_call_before` 等事件 + shell 命令）

**文档体系**（docs/ 目录值得对照）：ARCHITECTURE（内部结构）、CONFIGURATION、MODES、MCP、RUNTIME_API、INSTALL、MEMORY、SUBAGENTS、KEYBINDINGS、RELEASE_RUNBOOK、OPERATIONS_RUNBOOK + CHANGELOG + DEPENDENCY_GRAPH + PROMPT_ANALYSIS。另设 `AGENTS.md` 与 `TAKEOVER_PROMPT.md` 供 AI 协作。

**配置布局**：`~/.deepseek/config.toml`（主配置）+ 项目级 overlay（禁写 `api_key`/`base_url`/`provider`/`mcp_config_path`）+ `/etc/deepseek/managed_config.toml`（Unix 托管默认）+ `/etc/deepseek/requirements.toml`（策略约束）+ `mcp.json` / `skills/` / `sessions/` / `snapshots/` / `tasks/` / `audit.log`。

## 5. 对 HyperAI 的借鉴与取舍

**值得借鉴（产品/UX/工程组织）**
1. **终端 UX 功能基线**：三模式、推理力度循环、思考流式、草稿暂存（`/stash`）、命令面板（Ctrl+K）、`@` 文件引用、费用实时显示、可搜索帮助（F1）——这些是终端 agent 的成熟预期，HyperAI TUI 的验收清单可以直接以此为底稿（见 [integration-design.md](integration-design.md) 的呈现层设计）。
2. **崩溃恢复与工作区回滚**：checkpoint + 离线队列 + side-git 快照的组合，解决「长任务被打断」和「改坏了想回退」两个真实痛点。
3. **LSP 诊断回灌**：编辑类工具执行后把诊断注入下一步上下文，成本低、收益明显。
4. **文档与 PR 规范**：按能力拆小 PR、接线文件单列、docs/ 按主题分册、`RELEASE_RUNBOOK`/`OPERATIONS_RUNBOOK` 分离发布与运维。

**不应照搬（与本 fork 路线冲突）**
1. **不要另起一套 agent 栈**。DeepSeek-TUI 是独立 Rust agent：自带 agent loop、会话存储（SQLite）、工具注册、审批策略。dsh 已经用 Cordis 插件把同一组能力做成 capability seam（session / tools / approval / subagent / jobs / lsp / mcp / skill / compaction）。照搬意味着维护两套模型可见语义、两套会话格式、两套工具契约。HyperAI TUI 应当**呈现 dsh 已有的 seam**，而不是重新实现它们。
2. **UI 库路线不同**。它是 ratatui（Rust）；我们是 OpenTUI（Zig 内核 + TS/React）。UI 层无直接代码可移植，只有交互设计可参考。OpenTUI 侧的工程参考对象是 OpenCode（OpenTUI 生产用户）。
3. **分发模型不同**。它走「npm 包装预编译 Rust 二进制」；dsh 是 pnpm workspace + Node ≥ 24.9 + ESM，且应用只能经 `dsh` profile 启动（见 [development-guide.md](development-guide.md) 的启动规则）。
4. **其 schema_version 直接拒绝更新版本**的持久化策略，与 dsh 的 Session 格式版本/迁移机制（`SESSION_FORMAT_VERSION`、相邻迁移链）不是一回事；不要混用两套持久化约定。

**结论**：把 DeepSeek-TUI 当作**产品需求与终端 UX 的对照实现**和**工程组织范例**；HyperAI 的实现路线仍是 dsh `tui` profile + OpenTUI 渲染层，能力一律复用 dsh 的 seam。功能映射详表见 [tui-support-status.md](tui-support-status.md)。

## 6. 参考链接

- 仓库：<https://github.com/Hghrry/DeepSeek-TUI>
- 架构：`docs/ARCHITECTURE.md`；贡献指南：`CONTRIBUTING.md`；配置：`docs/CONFIGURATION.md`；键位：`docs/KEYBINDINGS.md`；运行时 API：`docs/RUNTIME_API.md`；MCP：`docs/MCP.md`；子 agent：`docs/SUBAGENTS.md`
- 发布：<https://github.com/Hmbown/DeepSeek-TUI/releases>；npm：`deepseek-tui`
- 同类 UI 参考（OpenTUI 生产实践）：OpenCode（<https://opentui.com> 文档与示例）
