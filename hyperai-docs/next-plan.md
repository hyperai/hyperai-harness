# 下一步开发计划：斜线指令与模型供应商

> 状态：**计划稿，待确认后开工**。基准：HyperAI TUI P0–P4 已完成（现有 `/help /tools /model /effort /resume /new /settings /clear /exit /quit`）。
> 参照项目：[MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code)（OpenCode 系，指令 56 个）、[Pi-Agent](https://github.com/earendil-works/pi)（极简可扩展，指令 25 个）、[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（官方首推，指令 35+）。

## 一、斜线指令对比与后续实现清单

### 1.1 对比总览

| 类别 | MiMo-Code | Pi | dsh-TUI | HyperAI 现有 |
|---|---|---|---|---|
| 会话/上下文 | /new /sessions /rename /compact /fork /undo /redo /export /share /copy | /new /resume /name /session /tree /fork /clone /compact /import | /new /resume /rename /compact /fork /export /clear /btw | /new /resume /clear |
| 模型/供应商 | /models /thinking /login /logout /connect /modalities /context-limit | /model /thinking /scoped-models /login /logout /llama | /model /effort /presets /auth /provider /kernel | /model /effort |
| 能力浏览 | /mcps /skills /agents /workflows /loops | /mcp（+ 扩展注册） | /tools /plugins /trajectory /context /tree | /tools |
| 目标/计划 | /goal /review /init /deep-research | —（明确不带 plan mode） | /plan /goal /review /init /diff /usage | — |
| 系统/外观 | /status /themes /vivid /dark /light /language /voice /worktree /skip-permissions /never-ask /dream /distill | /settings /hotkeys /debug /trust /reload /changelog /quit | /settings /update /help | /help /settings /exit |
| 会话导出分享 | /share /unshare /export | /copy /export /share /bug | /export /share | — |

### 1.2 后续实现清单（按优先级）

**P5 —— 高频刚需（建议下一批）**

| 指令 | 行为 | 参照 |
|---|---|---|
| `/compact [指示]` | 手动压缩上下文（dsh `compaction` seam 已有） | pi/mimo/dsh-tui 均有 |
| `/rename [标题]` | 会话命名；无参自动生成（`sessionTitle` seam） | pi /name、dsh-tui /rename |
| `/status` | 会话/模型/上下文用量/费用/权限一览 | mimo |
| `/export` / `/copy` | 导出 HTML/JSONL；复制最后回复 | pi/mimo |
| `/login` `/logout` `/provider` | 供应商认证与管理（authorization seam + pi-ai 登录面） | pi/mimo(/connect)/dsh-tui |
| `/mcp` | MCP 服务器管理（dsh `mcp` seam 已有） | pi/mimo /mcps |
| `/history`（或 Ctrl+R） | 历史搜索 | dsh-tui |
| `/usage` | token/费用统计（token-meter） | dsh-tui |
| `/thinking` | 与 `/effort` 合并（保留两者别名，`Shift+Tab`/`Ctrl+E` 不变） | pi/mimo |

**P6 —— 完整工作流**

| 指令 | 行为 | 参照 |
|---|---|---|
| `/fork` `/tree` `/clone` | 会话树导航与分叉（dsh fork seam 已有） | pi 全套、dsh-tui /tree |
| `/plan [消息]` | 计划模式（dsh `plan` seam 已有） | dsh-tui |
| `/goal [目标]` | 长时目标 + 完成判定（dsh `goal` seam 已有） | mimo/dsh-tui |
| `/review` `/diff` | 变更审查、diff 视图 | mimo/dsh-tui |
| `/context` `/context-limit` | 上下文用量分解、提前压缩点 | dsh-tui /context、mimo |
| `/presets`（或 /agents） | Agent 预设浏览/切换（Shift+Tab 已有循环） | dsh-tui /presets、mimo /agents |
| `/skills` | 技能浏览/加载（dsh `skill` seam 已有） | mimo/dsh-tui |
| `/theme` `/language` | 主题与语言切换（locale.ts 已有 zh/en） | mimo /themes /language |
| `/share` | 会话分享（gist/链接） | pi/mimo |
| `/worktree` | Git worktree 工作区（dsh worktrees 已有文档） | mimo |
| `/background`(/bg) | 后台任务列表（dsh `jobs` seam 已有） | mimo/dsh-tui |

**v2 —— 进阶体验**（对照 [dsh-tui-ccch-reference.md](dsh-tui-ccch-reference.md)）

/voice（语音）、/dream /distill（记忆蒸馏）、/loops /workflows /deep-research（编排）、/timeline（时间轴）、/modalities（输入模态）、/editor（全屏编辑器）、/import /migrate（历史迁移）、/skip-permissions /never-ask（权限策略）、/trust /debug /hotkeys /changelog /bug（运维类）、/undo /redo（回合回退，配合 rewind）、/init（项目初始化）。

**不做/慎做**：/kernel 多后端切换（Claude/Codex 后端不在 HyperAI 定位内）；MiMo 的 /logo /vivid 等品牌外观项替换为 HyperAI 自有主题。

### 1.3 实现要点

- 指令统一注册在 `ctx.commands`（dsh 的人类命令 seam，无模型回合直接派发），TUI 侧接 `/` 补全与说明面板。
- 每条指令映射一个已有 seam 优先（compaction / sessionTitle / goal / plan / jobs / skill / mcp / token-meter），不新造后端。
- 指令文案入 locale 字典（中英），帮助面板自动汇总。

## 二、模型供应商支持计划

### 2.1 现状与基础

我们仓库的 `llm-pi-ai`（`@earendil-works/pi-ai` 驱动）**已内置 42 家供应商目录**（生成自 pi-ai catalog，含 env 名、默认端点、协议）：

```
amazon-bedrock · ant-ling(蚂蚁百灵) · anthropic · azure · baseten · cerebras ·
cloudflare-ai-gateway · cloudflare-workers-ai · deepseek · fireworks · github-copilot ·
google · google-vertex · groq · huggingface · kimi-coding · meta · minimax · minimax-cn ·
mistral · moonshotai · moonshotai-cn · nvidia · openai · openai-codex(ChatGPT 订阅) ·
openrouter · qwen-token-plan(×3, 通义) · radius · together · typesafe ·
vercel-ai-gateway · xai · xiaomi(×4, 小米 MiMo) · zai / zai-coding-cn(智谱) · opencode 系
```

另有自定义路由（任意 OpenAI-compatible，`api: openai-completions | openai-responses | anthropic-messages`）——HyperAI 即此形态。**缺的不是适配器，而是 TUI 的供应商配置面**（选择、登录、模型目录发现）。

### 2.2 供应商分层（后续支持清单）

**Tier 1 —— 首发预置（TUI 内一键配置/登录）**

| 供应商 | 形态 | 说明 |
|---|---|---|
| **HyperAI** | custom OpenAI-compatible | 我方 API，默认路由（已就绪） |
| DeepSeek | 目录 `deepseek` + `deepseek-account` OAuth | 双形态（API key / 账号登录） |
| OpenAI | 目录 `openai` | GPT 系列 |
| Anthropic | 目录 `anthropic`（anthropic-messages 原生） | Claude 系列 |
| Google | 目录 `google` / `google-vertex` | Gemini |
| 月之暗面 Kimi | `kimi-coding` / `moonshotai-cn` | 国内主力 |
| 智谱 GLM | `zai` / `zai-coding-cn` | 国内主力 |
| MiniMax | `minimax-cn` | 国内 |
| 阿里通义 | `qwen-token-plan-cn` | 国内 |
| 小米 MiMo | `xiaomi`（×4 区域端点） | 参照 MiMo-Code 生态 |
| xAI Grok | `xai`（OAuth 可选） | |
| OpenRouter | `openrouter` | 聚合网关，一家接百家 |

**Tier 2 —— 目录即用（设置页开放，不做定制化）**

azure（Azure OpenAI）· amazon-bedrock · mistral · groq · together · nvidia · fireworks · huggingface · cerebras · meta · github-copilot · openai-codex（ChatGPT 订阅）· cloudflare 系 · baseten · vercel-ai-gateway。

**Tier 3 —— 目录外，走 custom 路由文档化**

| 供应商 | 协议 | 说明 |
|---|---|---|
| 豆包 / 火山方舟 | OpenAI-compatible | 国内常用，文档给配置模板 |
| SiliconFlow（硅基流动） | OpenAI-compatible | 国内聚合 |
| 腾讯混元 / 百度文心 | OpenAI-compatible | 国内 |
| Ollama / vLLM / llama.cpp | OpenAI-compatible | 本地/自托管；参照 Pi 的 `/llama` 与 MiMo 的 custom provider 文档 |

### 2.3 工作项

1. **`/provider` 供应商管理页**（TUI）：目录浏览 → 选择 → API key 录入或 OAuth 登录 → 模型目录发现（`GET /models`，llm-pi-ai discovery 已支持）→ 写入 `llm-pi-ai` 配置（provider 路由 + `apiKeyEnv` 引用，密钥走 credential seam，遵守"密钥不进模型输入/配置文件"纪律）。
2. **登录 seam**：llm-pi-ai README 已定义"pi-ai 供应商可经 harness authorization seam 登录（OAuth 或交互式 key 录入，存 credential store）"——TUI 接 `/login` `/logout` 即可。
3. **HyperAI 保持 custom 预置**（现有 `hyperai-provider.patch.yml` 形态固化为内置默认）。
4. **模型选择增强**：`/model` 从"只读展示"升级为供应商→模型级联选择（P5 `/model` 二期），记录最近使用（MiMo 的 recent 模式）。
5. **安全纪律**（对齐 MiMo-Code 同款规则）：API key 只进 credential store/`.env`，任何输出（转录、日志、导出、分享）不得携带密钥明文。

## 三、建议执行顺序

1. **P5 批次 1（指令）**：/compact /rename /status /export /copy /history /usage —— 纯 seam 映射，见效快。
2. **P5 批次 2（供应商）**：/login /logout /provider + `/model` 级联选择 + Tier 1 预置。
3. **P6 批次**：/fork /tree /plan /goal /review /context /presets /skills /theme /language /share /background。
4. v2 按 [dsh-tui-ccch-reference.md](dsh-tui-ccch-reference.md) 分层推进。

> 验收基线：每条指令配 locale 文案 + `/help` 收录 + 单测/e2e 增量；供应商配置后 `/model` 可见、真实往返可用、密钥零泄漏检查通过。
