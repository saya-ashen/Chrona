# Autonomous Execution Trust UX Spec

## Purpose

Chrona should make autonomous planning and execution feel bounded, inspectable, and recoverable. The user should know what Chrona may do automatically, why it did it, when it stopped, and what decision is needed next.

This spec covers trust surfaces around plan generation, schedule-triggered execution, provider/runtime actions, approvals, failures, cancellation, results, logs, and artifacts.

## Current code anchors

| Area | Current anchor |
| --- | --- |
| Orchestrator workers | `packages/engine/src/modules/orchestration/task-orchestrator.ts` |
| Due auto-plan worker | `packages/engine/src/modules/orchestration/due-auto-plan-generation-worker.ts` |
| Due auto-start worker | `packages/engine/src/modules/orchestration/due-scheduled-work-worker.ts` |
| Auto plan generation | `packages/engine/src/modules/scheduling/auto-generate-scheduled-plan.ts`, `packages/engine/src/modules/plans/auto-generate-task-plan.ts` |
| Auto execution eligibility | `packages/engine/src/modules/scheduling/derive-auto-start-eligibility.ts`, `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.ts` |
| Graph advancement | `packages/engine/src/modules/orchestration/graph-advancement-worker.ts` |
| Execution command kernel entry | `packages/engine/src/modules/plan-execution/task-plan-execution.ts` |
| Domain state | `packages/domain/src/task/derive-task-state.ts`, `packages/domain/src/task/derive-task-execution-state.ts` |
| API and SSE | `apps/server/src/routes/pages/work.routes.ts`, task plan/execution routes documented in `docs/en/api-reference.md` |
| Action queue | `apps/web/src/components/action-center/`, `/api/inbox` projection |

## Trust principles

1. **Automation is explicit.** A task shows whether auto-plan and auto-execute are enabled, when they trigger, and what they are allowed to do.
2. **Chrona owns state.** Providers can produce plans, outputs, tool events, and approval requests; Chrona decides task/run/approval/result state.
3. **Every pause explains itself.** Waiting, blocked, failed, cancelled, and stale states show cause, scope, and safe next action.
4. **Approvals are not logs.** Approval requests are first-class decisions with risk, diff/evidence, and explicit approve/reject/change actions.
5. **Recovery is a designed path.** Retry, resume, replan, stop, and accept-result flows are visible, not hidden in raw activity.
6. **Audit is durable.** User decisions, system automation, provider events, tool activity, artifacts, and failures remain grouped and searchable.
7. **AI-authored output is not authority.** json-render or markdown can present results, but product-authored controls own lifecycle actions.

## Automation policy surfaces

### Task create/edit

Show a compact automation policy block:

- Plan generation: manual / immediate / before scheduled start / disabled.
- Execution: manual / at scheduled start / disabled.
- Runtime/provider selected.
- Approval/input checkpoints expected by the plan when known.
- What will never happen automatically, e.g. result acceptance or destructive external action without explicit user approval.

Copy pattern:

```text
Automation
Plan: generate 15 minutes before scheduled start.
Run: start at scheduled time after an accepted plan exists.
Stops for: input, approval, provider failure, blocked node, result review.
```

### Schedule cards

Schedule should show readiness before time arrives:

| Readiness | Meaning | UI action |
| --- | --- | --- |
| Ready to auto-plan | no plan, auto-plan enabled, scheduled time in trigger window | review policy / generate now |
| Plan exists | draft/accepted plan exists | review / accept / run preview |
| Ready to auto-run | accepted plan, runtime configured, no active run | start now / inspect contract |
| Cannot auto-run | missing runtime/plan/input/approval/provider | fix blocker |
| Running | scheduled run active | open workspace |
| Waiting/blocked/failed | run stopped | open recovery action |

### Settings / provider readiness

Provider readiness should answer:

- configured or missing;
- reachable health status;
- supports streaming;
- supports cancellation;
- supports approvals;
- supports tool traces;
- supports structured output/json-render;
- known limitations.

Product UI should consume capability facts, not branch on provider name.

## Run contract preview

Before any manual or scheduled start, show a contract preview:

- task and plan version;
- trigger: manual, scheduler, system;
- runtime/provider;
- schedule/work block;
- graph node count and checkpoint count;
- expected approval/input stops;
- allowed actions during run: pause, cancel, retry, resume;
- result review policy: completion creates `Result ready`, user accepts into `Done`.

The preview is trust-critical. It lets the user decide whether automation is safe before Chrona starts spending model/tool time.

## Approval and input UX

Approvals and user inputs need a standard decision card.

Required fields:

- request title;
- who/what requested it: Chrona, provider, node, or scheduler;
- reason;
- affected node/run/session;
- proposed action or output;
- risk note;
- evidence or diff;
- primary action;
- secondary actions;
- timeout/expiry when applicable.

Decision action sets:

| State | Primary | Secondary |
| --- | --- | --- |
| Input needed | Submit input | cancel session |
| Approval needed | Approve | reject, request changes |
| Replan required | Accept replan | reject replan, request replan |
| Provider approval | Approve provider action | reject provider action |
| Result ready | Accept result | request changes, create follow-up |

Approval copy should avoid generic “Needs handling”. It must name what is needed and why.

## Failure and blocked UX

Failures need a structured recovery card:

- state: failed, blocked, cancelled, stale;
- scope: task, run, plan node, runtime, provider;
- human-readable reason;
- original error or provider detail, safely redacted;
- affected node/run/session;
- recommended action;
- recovery options: retry node, resume after unblock, replan, cancel, inspect logs;
- whether automation will retry automatically.

Default policy:

- plan generation failure stops auto-plan retry until user takes action;
- run failure stops execution and asks user to retry/replan/stop;
- waiting states do not become generic blocked states;
- cancelled remains distinct from failed and completed.

## Audit and activity model

Replace raw “one event stream” mental model with grouped audit sections:

1. **Automation decisions**: scheduler started/skipped/failed, auto-plan triggered/skipped.
2. **Plan generation**: status/tool/result/error/cancelled events.
3. **Run lifecycle**: start/pause/resume/cancel/complete.
4. **Node attempts**: node started/completed/failed/blocked/skipped.
5. **Provider/tool activity**: normalized tool names, success/failure summaries, safe refs.
6. **Approvals**: request, decision, actor, timestamp.
7. **Artifacts/results**: produced files/specs/output, validation state.

Each group should summarize first and allow raw details expansion.

## Notification and Action Center contract

Action Center owns cross-task attention. It should include:

- approvals;
- waiting input;
- failed runs;
- blocked runs;
- cancelled runs needing review;
- schedule proposal decisions;
- result-ready reviews.

Each item needs:

- same state label as workspace;
- why it needs attention;
- primary action;
- affected task/work block/run/node;
- age and urgency;
- link to workspace anchor.

Do not create separate copy/state rules per page.

## Data and safety boundaries

Do not expose:

- provider secrets;
- API keys/run tokens;
- raw provider request bodies;
- full MCP tool payloads when they contain sensitive context;
- internal database IDs when AI-visible refs should be used.

Safe surfaces:

- normalized event type;
- redacted error message;
- AI-visible refs;
- artifact names and validation status;
- summarized tool activity;
- user decision records.

## State labels and copy contract

| Backend fact | User label | Explanation | Primary action |
| --- | --- | --- | --- |
| no plan | Needs plan | No executable plan exists yet. | Generate plan |
| active plan generation | Planning | Chrona is asking the provider to draft a plan. | Stop generation |
| draft plan | Plan ready | Review the generated plan before execution. | Accept plan |
| accepted plan, no run | Ready to run | Execution can start with the accepted plan. | Start execution |
| queued/pending | Queued | Execution is waiting to start. | Open run |
| running | Running | Provider/runtime is executing the current step. | Monitor |
| WaitingForInput | Input needed | Chrona needs user-provided data to continue. | Provide input |
| WaitingForApproval | Approval needed | Chrona needs a decision before continuing. | Review approval |
| blocked | Blocked | Execution stopped on a recoverable blocker. | Resolve blocker |
| failed | Failed | Execution or generation failed. | Retry or stop |
| cancelled | Cancelled | Execution was cancelled or abandoned. | Inspect / reopen |
| completed run | Result ready | Execution finished; result needs review. | Accept result |
| Done | Task done | Result accepted and task closed. | Follow up |

## Acceptance criteria

- Every autonomous action produces a visible audit event with reason and trigger.
- Auto-plan and auto-run readiness are visible before schedule time.
- Run contract preview exists before manual/scheduled execution.
- Action Center includes waiting input, waiting approval, failed, blocked, cancelled, and result-ready work.
- No user-facing state says only “Needs handling”. It names the decision or blocker.
- Plan generation failure does not silently retry forever after surfacing an error.
- Provider capability limitations are visible in Settings and reflected in disabled action reasons.
- Result acceptance is explicit; completed runs do not silently become done tasks.

## Test requirements

- Unit tests for automation eligibility and disabled reasons.
- Projection tests for Action Center attention items across approval/input/failed/blocked/cancelled/result-ready states.
- Component tests for decision cards and recovery cards.
- E2E tests for:
  1. auto-plan trigger and failure stop;
  2. scheduled run contract preview;
  3. approval wait and approve/reject;
  4. input wait and resume;
  5. failed node retry;
  6. completed result review and acceptance.
