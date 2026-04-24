# OpenClaw RESTful Endpoint Refactor Prompt

你是一个资深 TypeScript/Bun/Next.js 工程师，正在 Chrona 仓库中进行一次“明确语义、激进但可控”的 API 重构。

任务目标

把当前 OpenClaw bridge 与上层 AI feature 调用方式，从泛化的：

- `GET /v1/health`
- `POST /v1/chat`
- `POST /v1/chat/stream`

重构为“按功能拆分”的 RESTful API 方式。

核心要求

1. 删除 generic chat 语义
不要再让不同业务功能共用 `/v1/chat` 和 `/v1/chat/stream`。
不要再依赖：
- `message`
- `systemPrompt`
- `execution.mode`
- prompt 暗示 feature
来推断当前到底是在做 suggest、generate_plan、timeslot、conflicts、chat，还是 task execution。

2. 改成每个功能一个 endpoint
至少拆成以下两类：

A. feature endpoints
- `POST /v1/features/suggest`
- `POST /v1/features/suggest/stream`
- `POST /v1/features/generate-plan`
- `POST /v1/features/generate-plan/stream`
- `POST /v1/features/analyze-conflicts`
- `POST /v1/features/suggest-timeslot`
- `POST /v1/features/chat`
- 如确有必要再补对应 stream 版本

B. execution endpoints
- `POST /v1/execution/task`
- 如确有必要可加 `POST /v1/execution/task/stream`

3. 明确 feature 与 execution 的边界
这是这次重构最关键的原则：

- feature endpoint 用于明确业务能力调用
  - suggest
  - generate_plan
  - conflicts
  - timeslots
  - chat
- execution endpoint 用于通用任务执行（类似让 OpenClaw 当 coding agent 去执行任务）

禁止继续把 execution 请求当成 feature structured result 请求处理。
例如：
- `POST /v1/execution/task` 不应该再强制要求 `submit_structured_result`
- `POST /v1/features/generate-plan` 应该优先识别 `generate_task_plan_graph`
- `POST /v1/features/suggest` 应该优先识别 `suggest_task_completions`

4. 结果协议必须与 endpoint 语义一致
必须按 endpoint 分别定义成功/失败条件：

- `features/generate-plan`
  - 成功条件：拿到 `generate_task_plan_graph` 对应业务结果
  - 不要再要求 `submit_structured_result`
- `features/suggest`
  - 成功条件：拿到 `suggest_task_completions` 业务结果
- `execution/task`
  - 成功条件：agent 任务执行完成，返回普通 `output + toolCalls + usage + transcript-derived data`
  - 不要求 feature business tool
  - 不要求 `submit_structured_result`

5. 当前 legacy blob / transcript 行为要保留并按 endpoint 语义利用
你必须理解并保留当前 bridge 的几个现有能力：
- stderr NDJSON 解析
- transcript JSONL 解析
- legacy single-blob JSON 回退
- tool call extraction

但这些能力必须服务于“明确 endpoint 语义”，而不是再回到 generic chat 乱猜模式。

仓库背景与现状

你现在处理的是 Chrona 仓库，关键层次如下：

- `packages/providers/openclaw/bridge`
  - Bun HTTP server，包装 `openclaw agent --local --json`
- `packages/providers/openclaw/integration`
  - OpenClaw bridge client / runtime adapter / execution transport
- `packages/common/ai-features`
  - AI feature layer：suggest / generate_plan / conflicts / timeslots / chat
- `src/app/api/ai/*`
  - app 层 feature API，已经大部分是 feature-specific
- `src/hooks/ai/*`
  - 前端 hooks，调用 app 层 `/api/ai/*`

当前真正模糊的是 bridge 层和 feature-provider 层，而不是 app 层。

你必须先阅读这些关键文件

bridge:
- `packages/providers/openclaw/bridge/src/server.ts`
- `packages/providers/openclaw/bridge/src/server.bun.test.ts`
- `packages/providers/openclaw/bridge/README.md`

integration:
- `packages/providers/openclaw/integration/src/transport/bridge-types.ts`
- `packages/providers/openclaw/integration/src/transport/bridge-client.ts`

feature layer:
- `packages/common/ai-features/src/core/types.ts`
- `packages/common/ai-features/src/core/providers.ts`
- `packages/common/ai-features/src/core/streaming.ts`
- `packages/common/ai-features/src/core/prompts.ts`
- `packages/common/ai-features/src/features/index.ts`

backend API:
- `src/modules/ai/ai-service.ts`
- `src/app/api/ai/auto-complete/route.ts`
- `src/app/api/ai/generate-task-plan/route.ts`
- `src/app/api/ai/suggest-timeslot/route.ts`
- `src/app/api/ai/analyze-conflicts/route.ts`
- `src/app/api/ai/suggest-automation/route.ts`
- `src/app/api/ai/apply-suggestion/route.ts`

frontend callers:
- `src/hooks/ai/use-auto-complete.ts`
- `src/hooks/ai/use-smart-decomposition.ts`
- `src/hooks/ai/use-smart-timeslot.ts`
- `src/hooks/ai/use-smart-automation.ts`

实现要求

第一部分：bridge server 路由重构

在 `packages/providers/openclaw/bridge/src/server.ts` 中：

1. 删除或废弃以下路由：
- `POST /v1/chat`
- `POST /v1/chat/stream`

2. 改为显式 feature routes：
- `/v1/features/suggest`
- `/v1/features/suggest/stream`
- `/v1/features/generate-plan`
- `/v1/features/generate-plan/stream`
- `/v1/features/analyze-conflicts`
- `/v1/features/suggest-timeslot`
- `/v1/features/chat`

3. 增加 execution route：
- `/v1/execution/task`

4. 每个 route 有自己明确的 request shape
不要继续只用一个 `BridgeRequest` 覆盖所有场景。
至少拆成：

A. feature request
可设计为类似：
- `sessionId?: string`
- `input: object`
- `timeout?: number`

B. execution request
可设计为类似：
- `sessionId?: string`
- `instructions: string`
- `taskId?: string`
- `workspaceId?: string`
- `taskTitle?: string`
- `runtimeAdapterKey?: string`
- `runtimeInput?: Record<string, unknown>`
- `timeout?: number`

5. 每个 feature route 直接绑定语义
不要在 route handler 里再靠 request body 中的 feature 字段分发到一个 generic chat runner。
可以有公共 helper，但 route 层语义必须明确。

例如：
- `generate-plan` route 内部就应该明确使用 generate_plan 对应 prompt / parsing / extraction 策略
- `suggest` route 内部就应该明确走 suggestions 协议

第二部分：bridge 结果提取策略重构

你必须按 endpoint 语义重写 bridge 的成功判定逻辑：

1. `features/generate-plan`
成功标准：
- 优先从 business tool `generate_task_plan_graph` 中提取
- transcript / NDJSON / legacy blob 中都可以找
- 找到就成功
- 不要求 `submit_structured_result`

2. `features/suggest`
成功标准：
- 优先从 business tool `suggest_task_completions` 中提取
- 不要求 `submit_structured_result`

3. `features/analyze-conflicts`、`features/suggest-timeslot`
如果当前尚未有 dedicated business tool，可先保持一致设计：
- 有明确结构化 payload 成功
- 若仍依赖文本 JSON，也请按 feature route 独立处理，不允许回到 generic chat 语义

4. `execution/task`
成功标准：
- 只要 OpenClaw 执行成功，返回真实：
  - `output`
  - `toolCalls`
  - `usage`
  - `durationMs`
  - `sessionId`
  - `runId`
- 不允许因为缺少 `submit_structured_result` 而将 execution/task 视为失败

5. 修正当前 output 提取问题
当前 bridge 在某些场景下会出现：
- `output: ""`
- 但 stderr 里其实有一个巨大 legacy JSON blob，其中 `payloads[*].text` 才是真正输出

你必须修好这一点：
- 当不是 NDJSON stream 时，正确从 legacy blob 中提取最终 output
- 不允许再出现 agent 明明执行了大量内容但返回 `output: ""` 的情况

第三部分：ai-features 调用方式重构

在 `packages/common/ai-features/src/core/providers.ts` 和 `packages/common/ai-features/src/core/streaming.ts` 中：

1. 不要再调用：
- `/v1/chat`
- `/v1/chat/stream`

2. 按 feature 直接调用对应 endpoint
例如：
- suggest -> `/v1/features/suggest`
- generate_plan -> `/v1/features/generate-plan`
- conflicts -> `/v1/features/analyze-conflicts`
- timeslots -> `/v1/features/suggest-timeslot`
- chat -> `/v1/features/chat`

3. streaming 同理
- suggestStream -> `/v1/features/suggest/stream`
- generatePlanStream -> `/v1/features/generate-plan/stream`

4. feature route 请求体应传结构化 input，不是 generic message
比如：
- suggest 直接传 `SmartSuggestRequest`
- generate-plan 直接传 `GenerateTaskPlanRequest`

不要再把 feature input 先拼成字符串，再通过 generic chat 发送。

第四部分：openclaw integration 调用方式重构

在 `packages/providers/openclaw/integration/src/transport/bridge-client.ts` 中：

1. task execution 相关调用不要再打 `/v1/chat`
2. 改成打：
- `/v1/execution/task`

3. request body 也改成 execution 专用结构
不要再伪装成 generic message request。

第五部分：测试与文档

必须补齐/更新以下内容：

1. bridge server tests
重点补：
- feature endpoint 路由测试
- generate-plan 成功提取 `generate_task_plan_graph`
- suggest 成功提取 `suggest_task_completions`
- execution/task 不因为缺少 structured result 而报错
- legacy blob output 提取测试
- transcript 回退提取测试

2. README 更新
重写：
- `packages/providers/openclaw/bridge/README.md`

把旧的：
- `/v1/chat`
- `/v1/chat/stream`

文档全部改为新的 feature/execution endpoint 说明。
提供新的 curl 样例，至少包括：
- `GET /v1/health`
- `POST /v1/features/generate-plan`
- `POST /v1/features/suggest`
- `POST /v1/execution/task`

3. 若有 app 层或 hook 层受影响，也要同步更新测试

设计原则

必须严格遵守：

1. 语义显式优先于 prompt 隐式
route 决定功能，不是 prompt 猜功能。

2. feature 与 execution 严格分层
不要再混用。

3. 不要为了兼容保留旧 chat 入口
这次是激进重构。
可以短暂保留 thin compatibility wrapper，但默认目标是完全移除旧路径使用。
最终代码不应再依赖 generic `/v1/chat`。

4. 保持调用链清晰
目标是让未来任何人看到请求路径就知道它在做什么。

5. 结果协议与 endpoint 对齐
不要再出现：
- execution task 被按 generate_plan 的 structured contract 判断失败
这种语义错位。

交付物要求

完成后请输出：

1. 修改了哪些文件
2. 新增了哪些 endpoint
3. 删除/废弃了哪些旧 endpoint
4. 哪些调用方已迁移
5. 哪些测试新增/更新
6. 关键 curl 示例
7. 剩余风险或后续可选收敛项

实施顺序建议

请按这个顺序做：

1. 先改 bridge types 和 route 设计
2. 再改 bridge server 实现
3. 再改 ai-features 调用方
4. 再改 openclaw-integration 调用方
5. 再改测试
6. 最后改 README 和示例 curl

验证要求

至少执行并报告这些验证：

- bridge server 相关测试
- 关键 feature route 测试
- 关键 execution route 测试
- 至少一次真实 curl 验证：
  - feature route 不再返回 generic chat 语义结果
  - execution route 不再因缺少 structured result 而失败

附加说明

这次重构的目标不是“少改代码”，而是“把语义彻底做对”。
不要给我一个只是换了路径名、内部仍然走 generic chat 的假 REST 设计。
我要的是：
- route 语义明确
- request schema 明确
- result extraction 明确
- execution 和 feature 完全分开

如果你需要做中间 helper，请确保 helper 是服务于显式 feature/execution route，而不是重新构造一个隐式 generic chat core。

开始前先快速审计现有调用链，再实施改动。
