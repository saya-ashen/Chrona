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


### GET /api/tasks/:taskId/activity

Returns task activity/timeline records.

### GET /api/tasks/:taskId/nodes/:nodeId/activity

Returns activity filtered to one plan node.

### GET /api/tasks/:taskId/runtime-context

Returns runtime context used by execution/provider flows.

### GET /api/tasks/:taskId/review-context

Returns review context for approvals, recovery, and result decisions.

### GET /api/tasks/:taskId/command-center

Returns command-center state for task workspace actions.

### GET /api/tasks/:taskId/workspace/header

Returns lightweight task workspace header state.

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

### GET /api/tasks/:taskId/result/follow-up

Returns the continuation state for the latest accepted result: the accepted Run, source-session availability and health, and persisted follow-up questions or linked next tasks.

### POST /api/tasks/:taskId/result/follow-up

Continues from an accepted result. Requests are idempotent by `requestId`.

- `intent: "ask"` resumes the original provider conversation when available. If the source session is missing, Chrona falls back to the accepted result plus persisted follow-up history.
- `intent: "create_task"` creates a linked Draft task. `sessionStrategy` may be `handoff_compact` (default, compact handoff into a new independent provider session) or `fresh_with_result` (accepted result and deliverables only).

The source task's accepted Run, result, artifacts, plan, and execution state remain immutable. Result follow-up turns run without execution or mutation tools.


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

Applies plan patch operations. The route accepts the plan patch schema used by the task workspace. Common operations include adding, deleting, updating, and reordering nodes or edges.

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

### GET /api/tasks/:taskId/provider-approvals

Lists provider-native approvals associated with the task execution context.

### POST /api/tasks/:taskId/provider-approvals/:approvalId/resolve

Resolves a provider-native approval after user decision.


## Task schedule

### PUT /api/tasks/:taskId/schedule

Applies a concrete schedule.

Fields include `scheduledStartAt`, `scheduledEndAt`, `dueAt`, and `scheduleSource`.

### DELETE /api/tasks/:taskId/schedule

Clears a task schedule.

### PUT /api/work-blocks/:workBlockId/schedule

Updates a concrete work-block schedule.


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

Action Center projection wire contract: pending approvals, schedule proposals, waiting inputs, failed/cancelled runs, and attention items. The HTTP path remains `/api/inbox` for API stability while the user-facing surface is Action Center.

### GET /api/memory?workspaceId=...

Internal/hidden projection for memory data. Current primary UI routes do not expose a Memory Console page.

### POST /api/work/:taskId/commands

Submits a task workspace command asynchronously. Command types include plan generation, plan acceptance, execution actions, and checkpoint actions. Returns `202` with a `commandId`; subscribe to task workspace events for updates.

### GET /api/work/:taskId/events

Subscribes to task workspace projection events over SSE.

### GET /api/dashboard?workspaceId=...

Dashboard projection for workspace-level overview data.



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


## External calendars

External calendar endpoints are workspace-scoped and manage read-only subscription feeds. Source URLs stay server-side after setup; browser responses use redacted URL labels.

### POST /api/workspaces/:workspaceId/calendar-sources/validate

Validates a subscription/webcal URL and returns detected metadata or a validation error.

### POST /api/workspaces/:workspaceId/calendar-sources

Creates a calendar source, stores the private source URL server-side, and performs an initial refresh.

### GET /api/workspaces/:workspaceId/calendar-sources

Lists active calendar sources for the workspace.

### PATCH /api/workspaces/:workspaceId/calendar-sources/:sourceId

Updates source display/configuration fields such as name, color, enabled state, sync policy, and automation policy.

### POST /api/workspaces/:workspaceId/calendar-sources/:sourceId/refresh

Refreshes one source and returns updated source and sync status. Blocked-network refreshes require explicit user confirmation.

### DELETE /api/workspaces/:workspaceId/calendar-sources/:sourceId

Marks a source removed and excludes it from future schedule context.

### GET /api/workspaces/:workspaceId/calendar-events

Lists imported read-only calendar events in a date range. Query fields include `from`, `to`, and optional `sourceId`.

## Hermes integration

These endpoints support the Settings / AI Clients Hermes setup flow. They diagnose local or remote Hermes configuration and run explicit user-approved local setup actions. They do not replace the AI client CRUD endpoints; the client still stores the selected base URL, API key, scope, and feature bindings.

### POST /api/integrations/hermes/diagnose

Runs Hermes environment checks and returns diagnostics plus a setup plan.

Request fields:

| Field | Required | Notes |
| --- | --- | --- |
| `baseUrl` | no | Hermes API base URL. Local URLs such as `localhost` and `127.0.0.1` enable local checks. Remote URLs skip local filesystem/CLI checks and return manual guidance. |
| `apiKey` | no | Hermes API key to test. Local diagnostics can also reuse `API_SERVER_KEY` from `~/.hermes/.env` when omitted. |
| `mcpUrl` | no | Chrona MCP URL expected by the Hermes plugin. |
| `hermesHome` | no | Override Hermes home directory for local checks. |
| `pluginDir` | no | Override Chrona Hermes plugin directory for local checks. |
| `timeoutMs` | no | API health request timeout. |

Response shape:

```json
{
  "diagnostics": {
    "mode": "local",
    "canAutoConfigure": true,
    "restartRequired": false,
    "checks": []
  },
  "plan": {
    "summary": "Hermes integration looks ready.",
    "canRunAutomatically": false,
    "actions": []
  }
}
```

Common check keys include `baseUrlScope`, `hermesCli`, `chronaPluginInstalled`, `chronaPluginVersion`, `chronaPluginMcpUrl`, `hermesEnvFile`, `apiServerReachable`, `apiKey`, and `apiCapabilities`.

### POST /api/integrations/hermes/setup-local

Runs approved local setup actions for a local Hermes gateway. This endpoint is intended for explicit user clicks such as `Auto-configure local Hermes`.

It may install or update the Chrona Hermes plugin, write plugin MCP config, and write `API_SERVER_ENABLED=true` plus `API_SERVER_KEY` to the Hermes `.env`. Plugin install/update and `.env` changes require a manual Hermes restart because Chrona cannot infer how the gateway was originally started.

Request fields are the same as `diagnose`, with additional optional fields:

| Field | Required | Notes |
| --- | --- | --- |
| `apiKey` | no | Key to write. If omitted, Chrona reuses an existing local `API_SERVER_KEY` or generates one. |
| `skipEnable` | no | Skip `hermes plugins enable chrona` during plugin install/update. |

Response includes updated diagnostics, plan, changed local artifacts, masked API key, optional generated API key, and restart requirement.

### POST /api/integrations/hermes/restart-local

Starts `hermes gateway restart` in the background and returns immediately. Chrona ignores command stdio and does not wait for the gateway process to exit because some Hermes restart modes continue running in the foreground.

Response shape:

```json
{
  "ok": true,
  "exitCode": null,
  "message": "Hermes gateway restart command started in the background."
}
```

Users should restart Hermes manually instead when it runs under a service manager or a custom command that needs specific flags.

## Assistant Surface

### GET /api/assistant-surface?pageType=...

Returns assistant surface state for supported pages such as `schedule`, `task`, and `workbench`.

### POST /api/assistant-surface/actions

Requests an assistant action for the current surface.

## Agent control

### POST /api/agent/control

Internal agent-control command endpoint. Use explicit API contracts and feature bindings instead of treating this as a generic chat route.

## MCP integration

### POST /api/mcp

Streamable HTTP MCP endpoint exposing Chrona tools to external agents.

Public tool names:

| Tool | Purpose |
| --- | --- |
| `chrona_execution_read` | Read execution session state and supported next actions |
| `chrona_plan_read` | Read accepted plan state through AI-visible refs |
| `chrona_plan_generate` | Generate a draft plan for the session task from a complete plan blueprint |
| `chrona_node_read` | Read current execution node state through AI-visible refs |
| `chrona_node_output` | Submit a json-render node output spec before completing the current task node |
| `chrona_node_complete` | Complete the current task node after required outputs have been submitted |
| `chrona_condition_select` | Select a condition branch by nodeId and branchRef |
| `chrona_node_block` | Block the current node with a reason and recovery action form |
| `chrona_node_fail` | Fail the current node with an unrecoverable error |
| `chrona_wait_complete` | Complete the current wait node when the wait condition is satisfied |

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
