# 开发手册

本文给出 HyperAI TUI 的目录规范、包/Bundle/Profile 骨架、构建与测试门禁。骨架是形状正确的起点，具体 API 以源码 JSDoc 为准。架构取舍见 [integration-design.md](integration-design.md)。

## 1. 目录规划（路径 A 主交付）

```
packages/
  tui/                        HyperAI TUI 呈现与驱动（新组）
    tui-app/                  驱动插件：agents 驱动、answerer、生命周期
    tui-render/               OpenTUI 渲染层（React 组件、视图模型、locale）
  bundle/
    tui-app/                  dsh-tui-app bundle：cordis.patch.yml + startup
```

- 路径 B 原型仓库（独立）不占本目录；其渲染组件后续平移进 `packages/tui/tui-render`。
- 命名：包名保持 `@deepseek-ai/dsh-tui-*`（与仓库 `@deepseek-ai/dsh-<name>` 约定一致，便于合并 upstream）；若确定长期分叉，可改用 `@hyperai/*` scope，但需同步调整所有 workspace 引用与门禁豁免，代价大，**默认不改**。

## 2. bundle 骨架（`packages/bundle/tui-app`）

`package.json` 关键字段（对照 `packages/bundle/headless/package.json`）：

```jsonc
{
  "name": "@deepseek-ai/dsh-tui-app",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./startup": { "types": "./lib/types/startup.d.ts", "default": "./lib/startup.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./src/*": "./src/*",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "files": ["locale/*.json", "lib/**", "cordis.patch.yml", "lib/types/**/*.d.ts"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/dsh-cmdline": "workspace:*",
    "@deepseek-ai/dsh-brand": "workspace:*"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-agent": "workspace:*",
    "@deepseek-ai/dsh-agent-default-model": "workspace:*",
    "@deepseek-ai/dsh-llm": "workspace:*",
    "@deepseek-ai/dsh-session": "workspace:*",
    "@deepseek-ai/dsh-user-approval": "workspace:*",
    "@deepseek-ai/dsh-user-questions": "workspace:*"
  }
}
```

`cordis.patch.yml` 形状（对照 headless 的 patch；`!!js` 仅允许在 plugin `config` 与 entry `disabled` 下）：

```yaml
# dsh-tui-app：终端界面层，骑在 dsh-base 之上。
- id: system-prompt
  config:
    personaPrefix: >-
      You are a coding agent powered by the {{model}} model.

- insert:
    - id: tui-startup
      name: '@deepseek-ai/dsh-tui-app/startup'

    - id: tui-runtime
      name: '@deepseek-ai/dsh-tui-app'
      inject: [tuiStartup]
      config:
        sessionId: !!js ctx.tuiStartup.sessionId
        resume: !!js ctx.tuiStartup.resume
```

启动解析插件（`src/startup.ts`）照抄 `packages/bundle/headless/src/startup.ts` 模式：注入 `cmdlineArgs`（`dsh-cmdline`），解析 `--resume <id>` / `--session-id <id>` / `--model` / `--effort` 等，提供 `ctx.tuiStartup` 服务。

## 3. profile 模板

profile 目录（`$DSH_HOME/profiles/tui`，出厂模板放 `packages/bundle/tui-app` 同级或 apps/cli 的模板机制内）：

```jsonc
// package.json
{
  "name": "dsh-profile-tui",
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-tui-app"] } },
  "dependencies": { "@deepseek-ai/dsh-tui-app": "workspace:*" }
}
```

```yaml
# cordis.patch.yml（用户可覆盖层，初始为空或仅列差异）
- id: tui-runtime
  config:
    theme: hyperai-dark
```

启动：`dsh --profile tui --resume <id>`（对照 `apps/cli/README.md` 的假设示例）。校验组合树：`dsh --profile tui --dump-config`。

## 4. 驱动插件骨架（`packages/tui/tui-app/src/index.ts`）

```ts
/**
 * @deepseek-ai/dsh-tui-app — TUI direct driver: drives ctx.agents from the
 * terminal surface, renders live streams, and answers approval/user questions.
 * @module @deepseek-ai/dsh-tui-app
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval'

export const name = 'tui-driver'
export const inject = ['agents', 'sessions', 'userQuestions']

/** 渲染层实现的最小接口：驱动层只依赖该面，A/B 路径可互换。 */
export interface TuiSurface {
  renderText(kind: 'text' | 'reasoning', delta: string): void
  renderTool(call: { id: string; name: string; args: unknown }, result?: unknown): void
  renderTurnState(state: 'running' | 'idle'): void
  askApproval(req: ApprovalRequestEvent): Promise<ApprovalOutcome>
  askQuestions(req: { questions: unknown[] }): Promise<{ answers: unknown[] }>
}

export function apply(ctx: Context, surface: TuiSurface) {
  // 1) 流式渲染：进程内帧，token 级
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') surface.renderText('text', frame.chunk.text)
  })

  // 2) 持久事实：工具卡片与回合状态
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'tool/call') surface.renderTool(event.data as never)
    if (event.type === 'turn/end') surface.renderTurnState('idle')
    if (event.type === 'turn/start') surface.renderTurnState('running')
  })

  // 3) 输入回灌
  function send(agent: Agent, text: string) {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
  }

  // 4) 终端审批 answerer：返回 outcome 认领请求，next() 委派
  ctx.on('approval/request', async (req, next): Promise<ApprovalOutcome> => {
    if (!ownsAgent(req)) return next()
    return surface.askApproval(req)   // allowed-once | rejected | cancelled
  })

  // 5) 结构化提问 answerer（user-questions waterfall，形状对照其 README）
  ctx.on('user-questions/ask', async (req, next) => {
    if (!ownsAgent(req)) return next()
    return surface.askQuestions(req)
  })

  // 6) 会话恢复：--resume 时 ctx.agents.resume({ resumeSessionId })
}
function ownsAgent(_req: unknown): boolean { return true /* 只应答本 TUI 拥有的 agent */ }
```

要点：
- **waterfall 必须 `next()`**：不认领就委派，否则短路链条（仓库硬规则）。
- 审批 answerer 只应答自己拥有的 agent（对照 ACP/Web 的做法）；缺失/抛错 = `unavailable` fail-closed。
- followup() 返回无句柄；要等待完成用 `agent.whenIdle()`，且只有拥有「回执到空闲」区间时才可称一次 run。
- 渲染层绝不写入 Session 日志（"how to draw" 不入日志）；工具卡片从原始事件派生。

## 5. 渲染层骨架（OpenTUI React）

```ts
// packages/tui/tui-render/src/App.tsx — 形状示意
import { render } from '@opentui/react'
import { useState } from 'react'

function SessionView({ stream }: { stream: ViewModel }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {stream.turns.map(t => <TurnCard key={t.id} turn={t} />)}
    </box>
  )
}

function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('')
  return <input value={draft} onChange={setDraft} onSubmit={() => onSend(draft)} />
}

export function startTui(surface: TuiSurface) {
  render(<App surface={surface} />)
}
```

- 视图模型（`ViewModel`）由驱动层填充：turn 列表、工具卡、审批/问题弹层、状态栏（模型/费用/模式）。
- 增量文本节流重绘；回合边界整卡刷新。
- 产品文案进 locale 字典（`packages/tui/tui-render/locale/*.json`）。

## 6. 构建与验证

```sh
pnpm install
pnpm run build            # build:artifacts + build:check（必做，源码运行依赖产物）
pnpm dsh --profile tui    # 起 TUI（需 DEEPSEEK_API_KEY）
pnpm run test             # 单元测试
pnpm run typecheck && pnpm run lint
pnpm run test:coverage    # CI 覆盖门禁：packages/*/*/src per-file 100%
```

必守门禁（fork 侧改动同样受约束）：
- `verify-application-entrypoints`：TUI 只能经 `dsh` profile 启动。
- `verify-export-jsdoc` / `verify-package-dependencies`：导出 JSDoc 与依赖声明。
- 人类可见变更配无密钥录制会话快照（`pnpm run test:snapshot`；TUI 场景建议新增 `snapshots/tui/`，参照 `snapshots/AGENTS.md` 的目录所有权规则先做规划）。
- OpenTUI 原生依赖引入前跑 `pnpm run hygiene`（publint + 依赖检查）确认安装链路。

## 7. 路径 B 原型骨架（独立仓库，最小可跑）

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { render } from '@opentui/react'

await using harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: ['./tui.cordis.yml'],
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
})
await harness.client.start()
harness.client.onRequest(async (req) => ({ outcome: 'allowed-once' })) // 审批
const result = await harness.run('say hi', {
  onNotification: n => paint(n),   // 通知流 → 视图模型
})
```

- `onRequest` 需在 `harness.start({ approvalRequests: true })` 时启用；`onUserQuestion` 回答 `ask_user_question`。
- 通知流是提交点投影，token 级流式需协议扩展或改路径 A。
- 原型期把「视图模型 + OpenTUI 组件」与「SDK 数据源」分开写，便于平移回 `packages/tui/`。

## 8. 开发流程建议

1. 阶段 0：独立原型（路径 B）敲定交互设计 → 产出键位表与屏幕布局（可参考 [deepseek-tui-reference.md](deepseek-tui-reference.md) 的 UX 清单）。
2. 阶段 1：`dsh-tui-app` bundle + `tui` profile + 驱动插件，先跑通「输入 → 流式 → 工具卡 → 再输入」。
3. 阶段 2：终端 answerer（审批/提问）+ 权限预设切换 + 会话恢复 UX。
4. 阶段 3：jobs/commands/费用栏/帮助面板/快照覆盖/locale。
5. 每步 PR 形状参考 DeepSeek-TUI 的约定（见 [deepseek-tui-reference.md](deepseek-tui-reference.md) §4）：一 PR 一事、接线文件单列、测试同 PR。
