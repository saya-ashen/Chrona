# Claude Code 风格运行事件 UI 方案调研

调研时间：2026-08-07

目标：寻找适合 Chrona 任务运行过程的 Claude Code 风格展示方案，重点关注 Bash、Edit、Write、Read、Grep、Glob、Task、审批、工具输出、diff 和多步骤事件。

## 结论

没有发现一个可以直接接入 Chrona 当前事件协议、无需适配就能得到 Claude Code 风格 UI 的现成库。

最合适的方案是：

```text
assistant-ui/tool-ui 的可复用展示组件
        +
Chrona 自己的 RuntimeActivity 事件归一化层
        +
Chrona 现有 SSE / ActivityTimeline 数据流
```

具体建议：

- 采用 `assistant-ui/tool-ui` 的 copy/paste 组件作为视觉和交互基础；
- 优先复用 Terminal、Code Diff、Code Block、Plan、Progress 等组件；
- 不直接采用 `@assistant-ui/react-opencode` runtime，因为 Chrona 不是 OpenCode server；
- 不直接引入完整 assistant-ui chat runtime，避免把 Chrona 的 task/execution/result 状态重新改造成 chat thread；
- 先增加 Chrona 自己的 canonical runtime activity union，再把不同事件映射到工具卡组件。

## 候选方案比较

| 方案 | 适合程度 | 能力 | 主要问题 |
| --- | --- | --- | --- |
| assistant-ui/tool-ui | 最适合 | Terminal、Code Diff、Code Block、Plan、Progress、Approval 等，copy/paste、Zod schema、shadcn 风格 | 不是 Chrona 专属事件协议，需要自己做 adapter |
| assistant-ui React | 适合做交互原语 | Chain of Thought、Tool Group、工具状态、自动折叠、流式状态 | 引入完整 runtime 对 Chrona 太重；当前项目没有依赖 |
| @assistant-ui/react-opencode | 仅作参考 | OpenCode session、SSE、tool call、file edit、terminal output、permission/question | 只面向 OpenCode server，当前仍是 experimental v0.0.3 |
| Vercel AI Elements | 可选参考 | Tool、Reasoning、Chain of Thought、Code Block、状态和折叠 | 通用 AI SDK UI，不提供 Claude Code 的 Read/Edit/Bash 语义 |
| CopilotKit | 不建议作为本页基础 | Generative UI、AG-UI、事件 inspector、交互式工具 | 运行时范围过大，不是专门的 coding-agent event feed |
| Claude Code Viewer | 参考实现 | 真实 Claude Code session 日志、文件编辑、terminal、实时监控 | 完整应用，不是可直接安装的 React 组件库 |
| claude-code-ui | 参考实现 | 有明确的 Read/Edit/Write/Bash/Grep/Glob/Task 状态归纳 | 面向 Claude Code JSONL 和自身 daemon，不适配 Chrona |
| pi-tool-view | 参考实现 | OpenCode/Pi 风格的紧凑 tool call 和文件 diff | 更接近 Pi/OpenCode 生态，需确认稳定性和授权后再考虑复制 |

## 最值得复用的库：assistant-ui/tool-ui

官方仓库：

- <https://github.com/assistant-ui/tool-ui>
- <https://tool-ui.com/docs/overview>
- <https://tool-ui.com/docs/gallery>

它的定位不是传统 npm UI library，而是 shadcn 风格的 copy/paste 组件集合。组件代码进入自己的代码库，使用自己的 Tailwind、主题和基础组件，因此比直接引入一个完整视觉系统更适合 Chrona。

官方 README 明确提供：

- Progress：Plan、Progress Tracker；
- Input：Option List、Question Flow、Preferences Panel；
- Display：Terminal、Stats Display、Link Preview；
- Artifacts：Code Block、Code Diff、Data Table；
- Confirmation：Approval Card；
- 每个组件有 Zod schema；
- 对不符合 schema 的 payload 可以安全失败；
- 组件可以产生可持久化的用户交互 receipt。

### Terminal

源码：

`apps/www/components/tool-ui/terminal/terminal.tsx`

它提供了 Claude Code/Bash 风格需要的关键结构：

```text
┌─ Terminal ───────────────────────────────────────┐
│ cwd$ command                         1.8s   0  ⧉ │
├──────────────────────────────────────────────────┤
│ stdout                                           │
│ stderr                                           │
│                                                  │
│              Show all 42 lines                   │
└──────────────────────────────────────────────────┘
```

已有能力：

- command；
- cwd；
- exitCode；
- duration；
- stdout/stderr 分色；
- ANSI 渲染；
- 输出行数统计；
- 长输出自动折叠；
- 复制输出；
- running/completed/error 状态可由外层控制。

这比 Chrona 当前统一的 `ProviderPayloadBlock` 更符合 Bash 工具的阅读习惯。

### Code Diff

源码：

`apps/www/components/tool-ui/code-diff/code-diff.tsx`

它提供：

- unified patch；
- old/new file 对比；
- add/delete 行颜色；
- unified/split view；
- 语法高亮；
- 折叠长 diff；
- 复制代码；
- additions/deletions 统计。

这正好适合 Edit/Write/MultiEdit 事件，不应再把文件修改事件显示成一段普通 JSON。

### Plan / Progress

源码：

`apps/www/components/tool-ui/plan/plan.tsx`

它采用了比较接近 Claude Code 的步骤清单：

```text
✓ Read project files
✓ Inspect task state
● Edit runtime event model
○ Run tests
○ Review result
```

特征包括：

- pending/in_progress/completed/cancelled；
- 圆形状态节点；
- 当前步骤的动效；
- 步骤描述展开；
- 进度条；
- 长计划只显示前几项，其余可展开；
- 节点之间有连接线。

这比目前 Chrona 同时展示阶段栏、节点时间线和大量 card 更接近 Claude Code 的紧凑运行感。

## assistant-ui React：适合借鉴交互模式

官方文档：

- <https://www.assistant-ui.com/docs/guides/chain-of-thought.md>
- <https://www.assistant-ui.com/docs/tools/tool-ui.md>
- <https://www.assistant-ui.com/docs/primitives/chain-of-thought.md>
- <https://www.assistant-ui.com/docs/ui/diff-viewer.md>

assistant-ui 的 Chain of Thought 文档描述了一个重要结构：把连续的 reasoning 和 tool-call 合并成一个可折叠的 group，而不是每个事件都变成一个独立 card。

目标形式类似：

```text
┌─ Working · 4 actions ───────────────────────────┐
│  ↳ Read files                                    │
│  ↳ Search code                                   │
│  ↳ Edit task-workspace-plan-section-view.tsx     │
│  ↳ Run tests                                     │
└──────────────────────────────────────────────────┘
```

assistant-ui 的 Tool UI 支持按工具自定义 renderer，并区分：

- running；
- requires-action；
- incomplete/error；
- complete；
- approval；
- partial result；
- streaming args。

这套状态模型很适合借鉴到 Chrona，但不要直接把 Chrona 变成 assistant-ui thread。

## assistant-ui OpenCode runtime：匹配视觉语义，但不能直接使用

官方文档：

<https://www.assistant-ui.com/docs/runtimes/opencode/overview.md>

它直接支持：

- OpenCode session；
- SSE event stream；
- tool calls；
- file edits；
- terminal output；
- permission；
- interactive question；
- sub-agent/task transcript。

但它的前提是：

```text
OpenCode server → @assistant-ui/react-opencode → assistant-ui thread
```

Chrona 当前是：

```text
Chrona execution runtime → PlanExecutionSSEEvent → Task Workspace UI
```

所以不能直接安装后使用。可以借鉴它的展示模型，但必须保留 Chrona 自己的 task、plan、execution、result 生命周期。

官方文档还明确标注当前 OpenCode adapter 是 experimental v0.0.3，因此不应该把 Chrona 核心页面绑定到这个 runtime 上。

## Vercel AI Elements：通用组件，可局部借鉴

官方地址：

- <https://elements.ai-sdk.dev/components/tool>
- <https://elements.ai-sdk.dev/components/reasoning>
- <https://elements.ai-sdk.dev/components/chain-of-thought>
- <https://elements.ai-sdk.dev/components/code-block>
- <https://github.com/vercel/ai-elements>

它的 Tool 组件覆盖：

- input-streaming；
- input-available；
- approval-requested；
- approval-responded；
- output-available；
- output-error；
- output-denied。

Reasoning 组件支持：

- streaming 时自动打开；
- 完成后自动关闭；
- 手动展开/收起；
- 无障碍键盘交互；
- 适配 light/dark theme。

它适合拿来参考 `Tool` 和 `Reasoning` 的状态样式，但它没有 Claude Code 风格的工具类型适配：

```text
Bash → Terminal
Edit → Diff
Read → File preview
Write → File preview/diff
Task → Nested agent
Grep/Glob → Search result
```

这些需要 Chrona 自己定义。

## Claude Code 风格的实际参考实现

### claude-code-ui

仓库：

<https://github.com/KyleAMathews/claude-code-ui>

它不是通用组件库，但在事件归纳层上很值得参考。

其实现明确识别：

```text
Read      → Reading <path>
Edit      → Editing <path>
Write     → Writing <path>
Bash      → Running <command>
Grep      → Searching for <pattern>
Glob      → Finding files: <pattern>
Task      → Spawning agent: <description>
```

它在 `packages/daemon/src/server.ts` 和 `packages/daemon/src/summarizer.ts` 中把原始 tool_use 转化为用户可以快速理解的摘要，而不是直接显示原始 payload。

它还将工具状态归纳成：

```text
ASSISTANT_STREAMING
ASSISTANT_TOOL_USE
TOOL_RESULT
waiting_for_approval
```

这说明 Chrona 当前缺的不是更多卡片，而是一个稳定的“工具事件分类和摘要层”。

### Claude Code Viewer

仓库：

<https://github.com/d-kimuson/claude-code-viewer>

它是完整的 Web Claude Code client，支持：

- 实时 session log；
- session history；
- file edit；
- terminal；
- permission；
- interactive question；
- live monitoring；
- diff viewer；
- 文件变更列表。

它更适合拿来参考完整产品布局，不适合直接复制组件，因为它的数据模型围绕 Claude Code JSONL 和自身 daemon 设计。

## Chrona 当前事件模型的关键缺口

Chrona 当前公开 runtime event 大致是：

```ts
runtime_event {
  nodeId?
  nodeTitle?
  runtime
  provider
  sequence?
  timestamp?
  event:
    | text_delta
    | reasoning_delta
    | raw_event
    | tool_started
    | tool_progress
    | tool_completed
    | approval_required
    | run_status
}
```

问题是 tool event 里的信息偏通用：

```ts
{
  type: "tool_started",
  tool: { category, label },
  label,
  input
}
```

对于 Claude Code 风格展示，需要额外的 canonical tool identity。仅有 `label` 不够稳定，因为 label 可能是：

```text
Runtime tool
Browser
Provider tool
Read source
```

建议新增一个前端展示层模型，而不是直接让 JSX 判断字符串：

```ts
type TaskRuntimeActivity =
  | {
      kind: "assistant";
      id: string;
      text: string;
      status: "streaming" | "complete";
    }
  | {
      kind: "tool";
      id: string;
      tool:
        | "bash"
        | "read"
        | "edit"
        | "write"
        | "grep"
        | "glob"
        | "task"
        | "web"
        | "generic";
      status: "running" | "complete" | "error" | "waiting_approval";
      title: string;
      path?: string;
      command?: string;
      cwd?: string;
      input?: unknown;
      output?: unknown;
      durationMs?: number;
      diff?: string;
    }
  | {
      kind: "approval";
      id: string;
      title: string;
      summary: string;
      riskLevel: string;
      choices: string[];
    }
  | {
      kind: "step";
      id: string;
      title: string;
      status: "pending" | "running" | "complete" | "blocked" | "error";
      summary?: string;
    };
```

然后只做一层 renderer dispatch：

```text
bash       → Terminal
edit      → CodeDiff
write      → CodeBlock / file preview
read       → File preview / compact output
grep/glob  → Search result list
Task       → Nested agent group
approval   → Approval card
assistant  → compact assistant output
generic    → fallback tool card
```

## 推荐的最终事件展示结构

### 运行中

```text
┌─ 当前运行 · 2/4 ─────────────────────────────────┐
│ ● 正在修改 task-workspace-plan-section-view.tsx │
├──────────────────────────────────────────────────┤
│ ✏ Edit                                           │
│   task-workspace-plan-section-view.tsx           │
│   + 18  - 4                          1.2s        │
│   [展开 diff]                                    │
├──────────────────────────────────────────────────┤
│ ▶ Bash                                           │
│   bunx vitest run ...                            │
│   running...                                     │
├──────────────────────────────────────────────────┤
│ ✓ Read                                           │
│   execution-overview-content.tsx                 │
│   240 lines · 0.3s                               │
├──────────────────────────────────────────────────┤
│ 🔍 Grep                                          │
│   "tool_completed"                               │
│   12 matches · 0.2s                              │
└──────────────────────────────────────────────────┘
```

### 完成后

```text
┌─ 执行记录 · 100 个事件 · 4 个步骤 · 06:18 ───────┐
│ ✓ Read  12 次                                    │
│ ✎ Edit  3 次                                     │
│ ▶ Bash  5 次                                     │
│ 🔍 Search 8 次                                   │
│ ⚠ 1 个注意事项                                   │
│                                                  │
│ [展开完整执行过程]                               │
└──────────────────────────────────────────────────┘
```

## 实施建议

### 不建议

- 直接安装完整 `@assistant-ui/react-opencode`；
- 把整个 task 页面改成 assistant-ui chat thread；
- 继续在 `ActivityTimeline` 中用字符串判断工具类型；
- 把所有事件统一显示成普通时间线 item；
- 把 reasoning token、raw JSON 和 tool output 默认全部展开。

### 建议

1. 先增加 `TaskRuntimeActivity` 归一化层；
2. 从 `tool.label`/`tool.category`/payload 中解析 canonical tool type；
3. 引入或复制 Tool UI 的 Terminal、Code Diff、Code Block、Plan/Progress 组件；
4. 将当前 `LiveExecutionFeed` 改成 `RuntimeActivityRenderer`；
5. 用 renderer map 管理事件类型，而不是在一个大 JSX 函数中堆条件；
6. 运行中默认展开当前 tool，已完成的 tool 默认折叠；
7. Bash 输出限制高度并提供“显示全部输出”；
8. Edit 默认展示文件名和增删行统计，diff 默认折叠；
9. Task 显示嵌套 agent/子任务摘要，可继续展开；
10. 完成后将同一份 normalized activity 聚合成执行记录摘要。

## 对 Chrona 的最终推荐

第一选择：

```text
assistant-ui/tool-ui copy/paste 组件
+ Chrona 自己的 TaskRuntimeActivity adapter
```

具体优先级：

1. 复用 Terminal；
2. 复用 Code Diff；
3. 复用 Plan/Progress；
4. 参考 assistant-ui ChainOfThought/ToolGroup 的折叠逻辑；
5. 参考 claude-code-ui 的 Read/Edit/Write/Bash/Grep/Glob/Task 摘要映射；
6. 保留 Chrona 自己的 SSE、task state、checkpoint 和 result lifecycle。

这样可以得到类似 Claude Code 的运行体验，但不会把 Chrona 变成 Claude Code 或 OpenCode 的 Web clone。
