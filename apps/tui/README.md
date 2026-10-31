# @hyperai/hyperai-harness-tui

HyperAI 的终端交互界面（TUI）：骑在 `dsh-base` 之上的 bundle，进程内驱动 `ctx.agents`，用 OpenTUI 渲染会话。经 `dsh --profile tui` 启动，不提供独立 bin。

分支 `hyperai-tui` 的开发计划与设计见 [hyperai-docs/](../../hyperai-docs/README.md)。

## Use this package

```sh
dsh --profile tui                      # 交互会话
dsh --profile tui "run the tests"      # 首个任务
dsh --profile tui --resume session-…   # 恢复持久化会话
```

运行要求 Node ≥ 26.4（OpenTUI 原生 FFI）与有效 API key（环境变量、项目 `.env` 或 `$DSH_HOME/.env`）。

### HyperAI 供应商（默认测试配置，OpenAI-compatible）

模型配置在仓库根目录 `.env`（`HYPERAI_BASE_URL` / `HYPERAI_API_KEY` / `HYPERAI_MODEL`，git 已忽略）。走 HyperAI 自定义供应商路由（pi-ai `openai-completions`），不经过 DeepSeek 供应商：

```sh
pnpm dsh --profile tui --patch apps/tui/config/examples/hyperai-provider.patch.yml
```

patch 将 `agent-default-model` 指向 `hyperai/<HYPERAI_MODEL>`；`/model` 显示即为 HyperAI 路由。

### 无密钥 demo（mock 模型服务）

```sh
# 1. 起 mock（序列注意为会话标题生成预留一个请求）
pnpm run mock:llm --port 8000 --api-key mock-key \
  --sequence reasoning_success,success,tool_call_success,success \
  --tool-name bash \
  --tool-arguments '{"description":"demo escalation command","command":"echo tui-demo-ok","sandbox_permissions":"danger-full-access","justification":"demo of the TUI approval flow"}'

# 2. 另开终端起 TUI（patch 关掉凭据存储，让环境变量路由到 mock）
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 DEEPSEEK_API_KEY=mock-key \
  pnpm dsh --profile tui --patch apps/tui/config/examples/mock-llm.patch.yml
```

交互路径：输入任务回车 → 看思考/文本流式 → 第二条消息触发工具调用 → 审批弹层按 `a` 允许 → 工具执行与续答 → 空闲后 `Ctrl+C` 退出。

| 文件 | 角色 |
|---|---|
| [`src/startup.ts`](src/startup.ts) | `tui-startup`：解析 cmdline（task / `--resume` / `--session-id`），提供 `ctx.tuiStartup` |
| [`src/index.ts`](src/index.ts) | `tui-runtime`：创建/恢复 Agent、`followup()`/`steer()` 驱动、事件订阅、审批策略切换、退出 |
| [`src/view.ts`](src/view.ts) | OpenTUI 界面：header/状态栏/滚动转录/输入区/弹层（帮助、工具、模型、审批、提问）、键位路由 |
| [`src/transcript.ts`](src/transcript.ts) | 转录视图模型：行折叠（用户/助手/thinking/工具卡/通知）与上色渲染 |
| [`src/theme.ts`](src/theme.ts) | HyperAI 品牌配色 token 与样式 chunk 构造 |
| [`src/banner.ts`](src/banner.ts) | HyperAI Logo 横幅 |
| [`src/history.ts`](src/history.ts) | 持久化输入历史（`$DSH_HOME/hyperai-tui/history.jsonl`） |
| [`src/answerers.ts`](src/answerers.ts) | `approval/request` 与 `user-questions/request` 终端应答者 |
| [`cordis.patch.yml`](cordis.patch.yml) | bundle patch：`dsh-base` 之上的 `tui-startup` + `tui-runtime` 两行 |
| [`config/examples/mock-llm.patch.yml`](config/examples/mock-llm.patch.yml) | 无密钥 demo overlay（禁用凭据存储） |

## Model Experience

无（驱动仅提交普通 user 消息，prompt 与工具由 base 组合行拥有）。

#### KV Cache effect

请求前缀无新增；仅驱动一条用户消息穿过组合树。

## Testing

- 单元测试：`pnpm exec vitest run apps/tui/tests`（转录折叠/渲染/历史/locale/banner，26 项）
- 端到端（无密钥）：`pnpm run build:artifacts && pnpm exec vitest run --config vitest.expected.config.ts apps/tui`——mock 模型 + node-pty 驱动完整 demo 流（流式 → 工具卡 → 审批 → 执行 → 退出）

## Known Limitations and Deferred Work

- **多行草稿**（Shift+Enter）与思考/工具卡展开（Ctrl+T/X）未实现（P4/v2）。
- **`snapshots/tui/` 顶层快照场景** 未建：需要 dsh-session-snapshot 的 TUI 帧适配器（记录/回放）；当前 e2e 归 `test:expected` 层。
- **费用估算、Launchpad/向导、时间轴、侧边面板、图片/Mermaid/LaTeX、鼠标** 等进阶体验见 `hyperai-docs/dsh-tui-ccch-reference.md` 分层（v2）。
- **提问应答者的 abort/unowned 分支** 为薄委托逻辑，由 e2e 走真实 seam 覆盖认领路径。
