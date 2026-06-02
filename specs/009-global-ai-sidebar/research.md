# Research: Global AI Sidebar

## Decision: Frontend-first sidebar shell with page context adapters

**Rationale**: The feature is primarily a visual/interaction pattern. Existing task and schedule pages already own loaded data, page state, and confirmed mutation flows. A provider/shell in `apps/web/src/components/global-ai-sidebar` plus adapters near `TaskWorkspacePage` and `SchedulePage` avoids duplicating page logic and keeps context switching immediate.

**Alternatives considered**: A backend-driven assistant session was rejected for initial release because it would require new persistence and API contracts before product need is proven. A floating chat widget was rejected because the spec requires a fixed product-native right sidebar.

## Decision: One pending proposal per sidebar session

**Rationale**: The confirmation model is safest when the user can see exactly one actionable preview. Replacing or refining a proposal can invalidate the previous proposal and reduce stale-apply risk.

**Alternatives considered**: Multiple simultaneous proposal cards were rejected because they complicate stale-context validation, ghost-block rendering, and confirmation copy.

## Decision: Shared serializable proposal contracts in `packages/contracts`

**Rationale**: Task previews and schedule ghost blocks need common status, stale, confirmation, and preview metadata while preserving task/schedule-specific payloads. Shared contracts let component tests and domain tests verify preview-before-confirm behavior without importing React.

**Alternatives considered**: Local component-only types were rejected because stale detection and confirm/dismiss flows need cross-component consistency. Persisted database models were rejected because initial session history is intentionally ephemeral.

## Decision: Pure domain helpers for stale detection and summaries

**Rationale**: Stale preview protection, affected-area summaries, and confirmability rules are business decisions and must not live in React components. `packages/domain/src/ai-sidebar` can compare context fingerprints and proposal metadata without importing React or fetch.

**Alternatives considered**: Inline React logic was rejected by constitution. Backend validation was deferred because confirmed changes already go through existing task/schedule mutation paths.

## Decision: Schedule ghost blocks as view-only overlay state

**Rationale**: Ghost blocks must be visible before confirmation but must not mutate `viewData.scheduled` or persisted schedule data. Rendering them as a timeline/list overlay from pending proposal state preserves existing drag/drop and selected-block behavior.

**Alternatives considered**: Temporarily injecting ghost items into scheduled task arrays was rejected because it risks leaking preview state into existing mutation handlers and tests.

## Decision: No backend API change in plan phase

**Rationale**: Existing AI hooks, task proposal flow, schedule page view model, and task/schedule persistence paths provide enough surface to build the sidebar shell and preview safety model. Any later API gap must be justified before implementation.

**Alternatives considered**: New `/api/ai/sidebar` endpoint was rejected for this phase because the spec emphasizes preview and confirmation UX, not a new AI backend contract.

## Decision: Required browser evidence via 

**Rationale**: Constitution requires pre-edit observation and post-edit desktop, tablet, and mobile verification for frontend UX changes. The sidebar changes layout and navigation behavior, so screenshots and snapshots are release evidence.

**Alternatives considered**: Code-only review was rejected because mobile horizontal scroll and product-native feel cannot be proven from source alone.
