# Research: AI Dropdown Surface

## Decision: Replace Sidebar Context With Assistant Surface State

**Decision**: Use `AssistantSurfaceState` as the page-aware model for the global AI dropdown. It carries page identity, summaries, highest-priority state, quick actions, recent proposal entries, and availability/fallback state.

**Rationale**: The current sidebar context combines page summary, quick actions, messages, pending proposal preview, and confirmation controls. The new product requirement separates lightweight global entry from page-owned previews. A single surface state model lets pages expose current assistant status without turning the dropdown into a chat or mutation owner.

**Alternatives considered**: Keep `AiSidebarPageContextSummary` and rename UI only; rejected because current types include sidebar/chat assumptions and insufficient action metadata. Add a client-only store; rejected because the spec forbids a new ordinary global mutable source of truth.

## Decision: Generate Quick Actions From Backend/Page-State Mapping

**Decision**: Define action mappings as `page -> state/severity -> actions`, with action objects containing `id`, `label`, `description`, `intent`, `severity`, `requiresPreview`, `previewSurface`, and `disabledReason`.

**Rationale**: The frontend must not hardcode quick actions. Existing schedule and task adapters currently create actions on the client; this should move to shared contract/domain/server aggregation so page state and severity determine actions consistently.

**Alternatives considered**: Continue deriving actions in React page adapters; rejected because it duplicates product decision logic in the presentation layer. Store action mappings in persistent user settings; rejected because actions are derived behavior, not user-owned data.

## Decision: Dropdown Owns UI Open State Only

**Decision**: The dropdown may own transient UI state such as open/closed, input text, selected/revealed summary, and loading display. It must not own authoritative page state, proposals, schedules, tasks, plans, or execution status.

**Rationale**: This satisfies the no-new-global-store constraint while allowing a practical dropdown interaction. Authoritative values come from page data, projections, event-derived state, or backend assistant surface aggregation.

**Alternatives considered**: A global assistant reducer carrying context, messages, pending proposal, and confirm handlers; rejected because the current provider pattern makes the global AI layer too authoritative and allows confirmation from the wrong surface.

## Decision: Mutating AI Actions Return Proposals And Routes

**Decision**: Every mutating quick action or short-input response returns a proposal summary plus a route to an owning preview surface. The dropdown can show a brief recent proposal entry and route the user, but cannot display complex diffs or apply changes.

**Rationale**: Chrona's suggest-confirm model requires page-level review and explicit confirmation. Schedule previews belong on the timeline, task field changes belong in task configuration, graph changes belong in task graph, and execution-result actions belong in workbench result review.

**Alternatives considered**: Confirm proposals inside the dropdown; rejected by the spec. Show full diffs inside the dropdown; rejected because it makes the dropdown a complex preview surface.

## Decision: Preserve Current Preview Capabilities While Moving Ownership

**Decision**: Reuse existing preview concepts where possible, including schedule ghost block previews and task workspace proposal flow, but make their entry point a proposal route rather than global sidebar state.

**Rationale**: Existing schedule timeline and task workspace already have proposal/preview mechanisms. The safest refactor changes ownership and routing, not the underlying page behavior.

**Alternatives considered**: Build a completely new preview framework first; rejected as too broad and unnecessary for the sidebar replacement.

## Decision: Workbench Result Surface Starts As A Contracted Preview Target

**Decision**: Treat `workbench.result` as a first-class preview surface in contracts and planning, even if the visible implementation maps onto existing task workspace execution result panels.

**Rationale**: The spec names workbench result actions. Planning must reserve the route and action semantics so future implementation does not collapse those actions into task config or generic chat.

**Alternatives considered**: Defer workbench entirely; rejected because the feature explicitly includes workbench waiting, failure, accept, retry, and follow-up states.

## Decision: Required Validation Uses Browser Evidence And E2E

**Decision**: Implementation must include `agent-browser` observation before UI edits, post-edit verification at `1440x900`, `1024x768`, and `390x844`, plus `bun run test:e2e` because navigation/task/schedule flows are affected.

**Rationale**: Constitution requires browser evidence for frontend UX changes and e2e coverage when task, schedule, or navigation flows change.

**Alternatives considered**: Unit/component tests only; rejected because dropdown placement, no-sidebar behavior, proposal routing, and mobile overflow require observed UI behavior.

## Implementation Inventory: Existing Global AI Sidebar Usage

Captured during implementation setup:

- `apps/web/src/app-shell.tsx`: wired `GlobalAiSidebarProvider` around the shell.
- `apps/web/src/components/control-plane-shell.tsx`: rendered `GlobalAiSidebarEntry` in the top bar and `GlobalAiSidebar` as the standalone panel.
- `apps/web/src/components/schedule/schedule-page.tsx`: registered Schedule page context/actions through `useGlobalAiSidebar()` and used `pendingProposal` for schedule ghost preview.
- `apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`: registered Task workspace context/actions and old confirm/dismiss handlers through `useGlobalAiSidebar()`.
- `apps/web/src/components/schedule/adapters/schedule-ai-sidebar-adapter.ts`: derived Schedule quick actions in the web adapter.
- `apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.ts`: derived Task quick actions in the web adapter.
- `apps/web/src/components/global-ai-sidebar/*`: owned sidebar entry, panel, quick actions, conversation, and proposal preview controls.
