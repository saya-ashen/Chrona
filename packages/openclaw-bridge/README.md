# OpenClaw Bridge Server API

位置：`packages/openclaw-bridge/src/server.ts`

这个 bridge server 是运行在本机的 Bun HTTP 服务，用来包装 `openclaw agent --local --json`。它现在提供按语义拆分的 RESTful API：feature endpoint 负责明确业务能力，execution endpoint 负责通用任务执行。

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

## 总览

Endpoints:
- `GET /v1/health`
- `POST /v1/features/suggest`
- `POST /v1/features/suggest/stream`
- `POST /v1/features/generate-plan`
- `POST /v1/features/generate-plan/stream`
- `POST /v1/features/analyze-conflicts`
- `POST /v1/features/suggest-timeslot`
- `POST /v1/features/chat`
- `POST /v1/execution/task`
- `POST /v1/execution/task/stream`

统一行为：
- 支持 CORS
- `OPTIONS` 返回 `204`
- 未命中路由返回 `404`
- JSON body 非法时返回 `400`
- feature endpoint 缺少 `input` 返回 `400`
- execution endpoint 缺少 `instructions` 返回 `400`
- feature endpoint 的成功/失败按 endpoint 语义判定，不再共用 generic chat contract
- execution endpoint 不再要求任何 legacy structured submission tool

## 1) GET /v1/health

用途：检查 bridge 是否在线，以及 `openclaw` CLI 是否可用。

成功响应示例：

```json
{
  "status": "ok",
  "bin": "openclaw"
}
```

## 2) Feature endpoints

### 请求体

所有 feature endpoint 共用统一外层结构，但 `input` 内容由 endpoint 语义决定：

```json
{
  "sessionId": "optional-session-id",
  "input": { "feature-specific": true },
  "timeout": 120
}
```

### 成功语义

- `/v1/features/suggest`
  - 必须提取 `suggest_task_completions` 业务 tool payload 才算成功
- `/v1/features/generate-plan`
  - 必须提取 `generate_task_plan_graph` 业务 tool payload 才算成功
- `/v1/features/analyze-conflicts`
  - 当前允许结构化 JSON output 或 assistant text fallback，但按 conflicts endpoint 单独处理
- `/v1/features/suggest-timeslot`
  - 当前允许结构化 JSON output 或 assistant text fallback，但按 timeslots endpoint 单独处理
- `/v1/features/chat`
  - 返回 chat assistant output；如有结构化 payload 也会附带

### 响应结构

```json
{
  "sessionId": "sess-1",
  "runId": "run-1",
  "output": "assistant output",
  "toolCalls": [],
  "usage": null,
  "error": null,
  "durationMs": 1234,
  "structured": null,
  "feature": {
    "feature": "generate_plan",
    "source": "business_tool",
    "toolName": "generate_task_plan_graph",
    "payload": {
      "summary": "Plan ready",
      "nodes": [],
      "edges": []
    }
  }
}
```

当 feature endpoint 没有满足该 endpoint 的成功协议时，返回 `422`。

## 3) Execution endpoint

### `POST /v1/execution/task`

请求体：

```json
{
  "sessionId": "optional-session-id",
  "instructions": "Implement the schedule automation flow.",
  "taskId": "task-123",
  "workspaceId": "ws-1",
  "taskTitle": "Schedule automation",
  "runtimeAdapterKey": "openclaw",
  "runtimeInput": {
    "model": "gpt-5.4",
    "approvalPolicy": "never",
    "toolMode": "workspace-write",
    "temperature": 0.2
  },
  "timeout": 300
}
```

成功语义：
- 只要 OpenClaw 执行成功，就返回真实 execution 结果
- 不要求 feature business tool
- 不要求任何 legacy structured submission tool

响应中仍然会包含：
- `output`
- `toolCalls`
- `usage`
- `durationMs`
- `sessionId`
- `runId`
- `structured`（如果缺少 structured result，会显示 fallback_text，但不会导致 execution endpoint 失败）

## 4) Streaming endpoints

`/v1/features/suggest/stream`、`/v1/features/generate-plan/stream`、`/v1/execution/task/stream` 使用 SSE：

- `event: event`：转发 NDJSON 中间事件
- `event: done`：最终 `BridgeResponse`
- `event: error`：服务错误

## 关键 curl 示例

### 健康检查

```bash
curl http://localhost:7677/v1/health
```

### Generate plan

```bash
curl -X POST http://localhost:7677/v1/features/generate-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "taskId": "task-1",
      "title": "准备毕业答辩",
      "description": "输出最终答辩材料",
      "estimatedMinutes": 240
    }
  }'
```

### Suggest

```bash
curl -X POST http://localhost:7677/v1/features/suggest \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "input": "写测试",
      "kind": "general",
      "workspaceId": "ws-1"
    }
  }'
```

### Execution task

```bash
curl -X POST http://localhost:7677/v1/execution/task \
  -H 'Content-Type: application/json' \
  -d '{
    "instructions": "Inspect the repository and update the README.",
    "taskId": "task-123",
    "workspaceId": "ws-1",
    "taskTitle": "README refresh",
    "runtimeAdapterKey": "openclaw",
    "runtimeInput": {
      "model": "gpt-5.4",
      "approvalPolicy": "never",
      "toolMode": "workspace-write"
    },
    "timeout": 300
  }'
```

### Generate plan stream

```bash
curl -N -X POST http://localhost:7677/v1/features/generate-plan/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "taskId": "task-1",
      "title": "准备毕业答辩"
    }
  }'
```

## 设计原则

- route 语义决定功能，不再依赖 `/v1/chat`
- feature 与 execution 严格分层
- bridge 保留 NDJSON / transcript / legacy blob / tool call extraction 能力
- 这些提取能力现在服务于显式 endpoint contract，而不是 generic chat 猜测
