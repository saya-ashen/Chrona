# API Reference

Chrona uses a local Hono API server for all business APIs. The frontend SPA proxies `/api/*` through Vite in development; in production, the same server hosts both static assets and APIs.

No authentication is required by default. Set `API_KEY` to enforce Bearer token auth.

## Health

```
GET /api/health
```

**Response 200:**
```json
{ "status": "ok" }
```

---

## Task Management `/api/tasks`

### List Tasks

```
GET /api/tasks?workspaceId={id}&status={status}&limit={n}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| workspaceId | string | Yes | Workspace ID |
| status | TaskStatus | No | Status filter (Draft, Ready, Running, etc.) |
| limit | number | No | Result limit (default 50, max 200) |

**Response 200:**
```json
{
  "tasks": [{ "id": "...", "title": "...", "status": "Ready", ... }],
  "count": 15
}
```

### Create Task

```
POST /api/tasks
Content-Type: application/json
```

**Request body:**
```json
{
  "workspaceId": "default",
  "title": "Analyze user behavior data",
  "description": "Analyze 30 days of data using Python",
  "priority": "High",
  "dueAt": "2025-01-20T00:00:00Z",
  "runtimeAdapterKey": "openclaw",
  "runtimeModel": "gpt-4o",
  "prompt": "Analyze user behavior data and generate a report",
  "runtimeConfig": "{\"key\":\"value\"}"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workspaceId | string | Yes | Workspace ID |
| title | string | Yes | Task title |
| description | string | No | Description |
| priority | TaskPriority | No | Low / Medium / High / Urgent |
| dueAt | ISO DateTime | No | Due date |
| runtimeAdapterKey | string | No | Runtime adapter (e.g. "openclaw") |
| runtimeInput | string | No | Runtime input data (JSON) |
| runtimeInputVersion | string | No | Input version |
| runtimeModel | string | No | AI model name |
| prompt | string | No | Execution prompt |
| runtimeConfig | string | No | Additional config (JSON) |

**Response 201:** Created task.

### Get Task

```
GET /api/tasks/:taskId
```

Includes latest 5 runs and projection.

### Get Task Detail

```
GET /api/tasks/:taskId/detail
```

Returns full task page data (plan, subtasks, runs, projections).

### Update Task

```
PATCH /api/tasks/:taskId
Content-Type: application/json
```

Same fields as create — all optional, partial updates supported.

### Delete Task

```
DELETE /api/tasks/:taskId
```

Cascades to all related data (runs, sessions, approvals, artifacts, events, projections, children).

**Response 200:**
```json
{ "success": true, "taskId": "cm..." }
```

---

## Task Operations

### Start Run

```
POST /api/tasks/:taskId/run
```

**Request body (optional):**
```json
{ "prompt": "Optional prompt override" }
```

### Retry Run

```
POST /api/tasks/:taskId/retry
```

**Request body (optional):**
```json
{ "prompt": "Optional prompt override" }
```

### Resume Run

```
POST /api/tasks/:taskId/resume
```

**Request body:**
```json
{
  "runId": "required",
  "inputText": "Optional input text",
  "approvalId": "Optional approval ID"
}
```

### Provide Input

```
POST /api/tasks/:taskId/input
```

**Request body:**
```json
{
  "inputText": "User-provided input",
  "runId": "Optional; auto-selects latest WaitingForInput run"
}
```

### Send Message

```
POST /api/tasks/:taskId/message
```

**Request body:**
```json
{
  "message": "Add data visualization section",
  "runId": "Optional; auto-selects latest active run"
}
```

### Mark Done

```
POST /api/tasks/:taskId/done
```

### Reopen

```
POST /api/tasks/:taskId/reopen
```

### Accept Task Result

```
POST /api/tasks/:taskId/result/accept
```

### Create Follow-Up Task

```
POST /api/tasks/:taskId/follow-up
```

**Request body:**
```json
{
  "title": "Follow-up title",
  "priority": "Medium",
  "dueAt": "2025-01-25T00:00:00Z"
}
```

---

## Subtasks `/api/tasks/:taskId/subtasks`

### List Subtasks

```
GET /api/tasks/:taskId/subtasks
```

**Response 200:**
```json
{
  "subtasks": [
    { "id": "...", "title": "...", "parentTaskId": "...", ... }
  ],
  "count": 3
}
```

### Create Subtask

```
POST /api/tasks/:taskId/subtasks
```

**Request body:**
```json
{
  "title": "Subtask title",
  "description": "Description",
  "priority": "Medium",
  "dueAt": "2025-01-18T00:00:00Z"
}
```

---

## Task Plan `/api/tasks/:taskId/plan`

### Plan State

```
GET /api/tasks/:taskId/plan-state
```

Returns current plan generation status and the latest saved plan graph.

**Response 200:**
```json
{
  "taskId": "cm...",
  "aiPlanGenerationStatus": "idle" | "generating" | "waiting_acceptance" | "accepted",
  "savedAiPlan": { "id": "...", "status": "draft", "plan": { "nodes": [...], "edges": [...] } }
}
```

### Edit Plan (patch operations)

```
POST /api/tasks/:taskId/plan
```

Supports granular plan graph mutations through operations:

| Operation | Payload | Description |
|-----------|---------|-------------|
| `add_node` | `nodes[]`, `edges[]` | Add new nodes with optional edges |
| `update_node` | `nodePatches[]` | Update node fields (title, objective, status, etc.) |
| `delete_node` | `deletedNodeIds[]` | Remove nodes (edges auto-cleaned) |
| `update_dependencies` | `edges[]` | Add/replace edges between nodes |
| `reorder_nodes` | `reorder[]` | Reorder node display sequence |
| `update_plan_summary` | `summary` | Update plan-level summary text |

```json
{
  "operation": "add_node",
  "nodes": [{ "id": "node-x", "type": "step", "title": "Review", "executionMode": "manual" }],
  "edges": [{ "fromNodeId": "node-a", "toNodeId": "node-x", "type": "sequential" }]
}
```

### Materialize Plan (batch apply)

```
POST /api/ai/batch-apply-plan
```

Converts plan nodes into child tasks. Can provide explicit nodes/edges or use the latest saved plan.

```json
{
  "taskId": "cm...",
  "nodes": [...],
  "edges": [...]
}
```

### Accept Plan

```
POST /api/ai/task-plan/accept
```

```json
{ "taskId": "cm...", "planId": "graph-..." }
```

---

## Schedule `/api/tasks/:taskId/schedule`

### Apply Schedule

```
POST /api/tasks/:taskId/schedule
```

**Request body:**
```json
{
  "scheduledStartAt": "2025-01-15T14:00:00Z",
  "scheduledEndAt": "2025-01-15T15:00:00Z",
  "dueAt": "2025-01-20T00:00:00Z",
  "scheduleSource": "human"
}
```

### Clear Schedule

```
DELETE /api/tasks/:taskId/schedule
```

### Create Schedule Proposal

```
POST /api/tasks/:taskId/schedule/proposals
```

```json
{
  "source": "ai",
  "proposedBy": "scheduler",
  "summary": "Move to afternoon",
  "scheduledStartAt": "2025-01-15T15:00:00Z",
  "scheduledEndAt": "2025-01-15T16:00:00Z",
  "dueAt": "2025-01-20T00:00:00Z",
  "assigneeAgentId": null
}
```

### Resolve Schedule Proposal

```
POST /api/schedule/proposals/decision
```

```json
{
  "proposalId": "sp_...",
  "decision": "Accepted" | "Rejected",
  "resolutionNote": "Optional note"
}
```

---

## Approvals `/api/approvals`

### Resolve Approval

```
POST /api/approvals/:approvalId/resolve
```

Alternative path:

```
POST /api/tasks/:taskId/approvals/:approvalId/resolve
```

**Request body:**
```json
{
  "decision": "Approved" | "Rejected" | "EditedAndApproved",
  "resolutionNote": "Optional note",
  "editedContent": "Optional edited content"
}
```

---

## Memory `/api/memories`

### Invalidate Memory

```
POST /api/memories/:memoryId/invalidate
```

---

## Workspaces `/api/workspaces`

### Get Default Workspace

```
GET /api/workspaces/default
```

### List Workspaces

```
GET /api/workspaces
```

### Get Workspace Overview

```
GET /api/workspaces/:workspaceId/overview
```

Returns tasks grouped by status, counts, and workspace metadata.

---

## Projections `/api/{page}/projection`

### Schedule Projection

```
GET /api/schedule/projection?workspaceId={id}
```

Returns `SchedulePageData` with scheduled/unscheduled/at-risk tasks, conflict analysis, and automation candidates.

### Inbox Projection

```
GET /api/inbox/projection?workspaceId={id}
```

Returns pending approvals, schedule proposals, and suggestions.

### Memory Projection

```
GET /api/memory/projection?workspaceId={id}
```

Returns memory entries grouped by scope and status.

### Work Projection

```
GET /api/work/:taskId/projection
```

Returns `WorkPageData` with task details, runs, plan graph, conversation entries, and artifacts.

---

## AI Endpoints `/api/ai`

### AI Clients `/api/ai/clients`

Configure and manage AI backends (LLM providers, OpenClaw gateways).

```
GET    /api/ai/clients                     List all AI clients
POST   /api/ai/clients                     Create a new AI client
GET    /api/ai/clients/:clientId           Get client details (with feature bindings)
PATCH  /api/ai/clients/:clientId           Update client (name, config, enabled, isDefault)
DELETE /api/ai/clients/:clientId           Delete client
```

**Create client body:**
```json
{
  "name": "My Claude",
  "type": "llm" | "openclaw",
  "config": { "apiKey": "...", "baseUrl": "..." },
  "isDefault": true
}
```

### Test Client

```
POST /api/ai/clients/test
```

```json
{ "type": "openclaw", "config": { "gatewayUrl": "...", "gatewayToken": "..." } }
```

**Response:**
```json
{ "ok": true, "available": true, "reason": "Gateway is reachable" }
```

### Feature Bindings

```
GET /api/ai/clients/:clientId/bindings       List bound features
PUT /api/ai/clients/:clientId/bindings       Update bindings
```

```json
{ "features": ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] }
```

### Generate Task Plan

```
POST /api/ai/generate-task-plan
```

**Request body (task mode):**
```json
{
  "taskId": "cm...",
  "planningPrompt": "Optional custom prompt",
  "forceRefresh": false
}
```

**Request body (adhoc mode):**
```json
{
  "title": "Prepare quarterly report",
  "description": "Includes sales, ops, financial",
  "estimatedMinutes": 120
}
```

For streaming responses, set `Accept: text/event-stream`. SSE events: `status`, `tool_call`, `tool_result`, `partial`, `result`, `error`, `done`.

**Response (non-streaming):**
```json
{
  "source": "openclaw" | "llm",
  "planGraph": { "nodes": [...], "edges": [...], "status": "draft", "summary": "..." },
  "savedPlan": { "id": "graph-...", "status": "draft", "summary": "..." },
  "reasoning": "..."
}
```

### Stop Plan Generation

```
POST /api/ai/generate-task-plan/stop
```

```json
{ "taskId": "cm..." }
```

### Suggest Timeslot

```
POST /api/ai/suggest-timeslot
```

```json
{ "workspaceId": "default", "taskId": "cm...", "date": "2025-01-15" }
```

### Suggest Automation

```
POST /api/ai/suggest-automation
```

```json
{ "taskId": "cm..." }
```

Also supports adhoc mode with `title`, `description`, `priority`, etc.

### Analyze Conflicts

```
POST /api/ai/analyze-conflicts
```

```json
{ "workspaceId": "default", "date": "2025-01-15" }
```

**Response 200:**
```json
{
  "conflicts": [
    {
      "type": "time_overlap",
      "severity": "high",
      "description": "Task A and Task B overlap at 14:00-15:00",
      "involvedTaskIds": ["cm1...", "cm2..."]
    }
  ],
  "suggestions": [...]
}
```

### Auto-Complete (streaming)

```
POST /api/ai/auto-complete
```

```json
{ "title": "Analyze", "workspaceId": "default" }
```

Returns SSE stream. Suggests task completions from partial input. Falls back to keyword rule engine when AI is unavailable.

### Apply Suggestion

```
POST /api/ai/apply-suggestion
```

```json
{
  "workspaceId": "default",
  "suggestion": {
    "id": "sug_...",
    "summary": "...",
    "action": {
      "type": "create_task",
      "title": "New task",
      "description": "...",
      "priority": "Medium",
      "estimatedMinutes": 60,
      "scheduledStartAt": "2025-01-15T14:00:00Z",
      "scheduledEndAt": "2025-01-15T15:00:00Z"
    }
  }
}
```

Also supports batch mode with `changes[]` array.

### Dispatch Task (dry-run)

```
POST /api/ai/dispatch-task
```

```json
{ "taskId": "cm...", "workspaceId": "default" }
```

Returns preview of the next action that would be taken for the task.

### Task Workspace Chat

```
POST /api/ai/task-workspace/chat
```

Conversational AI assistant for modifying task plans. Returns proposals for plan changes.

```json
{
  "taskId": "cm...",
  "message": "Add a code review step after design",
  "currentTask": { ... },
  "currentPlan": { ... },
  "history": []
}
```

---

## Task Assistant Messages `/api/tasks/:taskId/assistant`

Persistent chat messages in the task workspace, with proposal tracking.

```
GET    /api/tasks/:taskId/assistant/messages                     List messages
POST   /api/tasks/:taskId/assistant/messages                     Save a message
PATCH  /api/tasks/:taskId/assistant/messages/:messageId/apply    Mark proposal applied
```

**POST body:**
```json
{
  "role": "user" | "assistant",
  "content": "Message text",
  "proposal": { ... }
}
```

---

## Error Handling

All APIs return a standard error format:

```json
{
  "error": "Error description",
  "code": "ERROR_CODE"
}
```

| Status | Description |
|--------|-------------|
| 400 | Invalid request parameters |
| 404 | Resource not found |
| 409 | State conflict (e.g. plan generation already in flight) |
| 500 | Internal server error |
