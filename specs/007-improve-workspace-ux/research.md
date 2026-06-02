# Research: Improve Workspace UX

## Decision: Limit implementation to `apps/web` workspace presentation

**Rationale**: The feature is visual and interaction polish for one task workspace page. Existing APIs already provide task identity, plan/execution state, action availability, assistant data, and workspace navigation context. Keeping changes in `apps/web/src/components/tasks/workspace/`, task-plan graph UI, and i18n files preserves layer boundaries and avoids unnecessary backend or domain risk.

**Alternatives considered**: Changing Hono API response shapes or shared schemas was rejected because no missing backend data was found during planning. Changing `packages/runtime/domain` was rejected because the requested changes are visual and state-presentational, not business-rule changes.

## Decision: Use existing workspace view-models and fixtures for state clarity

**Rationale**: The workspace already has model/test coverage around loading, empty, planning, executing, blocked, failed, completed, retry, long-text, desktop, and mobile scenarios. Extending these presentation models and tests is smaller and safer than introducing a new state machine for UX labels.

**Alternatives considered**: A new page-level orchestration model was rejected because it would duplicate existing task workspace query/actions logic and raise behavior regression risk.

## Decision: Treat primary action visibility as a UI contract

**Rationale**: The spec requires users to identify the next action within 5 seconds. The implementation should make the current primary action more visually prominent while preserving the existing action handlers and disabled/enabled behavior.

**Alternatives considered**: Reordering or changing workflow actions was rejected because it risks altering task execution semantics. Styling and grouping existing actions is sufficient unless implementation finds an action cannot be represented from current data.

## Decision: Represent active, blocked, review, and completed plan nodes through distinct visual states

**Rationale**: Existing plan graph nodes already expose workspace status attributes in tests such as `completed`, `running`, `waiting`, `approval-needed`, and `blocked`. Visual treatment can build on those states to improve scanning without changing plan data.

**Alternatives considered**: Adding new plan node statuses was rejected because the current status vocabulary maps to the required UX states.

## Decision: Use responsive CSS/layout refactors for mobile usability

**Rationale**: The requirement is no horizontal page scroll at `390px`, safe long-content handling, and reachable primary action. These are layout concerns best solved by CSS grid/flex changes, wrapping/truncation, and panel stacking within existing components.

**Alternatives considered**: Creating a separate mobile page was rejected because it duplicates behavior and increases test burden. Backend-driven mobile-specific data was rejected as unnecessary.

## Decision: Keep all new copy in existing i18n message files

**Rationale**: Chrona requires user-facing strings in `apps/web/src/i18n/messages/en.json` and `zh.json`. Any new labels, state guidance, or action cues should follow existing workspace terminology and be localized in both files.

**Alternatives considered**: Inline strings in React components were rejected because they violate repository guidance and make localization incomplete.

## Decision: Use for browser evidence before and after implementation

**Rationale**: The constitution requires browser evidence for frontend UX changes. Pre-edit evidence has been captured on the representative route with screenshots at `1440x900`, `1024x768`, and `390x844`, plus diagnostics showing task API calls returning `200` and no visible console/error output.

**Alternatives considered**: Relying only on component tests or code review was rejected because the requirement explicitly calls for observed browser snapshots/screenshots and mobile overflow validation.

## Decision: Performance budget is no new data fetches and no expensive presentation computation

**Rationale**: UX polish should not add latency, query count, or material rendering cost. The implementation should reuse loaded task/plan data and CSS-driven layout. Browser verification should confirm the workspace remains usable during initial display.

**Alternatives considered**: Additional polling or backend-derived summary endpoints were rejected because planning found sufficient existing UI data.
