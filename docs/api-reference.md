# Chrona API Reference

Base URL: `http://localhost:3101/api`

- **Content-Type:** `application/json`
- **Auth:** Optional `Authorization: Bearer <token>` (when `API_KEY` env var is set)
- **Response envelope:** List endpoints return `{ tasks: [], count: N }`, detail endpoints return the object directly, action endpoints return `{ success: true, ... }`.
- **Dates:** ISO 8601

## Health

### `GET /api/health`

```sh
curl http://localhost:3101/api/health
```

Response: `{ "status": "ok" }`

## Tasks

### `GET /api/tasks`

List tasks.

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| `workspaceId` | string | Yes | |
| `status` | string | No | Filter by status |
| `limit` | number | No | |

```sh
curl "http://localhost:3101/api/tasks?workspaceId=ws_abc"
```

Response: `{ tasks: Task[], count: number }`

### `POST /api/tasks`

Create a task.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceId` | string | Yes | |
| `title` | string | Yes | |
| `description` | string | No | |
| `priority` | `"Low" \| "Medium" \| "High" \| "Urgent"` | No | Default `"Medium"` |
| `executionRuntime` | string (`EXECUTION_RUNTIMES`) | No | e.g. `"openclaw"` |
| `executionConfig` | `Record<string, unknown>` | No | Runtime-specific configuration |
| `parentTaskId` | string \| null | No | Parent for subtask nesting |

```sh
curl -X POST http://localhost:3101/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"ws_abc","title":"Deploy service","priority":"High"}'
```

Response: `201 Created`

### `GET /api/tasks/:taskId`

Get full task detail page data.

```sh
curl http://localhost:3101/api/tasks/task_xyz
```

### `PATCH /api/tasks/:taskId`

Partial update.

```sh
curl -X PATCH http://localhost:3101/api/tasks/task_xyz \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","priority":"Urgent"}'
```

### `DELETE /api/tasks/:taskId`

Cascade-delete a task.

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| `workspaceId` | string | Yes | |

```sh
curl -X DELETE "http://localhost:3101/api/tasks/task_xyz?workspaceId=ws_abc"
```

## Task Execution

### `POST /api/tasks/:taskId/execution/actions`

Dispatch an execution action. Body validated against `executionActionBodySchema`.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/execution/actions \
  -H "Content-Type: application/json" \
  -d '{"action":"start"}'
```

## Task Lifecycle

### `POST /api/tasks/:taskId/complete`

Mark a task as done.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/complete
```

### `POST /api/tasks/:taskId/reopen`

Reopen a completed task.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/reopen
```

## Task Result

### `POST /api/tasks/:taskId/result/accept`

Accept a task result.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/result/accept
```

## Task Plan

### `POST /api/tasks/:taskId/plan/generations`

Generate a plan via SSE streaming.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `forceRefresh` | boolean | No | Bypass cache |
| `planningPrompt` | string | No | Custom prompt override |

For streaming, set `Accept: text/event-stream`. Without it, falls back to JSON.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/plan/generations \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"forceRefresh":true}'
```

#### SSE Events

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ phase: string, message: string }` | Progress update |
| `tool_call` | `{ tool: string, callId?: string, input?: object }` | AI tool invocation |
| `partial` | `{ text: string }` | Streaming text fragment |
| `result` | `{ plan: PlanBlueprint }` | Completed plan graph |
| `done` | `{ text: string }` | Stream finished successfully |
| `error` | `{ code: string, message: string, rawText?: string }` | Error during generation |

### `POST /api/tasks/:taskId/plan/generations/stop`

Stop an in-flight plan generation.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/plan/generations/stop
```

### `POST /api/tasks/:taskId/plan`

Edit a plan with patch operations (passthrough schema — allows extra fields).

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Top-level operation |
| `operations` | string[] | Batch operations |
| `nodes` | Record[] | Plan nodes |
| `edges` | Record[] | Plan edges |
| `nodePatches` | `{ id: string }[]` | Targeted node updates |
| `deletedNodeIds` | string[] | Nodes to remove |
| `reorder` | string[] | New ordering |
| `summary` | string | Text summary |

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/plan \
  -H "Content-Type: application/json" \
  -d '{"operation":"add_node","nodes":[{"type":"task","title":"New step"}]}'
```

#### Plan Types

- **PlanBlueprint** — AI-generated plan with nodes (`task`, `checkpoint`, `condition`, `wait`) and edges.
- **EditablePlan** — User-editable plan with version tracking.
- **PlanPatch** — Operations: `add_node`, `delete_node`, `update_node`, `update_dependencies`.

## Task Schedule

### `PUT /api/tasks/:taskId/schedule`

Apply a schedule to a task.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scheduledStartAt` | ISO 8601 | Yes | |
| `scheduledEndAt` | ISO 8601 | Yes | |
| `dueAt` | ISO 8601 | No | |
| `scheduleSource` | `"human" \| "ai" \| "system"` | No | Origin of schedule |

```sh
curl -X PUT http://localhost:3101/api/tasks/task_xyz/schedule \
  -H "Content-Type: application/json" \
  -d '{"scheduledStartAt":"2026-05-10T09:00:00Z","scheduledEndAt":"2026-05-10T11:00:00Z"}'
```

### `DELETE /api/tasks/:taskId/schedule`

Clear a task's schedule.

```sh
curl -X DELETE http://localhost:3101/api/tasks/task_xyz/schedule
```

### `POST /api/tasks/:taskId/schedule/proposals`

Create an AI-generated schedule proposal for a task.

```sh
curl -X POST http://localhost:3101/api/tasks/task_xyz/schedule/proposals
```

### `POST /api/tasks/schedule-proposals/decision`

Accept or reject a schedule proposal.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `proposalId` | string | Yes | |
| `decision` | `"Accepted" \| "Rejected"` | Yes | |
| `workspaceId` | string | No | |
| `resolutionNote` | string | No | |

```sh
curl -X POST http://localhost:3101/api/tasks/schedule-proposals/decision \
  -H "Content-Type: application/json" \
  -d '{"proposalId":"prop_123","decision":"Accepted"}'
```

## Pages

Pre-computed page data endpoints. Each requires `workspaceId` query param.

### `GET /api/schedule`

Schedule page data.

```sh
curl "http://localhost:3101/api/schedule?workspaceId=ws_abc"
```

### `GET /api/inbox`

Inbox page data.

```sh
curl "http://localhost:3101/api/inbox?workspaceId=ws_abc"
```

### `GET /api/memory`

Memory page data.

```sh
curl "http://localhost:3101/api/memory?workspaceId=ws_abc"
```

### `GET /api/work/:taskId`

Work page data for a specific task.

```sh
curl "http://localhost:3101/api/work/task_xyz"
```

## Workspaces

### `GET /api/workspaces/default`

Get the default workspace.

```sh
curl http://localhost:3101/api/workspaces/default
```

### `GET /api/workspaces`

List all workspaces.

```sh
curl http://localhost:3101/api/workspaces
```

### `GET /api/workspaces/:workspaceId/overview`

Workspace overview (stats, counts, recent activity).

```sh
curl http://localhost:3101/api/workspaces/ws_abc/overview
```

## AI Clients

### `GET /api/ai/clients`

List all AI clients.

```sh
curl http://localhost:3101/api/ai/clients
```

Response:

```json
{
  "clients": [
    {
      "id": "client_1",
      "name": "OpenClaw",
      "type": "openclaw",
      "config": {},
      "isDefault": true,
      "enabled": true,
      "bindings": ["suggest", "generate_plan"],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

### `POST /api/ai/clients`

Create an AI client.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | |
| `type` | `"openclaw" \| "llm"` | Yes | |
| `config` | Record | Yes | Provider-specific configuration |
| `isDefault` | boolean | No | |

```sh
curl -X POST http://localhost:3101/api/ai/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"GPT-4","type":"llm","config":{"apiKey":"sk-..."}}'
```

Response: `201 Created`

### `PATCH /api/ai/clients/:clientId`

Update an AI client (partial).

| Field | Type | Required |
|-------|------|----------|
| `name` | string | No |
| `config` | Record | No |
| `isDefault` | boolean | No |
| `enabled` | boolean | No |

```sh
curl -X PATCH http://localhost:3101/api/ai/clients/client_1 \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

### `DELETE /api/ai/clients/:clientId`

Delete an AI client.

```sh
curl -X DELETE http://localhost:3101/api/ai/clients/client_1
```

### `POST /api/ai/clients/test`

Test connectivity to an AI provider.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"openclaw" \| "llm"` | Yes | |
| `config` | Record | Yes | |

```sh
curl -X POST http://localhost:3101/api/ai/clients/test \
  -H "Content-Type: application/json" \
  -d '{"type":"llm","config":{"apiKey":"sk-..."}}'
```

Response: `{ ok: boolean, available: boolean, reason?: string }`

### `PUT /api/ai/clients/:clientId/bindings`

Assign feature bindings to an AI client.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `features` | string[] | Yes | One or more of: `"suggest"`, `"generate_plan"`, `"conflicts"`, `"timeslots"`, `"chat"`, `"dispatch_task"` |

```sh
curl -X PUT http://localhost:3101/api/ai/clients/client_1/bindings \
  -H "Content-Type: application/json" \
  -d '{"features":["suggest","chat"]}'
```

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_PARAMS` | Missing or malformed parameters |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `STATE_CONFLICT` | State conflict (task not in correct state for operation) |
| 409 | `PLAN_GENERATION_IN_FLIGHT` | A plan generation is already running for this task |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

Error response body:

```json
{
  "error": "human-readable description",
  "code": "ERROR_CODE"
}
```

## Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/tasks` | List tasks |
| `POST` | `/api/tasks` | Create task |
| `GET` | `/api/tasks/:taskId` | Get task detail |
| `PATCH` | `/api/tasks/:taskId` | Update task |
| `DELETE` | `/api/tasks/:taskId` | Delete task |
| `POST` | `/api/tasks/:taskId/execution/actions` | Dispatch execution action |
| `POST` | `/api/tasks/:taskId/complete` | Mark task done |
| `POST` | `/api/tasks/:taskId/reopen` | Reopen task |
| `POST` | `/api/tasks/:taskId/result/accept` | Accept task result |
| `POST` | `/api/tasks/:taskId/plan/generations` | Generate plan (SSE) |
| `POST` | `/api/tasks/:taskId/plan/generations/stop` | Stop plan generation |
| `POST` | `/api/tasks/:taskId/plan` | Edit plan |
| `PUT` | `/api/tasks/:taskId/schedule` | Set schedule |
| `DELETE` | `/api/tasks/:taskId/schedule` | Clear schedule |
| `POST` | `/api/tasks/:taskId/schedule/proposals` | Propose schedule |
| `POST` | `/api/tasks/schedule-proposals/decision` | Resolve schedule proposal |
| `GET` | `/api/schedule` | Schedule page |
| `GET` | `/api/inbox` | Inbox page |
| `GET` | `/api/memory` | Memory page |
| `GET` | `/api/work/:taskId` | Work page |
| `GET` | `/api/workspaces/default` | Default workspace |
| `GET` | `/api/workspaces` | List workspaces |
| `GET` | `/api/workspaces/:workspaceId/overview` | Workspace overview |
| `GET` | `/api/ai/clients` | List AI clients |
| `POST` | `/api/ai/clients` | Create AI client |
| `PATCH` | `/api/ai/clients/:clientId` | Update AI client |
| `DELETE` | `/api/ai/clients/:clientId` | Delete AI client |
| `POST` | `/api/ai/clients/test` | Test AI connectivity |
| `PUT` | `/api/ai/clients/:clientId/bindings` | Set AI client feature bindings |
