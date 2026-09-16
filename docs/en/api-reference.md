# Chrona API Reference

Base URL: `http://localhost:3101/api`

- Content type: `application/json` unless the endpoint is an SSE stream.
- Auth: optional `Authorization: Bearer <token>` when `API_KEY` is configured, except independently authenticated endpoints. `/api/mcp/management` always requires its own management credential.
- Default bind: `127.0.0.1`. Use `HOST=0.0.0.0` only intentionally and protect it with `API_KEY`; unsafe public bind without `API_KEY` requires `CHRONA_UNSAFE_PUBLIC_BIND=1`.
- IDs shown here are examples. Agents should use AI-visible refs from MCP tool results, not backend IDs.

## Health

### GET /api/health

Returns server health.

```sh
curl http://localhost:3101/api/health
```

## Goals

### GET /api/goals?workspaceId=...

Lists durable Goals with lifecycle/activity/attention projection, bounded tasks,
accepted results, and read-only Goal assets.

### POST /api/goals

Creates an active Goal with validated user-confirmed success criteria.

### POST /api/goals/with-first-task

Atomically and idempotently creates a Goal plus its first bounded Task from a
Goal title, optional Goal-level additional context, and a separate first Task
title. Failure leaves neither partial object behind.

### GET /api/goals/:goalId

Returns the lifecycle-aware Goal read model: workspace/archive mode,
projection, primary action, Operational Brief, derived Needs You/In Progress/
New Results/Up Next focus groups, evidence-backed outcome, grouped bounded
tasks, immutable accepted-result summaries, GoalAsset provenance, supported
Artifact operations, and audit activity.

### PATCH /api/goals/:goalId

Updates Goal metadata, criteria, or next-review time without changing execution
history.

### PUT /api/goals/:goalId/brief

Replaces the current validated Operational Brief and appends an immutable
`GoalBriefRevision` with actor and time. Archived Goals reject this mutation.


### POST /api/goals/:goalId/actions

Applies explicit `pause`, `resume`, `stop`, or `achieve` lifecycle actions.
`achieve` is valid only for an active Goal and requires a non-empty confirmation
plus at least one Artifact owned by a Goal task or GoalAsset. It persists actor,
note, confirmation time, evidence IDs, and a canonical `goal.achieved` event.
Goal review is bounded work, not a Goal lifecycle/provider action.

### POST /api/goals/:goalId/tasks

Creates a Goal-owned bounded `task` or `review` Task. The server automatically
freezes the current Operational Brief plus a compact catalog of accepted Goal
results in immutable `Task.goalContext`. Full accepted result content remains
available to planning and execution sessions through bounded
`chrona_goal_results_read` calls. The Task owns all later Plan, Run,
execution-session, provider-session, approval, and Result state; later Goal
edits or accepted results cannot mutate the snapshot.

### POST /api/tasks/:taskId/actions/rebuild-with-latest-goal-assets

Destructively replaces a Goal-linked Task with a new canonical Task using the
same definition and the Goal's current approved, unarchived asset versions.
The old Task tree, Plan, Runs, execution history, Artifacts, and Results are
deleted atomically; the replacement starts Ready without a Plan or execution
progress. Standalone Tasks are rejected. The response identifies both the new
`taskId` and `replacedTaskId`; callers must navigate to the new Task.

### GET /api/goals/:goalId/artifacts/:artifactId

Returns a Goal-owned Artifact read model and supported open/copy/download
operations. Generated-file downloads continue through the task result-file
authorization boundary; arbitrary local paths are not exposed.

### Goal Asset Workbench

- `GET /api/goals/:goalId/assets` lists/searches/sorts typed Goal assets and recent items.
- `GET|PATCH /api/goals/:goalId/assets/:assetId` reads or renames one asset.
- `POST /api/goals/:goalId/assets/:assetId/drafts` saves a version-based draft.
- `POST /api/goals/:goalId/assets/:assetId/drafts/submit` commits a draft or returns an optimistic conflict.
- `POST /api/goals/:goalId/assets/:assetId/versions/:versionId/restore` recovers an old version as a new version.
- `POST /api/goals/:goalId/assets/:assetId/archive` archives or restores an asset.
- `GET /api/goals/:goalId/inbox` lists pending accepted-result candidates.
- `POST /api/goals/:goalId/inbox/extract` splits one accepted Result into typed candidates.
- `POST /api/goals/:goalId/inbox/:candidateId/resolve` creates an asset, appends a version, or rejects the candidate.
- `POST /api/goals/:goalId/assets/:assetId/submissions` persists a Form-version submission.
- `POST /api/goals/:goalId/assets/:assetId/jobs` creates version-bound thumbnail/export work.
- `POST /api/goals/:goalId/assets/:assetId/ai-modification-task` creates a bounded Task with an immutable asset-version snapshot.

Every mutating command validates Goal/workspace/asset/version ownership. Source
Task Results and Artifacts are never mutated.

### Task triggers and occurrences

- `POST /api/tasks/:taskId/triggers` creates a validated schedule,
  internal-event, or email trigger.
- `PATCH /api/tasks/:taskId/triggers/:triggerId` applies optimistic versioned updates.
- `POST /api/tasks/:taskId/triggers/:triggerId/actions` pauses, resumes, or retires a trigger.
- `GET /api/tasks/:taskId/occurrences` lists isolated occurrence read models.
- `GET /api/tasks/:taskId/occurrences/:occurrenceId` reads one occurrence and its execution records.
- `POST /api/integrations/email/events` accepts the first non-time adapter
  envelope. It requires the server-held email credential, HMAC-SHA256 signature,
  a timestamp within five minutes, unique delivery ID, bounded validated fields,
  and an explicit workspace scope.

Unknown trigger kinds are rejected. Internal and email events persist bounded,
normalized, secret-free input; delivery keys enforce replay idempotency. No
public webhook ingress is exposed.

### Goal-scoped Task inspector route

`/goals/:goalId/workbench/tasks/:taskId` is a browser route, not a second Task
API. Its loader verifies `Task.goalId`, then composes the existing Task bootstrap,
runtime context, review context, command center, and header endpoints. The
canonical `/tasks/:taskId` route remains valid.

### POST /api/tasks/:taskId/actions/promote-to-goal

Atomically promotes an accepted task result into a new Goal. The request carries
the accepted Run, selected Artifact references, validated criteria, proposed
title, and an idempotency key. The server verifies workspace/task/run/artifact
ownership; source results and Artifacts remain immutable.

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

Creates a task. Important fields include `workspaceId`, `title`, `description`, `priority`, `aiClientId`, `executionConfig`, and `parentTaskId`. Omitted `taskExecutionMode` preserves the AI plan/run lifecycle; explicit `taskExecutionMode: "manual"` creates direct human-managed work and rejects AI provider, execution configuration, automation, and recurrence fields. `aiClientId` is the only task-level provider override; when omitted, Chrona resolves the `task.execution` feature binding and then the enabled default AI client.

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

Reopens a completed AI task according to its accepted-plan state.

### POST /api/tasks/:taskId/manual/complete

Directly completes an explicit manual task without a Plan, Run, or provider session. Body requires `{ expectedRevision, requestId }`; the server derives the task workspace from task metadata. `expectedRevision` is the observed `config-v1:N` token from the task read. The request ID is durable: retry identical payloads to receive the original receipt; a stale revision or reused request ID with different payload conflicts.

### POST /api/tasks/:taskId/manual/reopen

Reopens an explicit manual task to Ready without creating AI execution records. Uses the same server-derived CAS/request-receipt body as `manual/complete`. The legacy `/complete` and `/reopen` endpoints reject manual tasks.

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
- `complete_manual_node` — for a `manual_completion` checkpoint, send the persisted `formRevision` and typed `inputFields`; the server revalidates both before advancing
- `fail_current_node`
- `cancel_session`

SSE event types include graph events, runtime events, state updates, result events, and heartbeats.

### POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions

Submits a checkpoint/input/approval action and streams the resulting execution progress over SSE.

Common checkpoint actions include `submit_input`, `approve_result`, `reject_result`, `request_changes`, `accept_replan`, `reject_replan`, `request_replan`, `retry_node`, `resume_after_unblock`, `mark_node_completed`, `mark_node_skipped`, `fail_task`, and `cancel_session`. A normal manual step returns checkpoint kind `manual_completion`, a validated form with revision/source metadata, and primary action `mark_node_completed`; it does not expose blocker recovery actions. Stale revisions return a conflict and invalid field values leave the node waiting for input.

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

### POST /api/mcp/management

Independent, stateless Streamable HTTP endpoint for personal agents managing Chrona tasks outside an execution. Always requires a revocable, workspace-bound management Bearer credential, even without a global API_KEY. No run-token or API-key substitution and no HTTP enrollment endpoint.

Tools: `chrona_context_read`, `chrona_task_search`, `chrona_task_read`, `chrona_task_create`, `chrona_task_update`, `chrona_task_action`, `chrona_task_delete`, `chrona_goal_search`, `chrona_goal_read`, `chrona_goal_propose`, `chrona_goal_update`. Read the advertised schemas through `tools/list`. Mutations use UUID request IDs, persisted receipts, configuration revisions and existing domain commands. A queued/completed **command** is not a completed **task**. Execution uncertainty is reported rather than blindly redispatched.

Scheduling is calendar placement, not notification delivery. Context capabilities explicitly distinguish fixed `dueAt`-based in-app indicators from unsupported custom reminders and push/email delivery. `todo` means no automatic planning/execution, not an independent manual-todo lifecycle. On create, only `automatic` accepts/requires `start`; `todo` and `plan` may supply `schedule` without it. The object-root create schema advertises structural mode/start constraints via `allOf` and input examples in its description; runtime validation still checks dates and timezones.

Use `chrona_task_read` with `view: "compact"` for identity, revision, deadline, projected schedule and automation without plan/runtime reads. An explicit `workBlockId` adds that ownership-checked block separately. Search rows and mutation receipts also include schedule/automation summaries; default summary and existing config fields remain compatible. `task.status`, `schedule.status` and automation settings are distinct. Timestamps serialize as UTC, not the original single-window timezone. Receipt snapshots are historical; reread the task for current state. Use a full read before execution/checkpoint actions.

Goal lookup requires `goals:read`; proposals also require `goals:propose`; edits require `goals:read` + `goals:write`. Goal-only presets are `assistant-read` (lookup), `assistant` (lookup/capture), and opt-in `assistant-edit` (lookup/capture/edit). Historical presets and existing credentials are not widened. Goal-only context reads omit provider listings. Check `capabilities.goals.contractVersion` (1), `canRead`, `canPropose` and `proposalModes`. Editing separately advertises `editing.contractVersion` (1), `canUpdate`, editable statuses and `revisionField: "editRevision"`.

`chrona_goal_search` bounds results to 20 per page and the credential's workspace. `chrona_goal_read` provides `compact`, `brief`, `criteria` or `history`, not raw assets/runtime data. `revision` remains an observational snapshot fingerprint; **`editRevision`** is the persisted configuration CAS token used for editing. History contains management updates/notes only, with page/pageSize bounds (1–1,000 / 1–20), explicit text/diff truncation flags, and smaller-page detail. It is not a full Goal activity export.

`chrona_goal_propose` captures a **new Draft only**, with proposed criteria, rationale, source summary and natural-language permission requests. `chrona_goal_update` accepts a UUID `requestId`, `goalId`, `expectedRevision` from `editRevision`, a `reason`, optional partial `patch`, optional `note`, and `dryRun`. At least one patch/note is required. Editable states: Draft, Active, Paused; archived Goals reject edits.

- Patch fields: title, nullable description, partial brief (outcome/currentFocus/strategy/constraints), and ID-based criterion add/revise/remove operations. Omitted content is preserved, never rebuilt from bounded reads. Changed criterion meaning resets satisfaction/confirmation/evidence; untouched criteria retain them. At least one criterion must remain; edits support at most 20 criteria.
- Notes: progress/finding/decision, attributed to the management client; not verified evidence, accepted results or criterion confirmation. `reason` is provenance, not trusted consent evidence.
- Dry run: read-only validation and bounded before/after preview, no receipt, audit write or model call. Inferred material edits require conversational review; a preview is not a persisted approval proposal. The tool does not verify conversation consent.
- Write: atomic content/configRevision, brief version when changed, audit and idempotent command receipt. Canonical/UI writes invalidate CAS, including A→B→A. Revision conflict means reread/reconcile, never blindly refresh the token. Identical retries replay the original receipt after refreshing scopes.
- Existing Task contexts are immutable; future Goal-linked Tasks see updated brief content. No Task/plan/review/trigger starts, lifecycle transitions, permission grants or notifications occur. Constraints remain natural-language requests, not enforced policy. `goals:write` authorizes content editing across its workspace, not per-Goal grants.

Source editing capability requires the registered database amendment and explicit enrollment on upgrade. The existing live capture-only Pi credential is unchanged; source capability is not deployment evidence. Draft activation and an always-on assistant remain outside this milestone.

Local setup: `chrona mcp enroll`, `chrona mcp list`, `chrona mcp revoke`. See [setup, capabilities and current limitations](../zh/management-mcp.md) and the portable [assistant skill](../../packages/skills/chrona-assistant/README.md).

### POST /api/mcp

Existing execution-scoped Streamable HTTP MCP endpoint for provider-injected Chrona tools; not the external task-management entrypoint.

Public tool names:

| Tool | Purpose |
| --- | --- |
| `chrona_execution_read` | Read execution session state and supported next actions |
| `chrona_plan_read` | Read accepted plan state through AI-visible refs |
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
