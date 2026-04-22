# OpenClaw Bridge Server API 文档

位置：`packages/openclaw-bridge/src/server.ts`

这个 bridge server 是一个运行在本机的 Bun HTTP 服务，用来包装 `openclaw agent --local --json`。它对外暴露简单的 REST/SSE 接口，内部负责：
- 启动 `openclaw agent` 子进程
- 把请求转换成 OpenClaw agent 的命令行参数
- 解析 stderr 中的 NDJSON 事件流
- 从 transcript / legacy blob 中提取结构化结果
- 将结构化失败明确提升为 HTTP 错误

默认端口：`7677`
可通过环境变量覆盖：`OPENCLAW_BRIDGE_PORT`

可用环境变量
- `OPENCLAW_BRIDGE_PORT`：bridge 监听端口，默认 `7677`
- `OPENCLAW_BIN`：OpenClaw 可执行文件路径，默认 `openclaw`
- `OPENCLAW_BRIDGE_LOG_LEVEL`：日志级别，支持 `debug | info | warn | error`，默认 `info`

## 启动方式

在仓库根目录执行：

```bash
bun packages/openclaw-bridge/src/server.ts
```

如果想显式指定端口：

```bash
OPENCLAW_BRIDGE_PORT=7677 bun packages/openclaw-bridge/src/server.ts
```

启动后会监听：

```text
http://localhost:7677
```

## 总览

Endpoints:
- `GET /v1/health`
- `POST /v1/chat`
- `POST /v1/chat/stream`

统一行为：
- 支持 CORS
- `OPTIONS` 返回 `204`
- 未命中路由返回 `404`
- JSON body 非法时返回 `400`
- 缺少 `message` 字段时返回 `400`
- 若 agent 执行失败，或结构化结果缺失/非法，则 `/v1/chat` 返回错误状态码，`/v1/chat/stream` 发送 SSE `error` 事件

## 1) GET /v1/health

用途：检查 bridge 是否在线，以及 `openclaw` CLI 是否可用。

请求：

```http
GET /v1/health
```

成功响应示例：

```json
{
  "status": "ok",
  "bin": "openclaw"
}
```

当 OpenClaw CLI 不可用时：

```json
{
  "status": "unavailable",
  "bin": "openclaw"
}
```

说明：
- 这个接口只检查 `openclaw --version` 是否可成功执行
- bridge 服务本身在线，不代表 OpenClaw CLI 一定可用

## 2) POST /v1/chat

用途：阻塞式调用。发送一条消息，等待整个 agent 运行完成后一次性返回结果。

请求头：

```http
Content-Type: application/json
```

请求体：

```json
{
  "sessionId": "optional-session-id",
  "message": "user message",
  "systemPrompt": "optional system prompt",
  "timeout": 300,
  "execution": {
    "mode": "task",
    "runtimeAdapterKey": "openclaw",
    "taskId": "task-123",
    "workspaceId": "ws-1",
    "taskTitle": "Schedule automation",
    "runtimeInput": {
      "model": "gpt-5.4",
      "approvalPolicy": "never",
      "toolMode": "workspace-write",
      "temperature": 0.2
    }
  }
}
```

字段说明：
- `sessionId?: string`
  - 可选。若不传，bridge 会自动生成 UUID
  - 用于让多次请求复用同一个 OpenClaw session transcript
- `message: string`
  - 必填。要发送给 agent 的主消息
- `systemPrompt?: string`
  - 可选。若传入，bridge 会把它包到最终 message 中
- `timeout?: number`
  - 可选。单位秒
  - 会被映射到 agent 参数 `--timeout <seconds>`
  - bridge 子进程总超时是 `(timeout 或 300) * 1000 + 10000`
- `execution?: object`
  - 可选。用于把 Chrona 的任务执行上下文传给 bridge
  - 当前支持的 `mode` 只有 `"task"`

### execution.mode = task 的行为

当 `execution.mode === "task"` 时，bridge 不会把 `runtimeInput` 直接映射成 OpenClaw CLI flags；而是把这些元信息包装进最终发送给 agent 的 message 中。

也就是说，最终发给 agent 的消息会被包装成类似：

```text
[Chrona Task Execution Request]
Task: Schedule automation
Task ID: task-123
Workspace ID: ws-1
Runtime adapter: openclaw
Model: gpt-5.4
Approval policy: never
Tool mode: workspace-write
Temperature: 0.2

[Task Instructions]
Implement the schedule automation flow.
```

如果同时传入 `systemPrompt`，则最外层还会再包一层：

```text
[System Prompt]
...

[User Message]
...
```

### bridge 实际启动的 CLI 形式

bridge 会调用：

```bash
openclaw agent --local --json --session-id <sessionId> --message <message> [--timeout <seconds>]
```

### 成功响应结构

```json
{
  "sessionId": "...",
  "runId": "bridge-run-...",
  "output": "final assistant text",
  "toolCalls": [
    {
      "tool": "submit_structured_result",
      "callId": "call-1",
      "input": {},
      "result": "accepted",
      "status": "completed"
    }
  ],
  "usage": {
    "inputTokens": 123,
    "outputTokens": 456
  },
  "error": null,
  "durationMs": 3210,
  "structured": {
    "ok": true,
    "parsed": {},
    "structured": {},
    "rawToolCall": {},
    "rawOutput": "...",
    "status": "success",
    "error": null,
    "validationIssues": [],
    "reliability": "tool_call",
    "sessionId": "...",
    "runId": "...",
    "bridgeToolCalls": []
  }
}
```

### 错误响应语义

`POST /v1/chat` 的错误分两大类：

1. 进程/执行错误 -> HTTP `500`
2. 结构化结果缺失或非法 -> HTTP `422`

判定逻辑：
- `result.error` 存在 -> 视为错误
- `result.structured` 存在但 `structured.ok === false` -> 视为错误

因此：
- 成功且结构化有效 -> `200`
- 结构化失败 -> `422`
- 其它执行失败 -> `500`

结构化失败错误体会返回精简过的结果对象，包含：
- `error`
- `sessionId`
- `runId`
- `durationMs`
- `output`
- `toolCalls`
- `structured`

### 常见 400 错误

非法 JSON：

```json
{ "error": "Invalid JSON body" }
```

缺少 message：

```json
{ "error": "message is required" }
```

## 3) POST /v1/chat/stream

用途：流式调用。通过 SSE 持续输出 OpenClaw 的中间事件。

请求头：

```http
Content-Type: application/json
Accept: text/event-stream
```

请求体与 `/v1/chat` 相同。

响应类型：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### SSE 事件类型

bridge 会发出以下事件名：
- `event`
- `done`
- `error`

#### event

这是把 OpenClaw stderr 中解析出的 NDJSON 原样转发出来。

常见 payload 结构来自 `NDJSONEvent`：

```json
{
  "type": "text",
  "sessionId": "...",
  "text": "hello"
}
```

也可能是：

```json
{
  "type": "tool_use",
  "tool": "submit_structured_result",
  "callId": "call-1",
  "input": {}
}
```

以及：
- `tool_result`
- `step_finish`
- `error`
- `lifecycle`

当前 bridge 识别的 NDJSON 关键字段：
- `type`
- `sessionId?`
- `text?`
- `tool?`
- `callId?`
- `input?`
- `error?`
- `phase?`
- `message?`
- `usage?`

#### done

当整个 agent 运行成功结束且不需要被提升为 HTTP 级错误时，发送：

```json
{
  "sessionId": "...",
  "runId": "...",
  "output": "...",
  "toolCalls": [],
  "usage": null,
  "error": null,
  "durationMs": 1234,
  "structured": {
    "ok": true,
    "status": "success"
  }
}
```

#### error

当执行失败或结构化结果无效时，stream 不会发送 `done`，而是发送：

```json
{
  "error": "Process exited with code 1; outputPreview=\"\"",
  "sessionId": "...",
  "runId": "...",
  "structured": {
    "ok": false,
    "error": "..."
  },
  "output": ""
}
```

注意：
- `/v1/chat/stream` 的错误是通过 SSE `error` 事件表达，不是靠 HTTP 422/500 body 返回
- HTTP 连接本身通常仍然是 `200`

## transcript / structured result 提取逻辑

bridge 的结构化结果优先级大致为：

1. 实时 NDJSON 中收集到的 `tool_use` / `tool_result`
2. 若不是 NDJSON，而是 legacy blob，则优先从 session transcript 提取 tool calls
3. transcript 没拿到时，再尝试从 legacy blob 提取
4. 都失败时，降级为 fallback text，并视结构化失败

session transcript 路径：

```text
~/.openclaw/agents/main/sessions/<sessionId>.jsonl
```

bridge 会重点寻找 `submit_structured_result` 这个工具调用，并通过 `@chrona/runtime-client/openclaw/structured-result` 做校验。

## curl 测试方法

下面这些命令是按当前代码实际接口写的。

假设 bridge 运行在本机 `7677` 端口：

```bash
BASE_URL=http://127.0.0.1:7677
```

### 1. 测试健康检查

```bash
curl -sS "$BASE_URL/v1/health"
```

预期：
- OpenClaw CLI 可用时返回 `{"status":"ok","bin":"openclaw"}`
- 不可用时返回 `{"status":"unavailable","bin":"openclaw"}`

### 2. 最小阻塞式 chat 测试

```bash
curl -sS -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "hello from curl",
    "timeout": 30
  }'
```

如果你想同时看到 HTTP 状态码：

```bash
curl -sS -o /tmp/openclaw-chat.json -w '%{http_code}\n' \
  -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "hello from curl",
    "timeout": 30
  }'

cat /tmp/openclaw-chat.json
```

判断方式：
- `200`：执行成功，且结构化结果有效
- `422`：agent 跑完了，但没有交出有效结构化结果
- `500`：OpenClaw 进程层面失败

### 3. 指定 sessionId 的 chat 测试

```bash
curl -sS -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "demo-session-1",
    "message": "Continue from previous context",
    "timeout": 30
  }'
```

适合测试多轮 session 复用。

### 4. 带 systemPrompt 的测试

```bash
curl -sS -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Summarize the task",
    "systemPrompt": "You must always return a structured result.",
    "timeout": 30
  }'
```

### 5. 带 execution.task 上下文的测试

```bash
curl -sS -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Implement the schedule automation flow.",
    "timeout": 60,
    "execution": {
      "mode": "task",
      "runtimeAdapterKey": "openclaw",
      "taskId": "task-123",
      "workspaceId": "ws-1",
      "taskTitle": "Schedule automation",
      "runtimeInput": {
        "model": "gpt-5.4",
        "approvalPolicy": "never",
        "toolMode": "workspace-write",
        "temperature": 0.2
      }
    }
  }'
```

注意：
- 这里的 `runtimeInput` 目前是作为消息元信息注入，不是直接变成 OpenClaw CLI flags

### 6. 测试 SSE stream

推荐用 `curl -N`：

```bash
curl -N -X POST "$BASE_URL/v1/chat/stream" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "message": "hello from streaming curl",
    "timeout": 30
  }'
```

你会看到类似：

```text
event: event
data: {"type":"text","text":"..."}

event: event
data: {"type":"tool_use","tool":"submit_structured_result",...}

event: done
data: {...}
```

若失败，则末尾更可能是：

```text
event: error
data: {"error":"...","sessionId":"...","runId":"...","structured":{...},"output":"..."}
```

### 7. 验证 400：缺少 message

```bash
curl -sS -o /tmp/openclaw-bad.json -w '%{http_code}\n' \
  -X POST "$BASE_URL/v1/chat" \
  -H 'Content-Type: application/json' \
  -d '{}'

cat /tmp/openclaw-bad.json
```

预期：
- HTTP `400`
- body: `{"error":"message is required"}`

### 8. 验证 404

```bash
curl -sS -o /tmp/openclaw-404.json -w '%{http_code}\n' \
  "$BASE_URL/not-found"

cat /tmp/openclaw-404.json
```

预期：
- HTTP `404`
- body 会列出可用 endpoints

## 我实际验证过的点

我刚才基于当前代码和本机环境核对了以下事实：

1. 服务默认端口确实是 `7677`
2. 端口可由 `OPENCLAW_BRIDGE_PORT` 覆盖
3. 健康检查路径是 `GET /v1/health`
4. 聊天接口是 `POST /v1/chat`
5. 流式接口是 `POST /v1/chat/stream`
6. `/v1/chat` 缺少结构化结果时会走错误分支，而不是无条件返回 200
7. `execution.runtimeInput` 目前不会变成 OpenClaw CLI flags，而是写进 message envelope
8. 我用 `OPENCLAW_BIN=false` 在本地起了一个 bridge 实例，并实际用 curl 调到了：
   - `GET /v1/health` -> 返回 `{"status":"unavailable","bin":"false"}`
   - `POST /v1/chat` -> 返回错误 JSON，证明命令与路由都对得上

另外，我还发现当前机器上的 `7677` 已被占用，所以如果你本地启动失败并提示端口占用，可以换端口：

```bash
OPENCLAW_BRIDGE_PORT=17677 bun packages/openclaw-bridge/src/server.ts
```

然后把 curl 里的 base URL 改成：

```bash
BASE_URL=http://127.0.0.1:17677
```

## 建议的测试顺序

建议你按这个顺序测：

1. `GET /v1/health`
2. `POST /v1/chat` 最小请求
3. `POST /v1/chat/stream` 看实时事件
4. `POST /v1/chat` + `execution.mode=task`
5. 检查 transcript：

```bash
ls ~/.openclaw/agents/main/sessions/
```

如果你想更方便给团队看，我下一步也可以直接把这份文档补成：
- `packages/openclaw-bridge/README.md`
- 或仓库根目录 `docs/openclaw-bridge-api.md`
