# Quickstart: AI Dropdown Surface

## Prerequisites

- Branch: `010-ai-dropdown-surface`.
- Spec: `specs/010-ai-dropdown-surface/spec.md`.
- Plan: `specs/010-ai-dropdown-surface/plan.md`.
- Contracts: `specs/010-ai-dropdown-surface/contracts/`.

## Implementation Sequence

1. Capture current UX evidence with `agent-browser` before UI edits.
2. Validate current sidebar usage in Schedule and Task workspace and identify any remaining global AI entry points.
3. Add shared Assistant Surface State contracts and tests.
4. Move quick-action derivation to page/state/severity mapping outside front-end presentation components.
5. Replace top-bar `GlobalAiSidebarEntry` with the Chrona AI dropdown trigger and menu.
6. Remove the standalone global sidebar panel from the shell.
7. Route mutating actions and short-input mutation results to page-owned proposal preview surfaces.
8. Add Schedule timeline, Task config, Task graph, and Workbench result proposal route handling.
9. Update i18n messages for trigger, dropdown, states, actions, disabled reasons, and recent proposal entries.
10. Add automated tests and e2e coverage for summary priority, action rendering, no silent mutation, and proposal routing.
11. Run post-edit `agent-browser` verification at desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.

## Required Validation

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run test:e2e`

## Browser Evidence Checklist

- Desktop `1440x900`: top-bar trigger visible, dropdown opens, no sidebar opens, highest-priority state visible.
- Tablet `1024x768`: dropdown fits viewport, summaries/actions readable, no overlap with navigation controls.
- Mobile `390x844`: no horizontal scrolling, trigger remains accessible, dropdown content remains usable.
- Schedule page: conflict/queue summaries prioritize correctly and mutating actions route to timeline preview.
- Task page: review/running/blocked summaries prioritize correctly and mutating actions route to config or graph preview.
- Workbench/result context: waiting/failure summaries prioritize correctly and mutating actions route to result preview.

## No-Mutation Checks

- Triggering a mutating quick action must create a proposal, not apply changes.
- Submitting a mutating short input must create a proposal, not apply changes.
- Closing or rejecting preview must leave task, plan, schedule, and execution state unchanged.
- Applying a proposal must happen only from the owning preview surface.

## Performance Checks

- Dropdown opens within 150 ms on warm page data.
- Assistant surface lookup does not add more than one page-scoped backend request when data is not already available.
- Summary rotation does not shift top-bar layout.
- Mobile viewport has no horizontal scroll at 390x844.

## Implementation Notes

- 2026-05-19: Pre-edit automated browser evidence was not captured before code edits in this run; follow-up verification is still required.
- 2026-05-19: `bun run typecheck` passed after assistant surface scaffold and shell replacement.
- 2026-05-19: Updated dropdown layout verification captured with `agent-browser` after centering the trigger and widening the dropdown panel:
  - Desktop `1440x900` Schedule: screenshot `/tmp/opencode/chrona-ai-dropdown-after-desktop.png`; trigger center `824px` in content area, dropdown center `823.99px`, dropdown width `768px`.
  - Tablet `1024x768` Schedule: screenshot `/tmp/opencode/chrona-ai-dropdown-after-tablet.png`; trigger center `512px`, dropdown center `511.99px`, dropdown width `768px`, no horizontal scroll (`scrollWidth=1024`, `clientWidth=1024`).
  - Mobile `390x844` Schedule: screenshot `/tmp/opencode/chrona-ai-dropdown-after-mobile.png`; trigger center `195px`, dropdown center `194.99px`, dropdown width `374px`, no horizontal scroll (`scrollWidth=390`, `clientWidth=390`).
- 2026-05-19: `bun run typecheck` passed after centered/wide dropdown update.
- 2026-05-19: `bun run lint` passed after centered/wide dropdown update.
- 2026-05-19: `bun run test` failed in pre-existing task workspace suites: `task-workspace-execution-overview.test.tsx` (3), `task-workspace-node-detail-panel.test.tsx` (1), and `task-workspace-page.test.tsx` (2). One regression introduced during migration was fixed by restoring the `canAcceptPlan` path into `TaskWorkspacePlanSection` test wiring.
- 2026-05-19: `bun run test:e2e` was blocked before execution because Playwright requires `127.0.0.1:3100` and an existing Vite process is already bound to that port.
- 2026-05-19: `gitnexus_detect_changes(scope: "all", repo: "Chrona")` completed with medium risk: 8 changed indexed symbols, 12 changed files, affected processes `TaskWorkspacePage -> IsDoneStatus` and `SchedulePage -> UseI18n`.
