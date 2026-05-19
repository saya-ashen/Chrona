# UI Contract: Global AI Sidebar

## Global Entry

- The top-level Chrona UI exposes a visible `Ask Chrona` control with shortcut hint `⌘K`.
- Activating the entry opens a fixed right-side sidebar and preserves the current route and page state.
- Activating close hides the sidebar without applying or discarding page data. Pending preview state remains scoped to the current sidebar session unless context becomes stale.

## Sidebar Layout Contract

- The sidebar contains five visually distinct sections: context summary, quick actions, conversation, proposal preview, confirmation controls.
- Desktop/tablet: sidebar is fixed to the right edge and does not render as a bottom chat bubble.
- Mobile 390x844: sidebar remains usable without horizontal scroll and keeps primary confirmation controls visible.
- Unsupported contexts show a general context summary and no mutating quick actions.

## Context Switching Contract

- On task pages, context summary shows task title, active or selected node, node state, blocker/review status when present, and primary next action.
- On schedule pages, context summary shows selected date, unscheduled queue count, free-time/largest idle window, conflict count, active view, and primary next action.
- Navigating between task and schedule pages updates context summary and quick actions without closing the sidebar.
- A material context change marks the pending proposal stale and disables confirmation until regenerated or dismissed.

## Quick Action Contract

Task context actions:
- `explain-blocker`: informational response using task/node/blocker context.
- `modify-plan`: mutating preview with task change preview.
- `retry-node`: mutating preview with affected node and retry intent.
- `add-step`: mutating preview with added step and insertion target.

Schedule context actions:
- `smart-schedule`: mutating preview with schedule ghost blocks.
- `find-opening`: informational or preview response depending on whether placement is proposed.
- `explain-unplaced`: informational response using queue/free-time/conflict context.
- `handle-conflict`: mutating preview with conflict resolution changes and ghost blocks when time changes are proposed.

## Preview-Before-Confirm Contract

- No task or schedule mutation callback may run from an AI action until a visible proposal preview exists and the user confirms it.
- Informational responses must be styled separately from actionable previews.
- Confirmation controls show `Confirm`, `Dismiss`, and `Refine` when a proposal is pending.
- Confirm is disabled for `stale`, `applying`, `applied`, `failed`, or unsupported proposals.
- Apply failure leaves original task/schedule data unchanged and shows safe retry or dismissal options.

## Schedule Ghost Block Contract

- Ghost blocks render from `ScheduleGhostBlockPreview.placements` only.
- Ghost blocks must be visually distinguishable from persisted scheduled blocks.
- Dismiss, regenerate, route context change, or successful confirmation removes ghost blocks from preview state.
- Ghost blocks must not participate in existing drag/drop persistence before confirmation.

## Accessibility And Localization Contract

- Entry, close, quick actions, proposal controls, stale warnings, loading, success, failure, unavailable states, and preview labels must come from i18n message files.
- Sidebar has an accessible panel label and keyboard-reachable controls.
- Status changes use polite announcements where appropriate and must not trap focus permanently.

## Test Contract

- Component tests assert layout sections, context switching, action availability, stale proposal disablement, and confirm/dismiss/refine outcomes.
- Domain tests assert context fingerprint comparison, proposal state transitions, and no-confirm/no-mutation guard.
- E2e tests assert global entry, task preview confirmation, schedule ghost blocks, navigation context update, and mobile no-horizontal-scroll.
