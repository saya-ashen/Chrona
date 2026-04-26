# OpenClaw OpenResponses Bridge Smoke Commands

## 1. Start the bridge

From repo root:

```bash
bun run openclaw:bridge
```

Recommended environment variables:

```bash
export OPENCLAW_OPENRESPONSES_URL="http://127.0.0.1:18789"
export OPENCLAW_GATEWAY_TOKEN="<gateway-token>"
export OPENCLAW_AGENT_ID="main"
# optional
export OPENCLAW_MODEL="openclaw"
export OPENCLAW_MESSAGE_CHANNEL="chrona-bridge"
```

Notes:
- `OPENCLAW_OPENRESPONSES_URL` must be an `http://` or `https://` URL.
- Do not pass `ws://` or `wss://` here. This bridge now targets the Gateway OpenResponses HTTP compatibility endpoint.

## 2. Health check

```bash
curl -s http://127.0.0.1:7677/v1/health | jq
```

Expected shape:

```json
{
  "status": "ok",
  "gateway": "http://127.0.0.1:18789"
}
```

## 3. Generate plan feature call

```bash
curl -s http://127.0.0.1:7677/v1/features/generate-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "demo-plan-session",
    "sessionKey": "tenant-a:task-001",
    "input": {
      "taskId": "task-001",
      "title": "Prepare weekly research summary",
      "description": "Summarize experiments, blockers, and next steps",
      "estimatedMinutes": 90
    },
    "timeout": 60
  }' | jq
```

## 4. Generate plan streaming

```bash
curl -N http://127.0.0.1:7677/v1/features/generate-plan/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "demo-plan-stream",
    "sessionKey": "tenant-a:task-001",
    "input": {
      "taskId": "task-001",
      "title": "Prepare weekly research summary",
      "description": "Summarize experiments, blockers, and next steps",
      "estimatedMinutes": 90
    },
    "timeout": 60
  }'
```

## 5. Execution task call

```bash
curl -s http://127.0.0.1:7677/v1/execution/task \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "demo-exec-session",
    "sessionKey": "tenant-a:task-001",
    "instructions": "Review the task context and produce a concise operator-facing summary.",
    "taskId": "task-001",
    "workspaceId": "workspace-a",
    "taskTitle": "Prepare weekly research summary",
    "runtimeAdapterKey": "openclaw",
    "runtimeInput": {
      "model": "openclaw"
    },
    "timeout": 60
  }' | jq
```

## 6. Execution task streaming

```bash
curl -N http://127.0.0.1:7677/v1/execution/task/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "demo-exec-stream",
    "sessionKey": "tenant-a:task-001",
    "instructions": "Review the task context and produce a concise operator-facing summary.",
    "taskId": "task-001",
    "workspaceId": "workspace-a",
    "taskTitle": "Prepare weekly research summary",
    "runtimeAdapterKey": "openclaw",
    "runtimeInput": {
      "model": "openclaw"
    },
    "timeout": 60
  }'
```

## 7. Session continuity expectation

For repeated calls with the same `sessionKey`, the bridge will:
- send OpenResponses `user` derived from that session key
- reuse `previous_response_id` when available
- send `x-openclaw-session-key`

That gives stable OpenClaw session continuity without requiring direct Gateway WebSocket usage.
