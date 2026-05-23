# Chrona API Reference

Base URL: `http://localhost:3101/api`

- Content type: `application/json` unless the endpoint is an SSE stream.
- Auth: optional `Authorization: Bearer <token>` when `API_KEY` is configured.
- Default bind: `127.0.0.1`. Use `HOST=0.0.0.0` only intentionally and protect it with `API_KEY`; unsafe public bind without `API_KEY` requires `CHRONA_UNSAFE_PUBLIC_BIND=1`.
- IDs shown here are examples. Agents should use AI-visible refs from MCP tool results, not backend IDs.

## Health

### GET /api/health

Returns server health.

```sh
curl http://localhost:3101/api/health
```

## Tasks

### GET /api/tasks

Query parameters:

| Name | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | Workspace scope |
| `status` | no | Filter by task status |
| `limit` | no | Limit result count |

### POST /api/tasks

Creates a task. Important fields include `workspaceId`, `title`, `description`, `priority`, `executionRuntime`, `executionConfig`, and `parentTaskId`.

### GET /api/tasks/:taskId

Returns full task detail data.

### PATCH /api/tasks/:taskId

Partially updates a task.

### DELETE /api/tasks/:taskId?workspaceId=...

Deletes a task and related task data.

## Task lifecycle and result

### POST /api/tasks/:taskId/complete

Marks a task complete.

### POST /api/tasks/:taskId/reopen

Reopens a completed task.

### POST /api/tasks/:taskId/result/accept

Accepts the current task result.

## Task plan

### GET /api/tasks/:taskId/plan

Returns the current plan state for a task.

### POST /api/tasks/:taskId/plan/generations

Starts plan generation. With `Accept: text/event-stream`, streams generation progress. Without SSE, returns the generated result as JSON.

Request fields:

| Field | Required | Notes |
| --- | --- | --- |
| `forceRefresh` | no | Bypass cached or active generation state when allowed |
| `userInstruction` | no | Additional instruction for plan generation |

SSE event types include `status`, `tool_call`, `partial`, `result`, `error`, `cancelled`, `done`, and heartbeat events.

### GET /api/tasks/:taskId/plan/generations/active

Returns metadata for the currently active generation session, if any.

### GET /api/tasks/:taskId/plan/generations/active/events

Subscribes to an active plan generation session over SSE.

### POST /api/tasks/:taskId/plan/generations/stop

Stops an active plan generation session.

### POST /api/tasks/:taskId/plan/accept

Accepts a generated or edited plan.

Request fields:

| Field | Required | Notes |
| --- | --- | --- |
| `planId` | yes | Plan to accept |
| `workspaceId` | no | Optional workspace guard |

### POST /api/tasks/:taskId/plan

Applies plan patch operations. The route accepts the plan patch schema used by the task workspace and Work page. Common operations include adding, deleting, updating, and reordering nodes or edges.

## Task execution

### GET /api/tasks/:taskId/execution/current

Returns the current execution session state and supported actions.

### POST /api/tasks/:taskId/execution/actions

Dispatches an execution action and streams progress over SSE.

Common action values include:

- `start_manual`
- `resume_with_input`
- `resume_with_approval`
- `retry_node`
- `resume_after_unblock`
- `complete_manual_node`
- `fail_current_node`
- `cancel_session`

SSE event types include graph events, runtime events, state updates, result events, and heartbeats.

### POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions

Submits a checkpoint/input/approval action and streams the resulting execution progress over SSE.

Common checkpoint actions include `submit_input`, `approve_result`, `reject_result`, `request_changes`, `accept_replan`, `reject_replan`, `request_replan`, `retry_node`, `resume_after_unblock`, `mark_node_completed`, `mark_node_skipped`, `fail_task`, and `cancel_session`.

## Task schedule

### PUT /api/tasks/:taskId/schedule

Applies a concrete schedule.

Fields include `scheduledStartAt`, `scheduledEndAt`, `dueAt`, and `scheduleSource`.

### DELETE /api/tasks/:taskId/schedule

Clears a task schedule.

### POST /api/tasks/:taskId/schedule/proposals

Creates a schedule proposal for a task.

### POST /api/tasks/schedule-proposals/decision

Accepts or rejects a schedule proposal.

Fields include `proposalId`, `decision`, and optional `resolutionNote`.

## Page projections

These endpoints serve pre-computed UI page data.

### GET /api/schedule?workspaceId=...

Schedule page projection: timeline, work blocks, task summaries, conflicts, and schedule suggestions.

### GET /api/inbox?workspaceId=...

Inbox projection: pending approvals, schedule proposals, waiting inputs, failed/cancelled runs, and attention items.

### GET /api/memory?workspaceId=...

Memory console projection.

### GET /api/work/:taskId

Work page projection for a task: task shell, latest result, plan graph, execution records, metadata, and conversation context.

### POST /api/work/:taskId/commands

Submits a Work page command asynchronously. Command types include plan generation, plan acceptance, execution actions, and checkpoint actions. Returns `202` with a `commandId`; subscribe to Work events for updates.

### GET /api/work/:taskId/events

Subscribes to Work page projection events over SSE.

## Workspaces

### GET /api/workspaces/default

Returns the default workspace.

### GET /api/workspaces

Lists workspaces.

### GET /api/workspaces/:workspaceId/overview

Returns workspace overview stats and recent activity.

## Runtime providers

### GET /api/runtime/providers

Lists execution runtimes available to the current server. `debug` is only returned in development or when explicitly enabled.

## AI clients

### GET /api/ai/clients

Lists configured AI clients and feature bindings.

### POST /api/ai/clients

Creates an AI client.

### PATCH /api/ai/clients/:clientId

Updates an AI client.

### DELETE /api/ai/clients/:clientId

Deletes an AI client.

### POST /api/ai/clients/test

Tests connectivity for a client config.

### PUT /api/ai/clients/:clientId/bindings

Replaces feature bindings for a client. Features include `suggest`, `generate_plan`, `conflicts`, `timeslots`, `chat`, and `dispatch_task`.

## Assistant Surface

### GET /api/assistant-surface?pageType=...

Returns assistant surface state for supported pages such as `schedule`, `task`, and `workbench`.

### POST /api/assistant-surface/actions

Requests an assistant action for the current surface.

## MCP integration

### POST /api/mcp

Streamable HTTP MCP endpoint exposing Chrona tools to external agents.

Public tool names:

| Tool | Purpose |
| --- | --- |
| `chrona_execution_read` | Read execution session state and next actions |
| `chrona_plan_read` | Read accepted plan state through AI-visible refs |
| `chrona_plan_generate` | Generate a draft plan from a complete blueprint |
| `chrona_node_read` | Read the current node through AI-visible refs |
| `chrona_task_complete` | Complete the current task node |
| `chrona_condition_select` | Select the current condition branch by branch ref |
| `chrona_node_block` | Block the current node with a reason and recovery form |
| `chrona_node_fail` | Fail the current node |
| `chrona_wait_complete` | Complete the current wait node |

MCP write tools resolve the active Chrona execution context from the session and injected metadata. Agents should not send backend task, plan, node, layer, or graph IDs unless Chrona explicitly provided them as public input.

## Error shape

Errors generally use HTTP status codes with a JSON body containing `error` and sometimes `code`, `reasonCode`, or recovery hints.

Common statuses:

| Status | Meaning |
| --- | --- |
| 400 | Invalid parameters or malformed body |
| 404 | Resource not found |
| 409 | State conflict, duplicate active generation, or invalid transition |
| 500 | Unexpected server error |
