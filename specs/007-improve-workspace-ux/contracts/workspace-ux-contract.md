# UI Contract: Task Workspace UX

This contract documents user-visible behavior for the task workspace redesign. It does not define a backend API contract.

## Scope

- Applies to localized task workspace routes like `/en/workspaces/:workspaceId/tasks/:taskId`.
- Applies to React UI under `apps/web/src/components/tasks/workspace/` and related task-plan graph presentation components.
- Excludes backend API changes, persisted data changes, runtime-domain changes, global navigation redesign, and unrelated pages.

## Required Visible Regions

- Task identity region: current task title and overall state must be the dominant page context.
- Primary action region: the most important next action must be visually clearer than secondary actions.
- Plan flow region: active plan node must be visually distinct from queued, completed, blocked, and review-required nodes.
- Current node details region: selected or active node details must explain current work or why details are unavailable.
- Execution overview region: result, progress, blocked/review/completed outcomes, and next-step cues must be distinguishable.
- Assistant/editor regions: existing access must remain available without becoming the dominant workflow cue unless they are the primary next action.

## State Contract

- Loading state communicates pending content without implying failure.
- Empty state explains missing task or plan content and presents an appropriate next action or guidance.
- Error state explains load/request failure and offers recovery guidance.
- Running state highlights active task/node/progress and preserves valid execution controls.
- Blocked state uses distinct urgent treatment and explains unblock/recovery path when available.
- Review-required state uses distinct treatment from blocked and completed states and keeps review action discoverable.
- Completed state is clearly final and does not present execution start controls as the next step.
- Idle/waiting state clarifies what can happen next without looking broken.

## Responsive Contract

- At `1440x900`, task identity, state, active node, and primary action must be visible without dense scanning.
- At `1024x768`, the same information must remain reachable and visually prioritized after normal panel reflow.
- At `390x844`, page content must not create horizontal scrolling; long labels, node names, assistant content, and schedule content must wrap or truncate safely.
- Primary action must remain easy to find on mobile even if secondary panels stack vertically.

## Behavior Preservation Contract

- Existing task creation flow remains available.
- Existing plan generation and plan acceptance behavior remains available.
- Existing task execution controls and action handlers remain available with existing disabled/enabled semantics.
- Existing assistant interaction remains available.
- Existing schedule information and task navigation remain available.
- Existing localized routing remains available.
- Existing SSE implementation continues to use the shared `fetch-json-event-source` helper when streaming is involved.

## Localization Contract

- New or changed user-facing strings must be added to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/zh.json`.
- Copy should follow existing Chrona terminology for tasks, plans, nodes, execution, review, and blocked states.

## Evidence Contract

- Before implementation: capture `agent-browser snapshot -i`, screenshots at `1440x900`, `1024x768`, and `390x844`, and diagnostics.
- After implementation: repeat the same route, snapshot, screenshots, diagnostics, and mobile horizontal-scroll check.
- Automated checks before completion: `bun run typecheck`, `bun run lint`, and `bun run test`.
- Run `bun run test:e2e` if implementation changes task navigation or workflow interactions.
