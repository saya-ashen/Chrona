# API Reference

Chrona uses an independent local Hono API server for all business APIs. The frontend SPA proxies `/api/*` through Vite in development; in production, the same local server hosts both static assets and APIs.

No authentication is required by default.

## Task Management `/api/tasks`

### List Tasks

```
GET /api/tasks?workspaceId={id}&status={status}&limit={n}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| workspaceId | string | Yes | Workspace ID |
| status | TaskStatus | No | Status filter |
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
  "prompt": "Analyze user behavior data and generate a report"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workspaceId | string | Yes | Workspace ID |
| title | string | Yes | Task title |
| description | string | No | Description |
| priority | TaskPriority | No | Low/Medium/High/Urgent |
| dueAt | ISO DateTime | No | Due date |
| runtimeAdapterKey | string | No | Runtime adapter (e.g. "openclaw") |
| runtimeInput | string | No | Runtime input (JSON) |
| runtimeInputVersion | string | No | Input version |
| runtimeModel | string | No | AI model name |
| prompt | string | No | Execution prompt |
| runtimeConfig | string | No | Additional config (JSON) |

**Response 201:**
```json
{ "taskId": "cm...", ... }
```

### Get Task

```
GET /api/tasks/{taskId}
```

**Response 200:**
```json
{
  "task": {
    "id": "cm...",
    "title": "...",
    "status": "Running",
    "projection": { "displayState": "Running", ... },
    "runs": [{ "id": "...", "status": "Running", ... }]
  }
}
```

### Update Task

```
PATCH /api/tasks/{taskId}
Content-Type: application/json
```

**Request body:** Same fields as create, all optional. Partial updates supported.

**Response 200:** Updated task.

### Delete Task

```
DELETE /api/tasks/{taskId}
```

**Behavior:** Cascades to all related data (runs, sessions, approvals, artifacts, events, projections).

**Response 200:**
```json
{ "success": true, "taskId": "cm..." }
```

---

## Task Operations

### Start Run

```
POST /api/tasks/{taskId}/run
```

**Request body:**
```json
{ "prompt": "Optional prompt override" }
```

**Response 201:** Run result.

**Precondition:** Task must be runnable (has runtimeAdapterKey and prompt).

### Mark Done

```
POST /api/tasks/{taskId}/done
```

### Reopen

```
POST /api/tasks/{taskId}/reopen
```

### Send Message

```
POST /api/tasks/{taskId}/message
```

**Request body:**
```json
{
  "message": "Add data visualization section",
  "runId": "Optional; auto-selects latest active run if omitted"
}
```

### Provide Input

```
POST /api/tasks/{taskId}/input
```

**Request body:**
```json
{
  "inputText": "User-provided input",
  "runId": "Optional"
}
```

### Generate Plan

```
POST /api/tasks/{taskId}/plan
```

**Response:** Generated execution plan.

### Apply Schedule

```
POST /api/tasks/{taskId}/schedule
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
DELETE /api/tasks/{taskId}/schedule
```

### List Subtasks

```
GET /api/tasks/{taskId}/subtasks
```

**Response 200:**
```json
{ "subtasks": [...], "count": 3 }
```

### Create Subtask

```
POST /api/tasks/{taskId}/subtasks
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

## AI Endpoints `/api/ai`

### Decompose Task

```
POST /api/ai/decompose-task
```

**Request body (two modes):**

```json
// Mode 1: from existing task
{ "taskId": "cm..." }

// Mode 2: from ad-hoc data
{
  "title": "Prepare quarterly report",
  "description": "Includes sales, operations, financial data",
  "priority": "High",
  "estimatedMinutes": 120
}
```

**Response 200:**
```json
{
  "subtasks": [
    { "title": "Collect sales data", "estimatedMinutes": 30, "priority": "High" },
    { "title": "Write operations analysis", "estimatedMinutes": 45, "priority": "Medium" }
  ],
  "totalEstimatedMinutes": 120,
  "feasibilityScore": 0.85
}
```

### Batch Decompose (decompose + create)

```
POST /api/ai/batch-decompose
```

**Request body:**
```json
{ "taskId": "cm..." }
```

**Response 201:**
```json
{
  "parentTaskId": "cm...",
  "subtasks": [{ "id": "cm...", "title": "..." }],
  "decomposition": {
    "totalEstimatedMinutes": 120,
    "feasibilityScore": 0.85,
    "warnings": []
  }
}
```

### Auto-Complete

```
POST /api/ai/auto-complete
```

**Request body:**
```json
{
  "title": "Analyze",
  "workspaceId": "default"
}
```

**Response 200:**
```json
{
  "suggestions": [
    {
      "title": "Analyze user behavior data",
      "description": "Use data analysis tools to process user behavior logs",
      "priority": "Medium",
      "estimatedMinutes": 60
    }
  ],
  "source": "openclaw"
}
```

**Priority chain:** OpenClaw CLI Bridge → Direct LLM → Chinese keyword rule engine

### Suggest Automation

```
POST /api/ai/suggest-automation
```

**Request body:**
```json
{ "taskId": "cm..." }
```

### Suggest Timeslot

```
POST /api/ai/suggest-timeslot
```

**Request body:**
```json
{
  "workspaceId": "default",
  "taskId": "cm...",
  "date": "2025-01-15"
}
```

### Analyze Conflicts

```
POST /api/ai/analyze-conflicts
```

**Request body:**
```json
{
  "workspaceId": "default",
  "date": "2025-01-15"
}
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
  "suggestions": [
    {
      "type": "reschedule",
      "description": "Move Task B to 15:00-16:00",
      "changes": [...]
    }
  ]
}
```

### Apply Suggestion

```
POST /api/ai/apply-suggestion
```

**Request body:**
```json
{
  "workspaceId": "default",
  "suggestionId": "sug_...",
  "changes": [
    {
      "taskId": "cm...",
      "field": "scheduledStartAt",
      "value": "2025-01-15T15:00:00Z"
    }
  ]
}
```

### Tool Call (for OpenClaw plugin)

```
POST /api/ai/suggest-tool-call
```

**Request body:**
```json
{
  "tool_name": "schedule.list_tasks",
  "arguments": { "workspace_id": "default" },
  "request_id": "req_123"
}
```

**Available tools:**
- `schedule.list_tasks` — List tasks
- `schedule.get_health` — Get schedule health
- `schedule.check_conflicts` — Check conflicts

---

## Projection/Page Data `/api/{page}/projection`

### Schedule Projection

```
GET /api/schedule/projection?workspaceId={id}
```

Returns `SchedulePageData`.

### Work Projection

```
GET /api/work/{taskId}/projection
```

Returns `WorkPageData`.

### Inbox Projection

```
GET /api/inbox/projection?workspaceId={id}
```

### Memory Projection

```
GET /api/memory/projection?workspaceId={id}
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
| 409 | State conflict (e.g. task already done cannot be marked done again) |
| 500 | Internal server error |
