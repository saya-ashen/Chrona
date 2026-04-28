# API Reference

> **Base URL:** `http://localhost:3101/api`
> **Content-Type:** `application/json`
> **Auth:** optional `Authorization: Bearer <token>` header (set via `API_KEY` env var)
> **Streaming:** endpoints marked with ⚡ return SSE when `Accept: text/event-stream` is set

---

## Table of Contents

1. [Conventions](#conventions)
2. [Health](#health)
3. [Tasks](#tasks)
4. [Runs & Execution](#runs--execution)
5. [Task Plans](#task-plans)
6. [Schedule](#schedule)
7. [Approvals](#approvals)
8. [Memory](#memory)
9. [Workspaces](#workspaces)
10. [Projections](#projections)
11. [AI Features](#ai-features)
12. [Assistant Messages](#assistant-messages)
13. [Error Codes](#error-codes)

---

## Conventions

### Authentication

No authentication is required by default. Set `API_KEY` in your environment or `~/.config/chrona/.env` to enforce Bearer token auth on all endpoints.

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:3101/api/tasks
```

### Response Envelope

Successful responses return data directly or in a wrapper:

```json
// List endpoints
{ "tasks": [...], "count": 15 }

// Detail endpoints
{ "id": "cm...", "title": "...", ... }

// Action endpoints
{ "success": true, "taskId": "cm..." }
```

### Error Format

```json
{ "error": "Human-readable description", "code": "ERROR_CODE" }
```

### Dates

All timestamps use ISO 8601 format: `2025-01-15T14:00:00Z`.

---

## Health

```bash
GET /api/health
```

**Response `200`**

```json
{ "status": "ok" }
```

---

## Tasks

### List Tasks

```bash
GET /api/tasks?workspaceId=default&status=Ready&limit=20
```

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `workspaceId` | string | ✅ | — | Workspace ID |
| `status` | TaskStatus | — | all | Filter by status |
| `limit` | number | — | 50 (max 200) | Result count |

```json
// Response 200
{
  "tasks": [
    {
      "id": "cm_abc123",
      "workspaceId": "default",
      "title": "Analyze user data",
      "status": "Ready",
      "priority": "High",
      "scheduledStartAt": null,
      "scheduledEndAt": null
    }
  ],
  "count": 1
}
```

### Create Task

```bash
POST /api/tasks
Content-Type: application/json

{
  "workspaceId": "default",
  "title": "Analyze user behavior data",
  "description": "Analyze 30 days of data using Python",
  "priority": "High",
  "dueAt": "2025-01-20T00:00:00Z",
  "runtimeAdapterKey": "openclaw",
  "runtimeModel": "gpt-4o",
  "prompt": "Analyze user behavior data and generate a report",
  "runtimeConfig": "{\"maxTokens\": 4096}"
}
```

```bash
# Minimal create
curl -s http://localhost:3101/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "default", "title": "Quick task"}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceId` | string | ✅ | Workspace ID |
| `title` | string | ✅ | Task title |
| `description` | string | — | Description |
| `priority` | `Low\|Medium\|High\|Urgent` | — | Priority (default: `Medium`) |
| `dueAt` | ISO datetime | — | Due date |
| `runtimeAdapterKey` | string | — | Runtime adapter (e.g. `openclaw`) |
| `runtimeInput` | string (JSON) | — | Runtime input data |
| `runtimeInputVersion` | string | — | Input version tag |
| `runtimeModel` | string | — | AI model name |
| `prompt` | string | — | Execution prompt for the agent |
| `runtimeConfig` | string (JSON) | — | Additional runtime config |

**Response `201`** — Created task object.

### Get Task

```bash
GET /api/tasks/:taskId
```

Returns the task with its latest 5 runs and projection data.

### Get Task Detail (full page data)

```bash
GET /api/tasks/:taskId/detail
```

Returns complete task page payload: task data, plan graph, subtasks, runs, projection, and related workspace info.

### Update Task

```bash
PATCH /api/tasks/:taskId
Content-Type: application/json

{ "title": "Updated title", "priority": "Urgent" }
```

All create fields are accepted; any field not provided is left unchanged (partial update).

### Delete Task

```bash
DELETE /api/tasks/:taskId
```

Cascading delete — removes task, subtasks, all runs, sessions, approvals, artifacts, events, projections, and conversation history.

```json
// Response 200
{ "success": true, "taskId": "cm_abc123" }
```

---

## Runs & Execution

### Start Run

```bash
POST /api/tasks/:taskId/run
Content-Type: application/json

{ "prompt": "Override the default execution prompt" }
```

Launches an AI agent run on the task using its configured runtime adapter.

### Retry Run

```bash
POST /api/tasks/:taskId/retry
Content-Type: application/json

{ "prompt": "Retry with this prompt" }
```

Retries the most recent failed or completed run.

### Resume Run

```bash
POST /api/tasks/:taskId/resume
Content-Type: application/json

{
  "runId": "cm_run123",
  "inputText": "Here is the data you asked for",
  "approvalId": "appr_456"
}
```

Resumes a paused run (WaitingForInput or WaitingForApproval).

### Provide Mid-Run Input

```bash
POST /api/tasks/:taskId/input
Content-Type: application/json

{ "inputText": "The answer is 42", "runId": "cm_run123" }
```

Sends input to the agent while it's waiting. If `runId` is omitted, the latest `WaitingForInput` run is auto-selected.

### Send Message During Run

```bash
POST /api/tasks/:taskId/message
Content-Type: application/json

{ "message": "Add a visualization section", "runId": "cm_run123" }
```

Sends an operator message to the running agent.

### Mark Task Done

```bash
POST /api/tasks/:taskId/done
```

Closes a completed task.

### Reopen Task

```bash
POST /api/tasks/:taskId/reopen
```

Reopens a done or cancelled task.

### Accept Task Result

```bash
POST /api/tasks/:taskId/result/accept
```

Accepts the final delivery of a completed run.

### Create Follow-Up Task

```bash
POST /api/tasks/:taskId/follow-up
Content-Type: application/json

{ "title": "Follow-up analysis", "priority": "Medium", "dueAt": "2025-01-25T00:00:00Z" }
```

Creates a new task linked to the current one as a follow-up.

---

## Task Plans

### Get Plan State

```bash
GET /api/tasks/:taskId/plan-state
```

```json
// Response 200
{
  "taskId": "cm_abc123",
  "aiPlanGenerationStatus": "accepted",
  "savedAiPlan": {
    "id": "graph_xyz",
    "status": "accepted",
    "plan": {
      "nodes": [
        { "id": "n1", "type": "step", "title": "Collect data", "executionMode": "auto", "status": "pending", "order": 0 },
        { "id": "n2", "type": "step", "title": "Analyze trends", "executionMode": "auto", "status": "pending", "order": 1 }
      ],
      "edges": [
        { "id": "e1", "fromNodeId": "n1", "toNodeId": "n2", "type": "sequential" }
      ]
    }
  }
}
```

`aiPlanGenerationStatus`: `idle` | `generating` | `waiting_acceptance` | `accepted`

### Edit Plan (patch operations)

```bash
POST /api/tasks/:taskId/plan
Content-Type: application/json

{
  "operation": "add_node",
  "nodes": [
    { "id": "n3", "type": "checkpoint", "title": "Validate results", "executionMode": "manual" }
  ],
  "edges": [
    { "fromNodeId": "n2", "toNodeId": "n3", "type": "sequential" }
  ]
}
```

| Operation | Payload | Effect |
|-----------|---------|--------|
| `add_node` | `nodes[]`, `edges[]` | Add nodes with optional connecting edges |
| `update_node` | `nodePatches[]` | Update node fields (title, objective, status, executionMode) |
| `delete_node` | `deletedNodeIds[]` | Remove nodes (connected edges auto-cleaned) |
| `update_dependencies` | `edges[]` | Add or replace edges between nodes |
| `reorder_nodes` | `reorder[]` | Change node display sequence |
| `update_plan_summary` | `summary` | Update plan-level summary text |

### Materialize Plan

```bash
POST /api/ai/batch-apply-plan
Content-Type: application/json

{ "taskId": "cm_abc123", "nodes": [...], "edges": [...] }
```

Converts plan nodes into real child tasks. If nodes/edges are omitted, the latest saved plan is used.

### Accept AI-Generated Plan

```bash
POST /api/ai/task-plan/accept
Content-Type: application/json

{ "taskId": "cm_abc123", "planId": "graph_xyz" }
```

Promotes a draft AI plan to accepted status.

---

## Schedule

### Apply Schedule

```bash
POST /api/tasks/:taskId/schedule
Content-Type: application/json

{
  "scheduledStartAt": "2025-01-15T14:00:00Z",
  "scheduledEndAt": "2025-01-15T15:00:00Z",
  "dueAt": "2025-01-20T00:00:00Z",
  "scheduleSource": "human"
}
```

Sets or updates a task's time window.

### Clear Schedule

```bash
DELETE /api/tasks/:taskId/schedule
```

Removes the schedule from a task (back to `Unscheduled`).

### Create Schedule Proposal

```bash
POST /api/tasks/:taskId/schedule/proposals
Content-Type: application/json

{
  "source": "ai",
  "proposedBy": "scheduler",
  "summary": "Move to afternoon for better focus time",
  "scheduledStartAt": "2025-01-15T15:00:00Z",
  "scheduledEndAt": "2025-01-15T16:00:00Z",
  "dueAt": "2025-01-20T00:00:00Z"
}
```

### Resolve Schedule Proposal

```bash
POST /api/schedule/proposals/decision
Content-Type: application/json

{ "proposalId": "sp_xyz", "decision": "Accepted", "resolutionNote": "Looks good" }
```

---

## Approvals

### Resolve Approval

Two equivalent paths:

```bash
POST /api/approvals/:approvalId/resolve
POST /api/tasks/:taskId/approvals/:approvalId/resolve
```

```json
{
  "decision": "Approved",
  "resolutionNote": "Proceed with the suggested changes",
  "editedContent": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | `Approved\|Rejected\|EditedAndApproved` | ✅ | Decision |
| `resolutionNote` | string | — | Optional note |
| `editedContent` | string | — | Edited content (for `EditedAndApproved`) |

---

## Memory

### Invalidate Memory

```bash
POST /api/memories/:memoryId/invalidate
```

Marks a memory entry as invalid.

---

## Workspaces

### Get Default Workspace

```bash
GET /api/workspaces/default
```

### List Workspaces

```bash
GET /api/workspaces
```

### Get Workspace Overview

```bash
GET /api/workspaces/:workspaceId/overview
```

Returns tasks grouped by status, counts, and workspace metadata.

---

## Projections

Materialized views for UI pages — each returns pre-computed page data.

```bash
GET /api/schedule/projection?workspaceId=default               # SchedulePageData
GET /api/inbox/projection?workspaceId=default                  # InboxPageData
GET /api/memory/projection?workspaceId=default                 # MemoryPageData
GET /api/work/:taskId/projection                               # WorkPageData
```

| Projection | Contents |
|------------|----------|
| **Schedule** | Scheduled/unscheduled/at-risk tasks, conflict analysis, automation candidates, focus zones |
| **Inbox** | Pending approvals, schedule proposals, AI suggestions |
| **Memory** | Memory entries grouped by scope and status |
| **Work** | Task details, all runs, plan graph, conversation entries, artifacts |

---

## AI Features

### AI Clients CRUD

```bash
GET    /api/ai/clients                           # List all clients
POST   /api/ai/clients                           # Create client
GET    /api/ai/clients/:clientId                 # Get client with bindings
PATCH  /api/ai/clients/:clientId                 # Update client
DELETE /api/ai/clients/:clientId                 # Delete client
```

```bash
# Create an LLM client
curl -s http://localhost:3101/api/ai/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Claude",
    "type": "llm",
    "config": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.openai.com/v1",
      "model": "claude-sonnet-4-20250514"
    },
    "isDefault": true
  }'
```

```bash
# Create an OpenClaw client
curl -s http://localhost:3101/api/ai/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenClaw Gateway",
    "type": "openclaw",
    "config": {
      "gatewayUrl": "http://localhost:18789",
      "gatewayToken": "your-token"
    }
  }'
```

### Test AI Client Connectivity

```bash
POST /api/ai/clients/test
Content-Type: application/json

{ "type": "openclaw", "config": { "gatewayUrl": "http://localhost:18789", "gatewayToken": "..." } }
```

```json
// Response 200
{ "ok": true, "available": true, "reason": "Gateway is reachable" }
```

### Feature Bindings

```bash
GET /api/ai/clients/:clientId/bindings         # List bound features
PUT /api/ai/clients/:clientId/bindings         # Set bindings
```

```json
{ "features": ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] }
```

Each feature can be bound to exactly one client. Features:

| Feature | What it powers |
|---------|---------------|
| `suggest` | Task suggestions, auto-complete |
| `generate_plan` | AI plan generation (streaming) |
| `decompose` | Task decomposition into subtasks |
| `conflicts` | Schedule conflict analysis |
| `timeslots` | AI timeslot recommendations |
| `chat` | Task workspace assistant chat |

### ⚡ Generate Task Plan

```bash
POST /api/ai/generate-task-plan
Content-Type: application/json
Accept: text/event-stream
```

```bash
# Task mode — generate plan for existing task
curl -N http://localhost:3101/api/ai/generate-task-plan \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"taskId": "cm_abc123"}'

# Adhoc mode — generate plan from free text
curl -N http://localhost:3101/api/ai/generate-task-plan \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"title": "Prepare quarterly report", "description": "Includes sales, ops, financial", "estimatedMinutes": 120}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | task mode | Existing task ID |
| `title` | string | adhoc mode | Task title |
| `description` | string | — | Task description |
| `estimatedMinutes` | number | — | Time estimate |
| `planningPrompt` | string | — | Custom prompt override |
| `forceRefresh` | boolean | — | Regenerate even if plan exists |

**SSE events:** `status` · `tool_call` · `tool_result` · `partial` · `result` · `error` · `done`

```json
// Non-streaming response 200
{
  "source": "openclaw",
  "planGraph": {
    "nodes": [...],
    "edges": [...],
    "status": "draft",
    "summary": "4-step plan for data analysis"
  },
  "savedPlan": { "id": "graph_xyz", "status": "draft" },
  "reasoning": "This task breaks down into..."
}
```

### Stop Plan Generation

```bash
POST /api/ai/generate-task-plan/stop
Content-Type: application/json

{ "taskId": "cm_abc123" }
```

### ⚡ AI Suggest Timeslot

```bash
POST /api/ai/suggest-timeslot
Content-Type: application/json

{ "workspaceId": "default", "taskId": "cm_abc123", "date": "2025-01-15" }
```

Returns suggested time windows for the task on the given date.

### ⚡ Suggest Automation

```bash
POST /api/ai/suggest-automation
Content-Type: application/json

{ "taskId": "cm_abc123" }
```

```bash
# Adhoc mode
curl -s http://localhost:3101/api/ai/suggest-automation \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login bug", "description": "Users report 500 error on login", "priority": "Urgent"}'
```

### Analyze Schedule Conflicts

```bash
POST /api/ai/analyze-conflicts
Content-Type: application/json

{ "workspaceId": "default", "date": "2025-01-15" }
```

```json
// Response 200
{
  "conflicts": [
    {
      "type": "time_overlap",
      "severity": "high",
      "description": "Task A and Task B overlap at 14:00-15:00",
      "involvedTaskIds": ["cm_a", "cm_b"]
    }
  ],
  "suggestions": [
    { "type": "reschedule", "taskId": "cm_b", "suggestedStartAt": "..." }
  ]
}
```

### ⚡ Auto-Complete

```bash
POST /api/ai/auto-complete
Content-Type: application/json
Accept: text/event-stream

{ "title": "Analyze", "workspaceId": "default" }
```

Streams task completion suggestions from partial input. Falls back to keyword rule engine when AI is unavailable.

### Apply Suggestion

```bash
POST /api/ai/apply-suggestion
Content-Type: application/json

{
  "workspaceId": "default",
  "suggestion": {
    "id": "sug_xyz",
    "summary": "Create a new analysis task",
    "action": {
      "type": "create_task",
      "title": "Analyze user behavior data",
      "description": "30-day analysis using Python",
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

```bash
POST /api/ai/dispatch-task
Content-Type: application/json

{ "taskId": "cm_abc123", "workspaceId": "default" }
```

Returns a preview of the next action that would be taken for the task without executing it.

### ⚡ Task Workspace Chat

```bash
POST /api/ai/task-workspace/chat
Content-Type: application/json

{
  "taskId": "cm_abc123",
  "message": "Add a code review step after the design phase",
  "currentTask": { ... },
  "currentPlan": { ... },
  "history": []
}
```

Conversational AI assistant for modifying task plans. Returns proposals that the user can accept to update the plan.

---

## Assistant Messages

Persistent chat history in the task workspace, with proposal tracking:

```bash
GET    /api/tasks/:taskId/assistant/messages                        # List messages
POST   /api/tasks/:taskId/assistant/messages                        # Save message
PATCH  /api/tasks/:taskId/assistant/messages/:messageId/apply       # Mark proposal applied
```

```bash
# Save a user message
curl -s http://localhost:3101/api/tasks/cm_abc123/assistant/messages \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "Can you review the plan?"}'
```

```bash
# Apply an AI proposal
curl -s -X PATCH http://localhost:3101/api/tasks/cm_abc123/assistant/messages/msg_1/apply \
  -H "Content-Type: application/json"
```

```json
// POST body
{
  "role": "user",
  "content": "Add a review step",
  "proposal": {
    "type": "plan_update",
    "nodes": [...],
    "edges": [...]
  }
}
```

---

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_PARAMS` | Missing or malformed request parameters |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `STATE_CONFLICT` | Operation conflicts with current state (e.g. plan generation already in flight) |
| 500 | `INTERNAL_ERROR` | Unhandled server error |
| 503 | `AI_UNAVAILABLE` | AI backend unreachable or not configured |

### Example error response

```json
{
  "error": "Plan generation is already in progress for this task",
  "code": "STATE_CONFLICT"
}
```

---

## Quick Reference: All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/tasks` | List tasks |
| `POST` | `/api/tasks` | Create task |
| `GET` | `/api/tasks/:taskId` | Get task |
| `GET` | `/api/tasks/:taskId/detail` | Get task detail (full page) |
| `PATCH` | `/api/tasks/:taskId` | Update task |
| `DELETE` | `/api/tasks/:taskId` | Delete task (cascade) |
| `POST` | `/api/tasks/:taskId/run` | Start run |
| `POST` | `/api/tasks/:taskId/retry` | Retry run |
| `POST` | `/api/tasks/:taskId/resume` | Resume run |
| `POST` | `/api/tasks/:taskId/input` | Provide mid-run input |
| `POST` | `/api/tasks/:taskId/message` | Send message during run |
| `POST` | `/api/tasks/:taskId/done` | Mark task done |
| `POST` | `/api/tasks/:taskId/reopen` | Reopen task |
| `POST` | `/api/tasks/:taskId/result/accept` | Accept result |
| `POST` | `/api/tasks/:taskId/follow-up` | Create follow-up |
| `GET` | `/api/tasks/:taskId/subtasks` | List subtasks |
| `POST` | `/api/tasks/:taskId/subtasks` | Create subtask |
| `GET` | `/api/tasks/:taskId/plan-state` | Get plan state |
| `POST` | `/api/tasks/:taskId/plan` | Edit plan (patch ops) |
| `POST` | `/api/tasks/:taskId/schedule` | Apply schedule |
| `DELETE` | `/api/tasks/:taskId/schedule` | Clear schedule |
| `POST` | `/api/tasks/:taskId/schedule/proposals` | Create schedule proposal |
| `POST` | `/api/schedule/proposals/decision` | Resolve proposal |
| `POST` | `/api/approvals/:id/resolve` | Resolve approval |
| `POST` | `/api/memories/:id/invalidate` | Invalidate memory |
| `GET` | `/api/workspaces/default` | Get default workspace |
| `GET` | `/api/workspaces` | List workspaces |
| `GET` | `/api/workspaces/:id/overview` | Get workspace overview |
| `GET` | `/api/schedule/projection` | Schedule page data |
| `GET` | `/api/inbox/projection` | Inbox page data |
| `GET` | `/api/memory/projection` | Memory page data |
| `GET` | `/api/work/:taskId/projection` | Work page data |
| `GET` | `/api/ai/clients` | List AI clients |
| `POST` | `/api/ai/clients` | Create AI client |
| `GET` | `/api/ai/clients/:id` | Get AI client |
| `PATCH` | `/api/ai/clients/:id` | Update AI client |
| `DELETE` | `/api/ai/clients/:id` | Delete AI client |
| `POST` | `/api/ai/clients/test` | Test AI client |
| `GET` | `/api/ai/clients/:id/bindings` | Get feature bindings |
| `PUT` | `/api/ai/clients/:id/bindings` | Set feature bindings |
| `POST` | `/api/ai/generate-task-plan` | Generate plan ⚡ |
| `POST` | `/api/ai/generate-task-plan/stop` | Stop plan generation |
| `POST` | `/api/ai/task-plan/accept` | Accept plan |
| `POST` | `/api/ai/batch-apply-plan` | Materialize plan |
| `POST` | `/api/ai/suggest-timeslot` | Suggest timeslot |
| `POST` | `/api/ai/suggest-automation` | Suggest automation |
| `POST` | `/api/ai/analyze-conflicts` | Analyze conflicts |
| `POST` | `/api/ai/auto-complete` | Auto-complete task |
| `POST` | `/api/ai/apply-suggestion` | Apply AI suggestion |
| `POST` | `/api/ai/dispatch-task` | Dispatch task (dry-run) |
| `POST` | `/api/ai/task-workspace/chat` | Task workspace chat ⚡ |
| `GET` | `/api/tasks/:taskId/assistant/messages` | List assistant messages |
| `POST` | `/api/tasks/:taskId/assistant/messages` | Save assistant message |
| `PATCH` | `/api/tasks/:taskId/assistant/messages/:msgId/apply` | Apply proposal |
