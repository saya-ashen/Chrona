# Implementation Plan: Improve Workspace UX

**Branch**: `007-improve-workspace-ux` | **Date**: 2026-05-16 | **Spec**: `specs/007-improve-workspace-ux/spec.md`
**Input**: Feature specification from `specs/007-improve-workspace-ux/spec.md`

## Summary

Improve the task workspace page UX in `apps/web` by refactoring existing React layout, CSS classes, state presentation, and localized copy so users can identify the current task, workspace state, active plan node, and primary next action faster on desktop, tablet, and mobile. Preserve task creation, plan generation, plan acceptance, execution, assistant, schedule, and navigation behavior; do not change backend APIs, domain runtime behavior, or shared contracts unless implementation proves the current UI cannot represent required state with existing data.

## Technical Context

**Language/Version**: TypeScript strict; React 19; Vite SPA; Bun >=1.3.11 monorepo runtime.  
**Primary Dependencies**: Existing React Router 7 app, task workspace components under `apps/web/src/components/tasks/workspace/`, task plan graph components, shared `fetch-json-event-source` helper for SSE, existing i18n message JSON files, Vitest/jsdom, Testing Library, Playwright, and `agent-browser`. No new dependency planned.  
**Storage**: N/A for UX polish. Existing Hono/Bun API, SQLite/Prisma persistence, and task read models remain unchanged.  
**Testing**: `bun run typecheck`, `bun run lint`, `bun run test`; targeted Vitest coverage for workspace view model/component states; `bun run test:e2e` required if implementation changes task navigation or task interactions; `agent-browser` pre/post snapshot and screenshots at `1440x900`, `1024x768`, and `390x844`.  
**Target Platform**: Local Chrona web app at `http://localhost:3100` backed by Bun/Hono API on `3101`, verified in browser viewports for desktop, tablet, and mobile.  
**Project Type**: Vite + React SPA in a Bun + Hono API monorepo.  
**Performance Goals**: Workspace first meaningful content remains responsive under existing local dev data; visual refactor must not add network requests or backend query paths; mobile layout must avoid horizontal page scroll at `390px`; added rendering work should be limited to existing page data transformations and CSS/layout changes.  
**Constraints**: Scope limited to task workspace UX. Use `apps/web` for React UI changes. Keep user-facing strings in `apps/web/src/i18n/messages/en.json` and `zh.json`. Do not change `packages/runtime/domain` for visual polish. Do not change backend APIs unless planning/implementation identifies a concrete blocker. Preserve existing task workflow behavior and SSE helper usage.  
**Scale/Scope**: One page family: localized route `/en/workspaces/:workspaceId/tasks/:taskId` and equivalent localized workspace task routes. States in scope include loading, empty, error, idle, running, blocked, review-required, completed, queued, and long-content responsive variants.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Work is constrained to existing `apps/web` workspace UI ownership, with no backend, database, provider, or runtime-domain changes planned. Minimal design uses current components and view-model data rather than introducing a parallel workspace architecture.
- **Testing**: PASS. Required proof includes `bun run typecheck`, `bun run lint`, `bun run test`, targeted workspace component/view-model tests, and `agent-browser` evidence. `bun run test:e2e` is required if task navigation or workflow interactions are changed during implementation.
- **Frontend UX Evidence**: PASS. Pre-edit browser observation completed with `agent-browser` against `http://localhost:3100/en/workspaces/cmp72s4oy0007hgfu74srky2u/tasks/cmp72tzoq00008hfurndtr5q9`; snapshot captured and screenshots written to `specs/007-improve-workspace-ux/pre-desktop-1440x900.png`, `pre-tablet-1024x768.png`, and `pre-mobile-390x844.png`. Post-edit verification must repeat the same route, snapshot, screenshots, console/errors, network requests, and mobile horizontal-scroll check.
- **Product Behavior & API Scope**: PASS. Preserve task creation, plan generation, plan acceptance, execution, assistant interaction, schedule information, and navigation. Backend APIs and shared contracts are not changed for planning; any later API change must be justified as a blocker and documented before implementation.
- **UX Clarity & Responsiveness**: PASS. Existing UI patterns include localized shell navigation, task workspace header controls, execution flow region, current-node details, execution overview, editor overlay, and AI workspace panel. Implementation must make current task, active node, blocked/review state, and primary action visually obvious at desktop `1440x900`, tablet `1024x768`, and mobile `390x844`, with no horizontal scroll on mobile and safe wrapping/truncation for long content.
- **Performance Budgets**: PASS. No new data fetching, polling, or expensive graph computation planned. Rendering budget: reuse existing task/plan read models and CSS layout; browser verification should show the workspace usable without visible layout overflow or blocking delay in local dev.

## Project Structure

### Documentation (this feature)

```text
specs/007-improve-workspace-ux/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── workspace-ux-contract.md
├── pre-desktop-1440x900.png
├── pre-tablet-1024x768.png
└── pre-mobile-390x844.png
```

### Source Code (repository root)

```text
apps/web/
├── src/components/tasks/workspace/
│   ├── page/              # Workspace page shell and header card UX hierarchy
│   ├── sections/          # Plan, edit, and AI workspace sections
│   ├── execution/         # Current node details and execution overview state clarity
│   ├── model/             # Existing UI view-models; extend only for presentation needs
│   └── test-support/      # Existing fixtures for workspace state coverage
├── src/components/tasks/plan/
│   └── task-plan-graph/   # Active, queued, completed, blocked, and review node styling
└── src/i18n/messages/
    ├── en.json            # New or changed user-facing workspace strings
    └── zh.json            # Matching localized strings

e2e/specs/
└── task-workspace*.spec.ts # Extend only if navigation/task interactions change
```

**Structure Decision**: Use existing web workspace component ownership under `apps/web/src/components/tasks/workspace/` and existing task-plan graph components. Add documentation-only UI contract for acceptance and evidence. Keep shared schemas, backend APIs, and runtime/domain packages unchanged unless later implementation evidence proves they are required.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved clarifications:

- Current target route and local representative data are available at `http://localhost:3100/en/workspaces/cmp72s4oy0007hgfu74srky2u/tasks/cmp72tzoq00008hfurndtr5q9`.
- Existing frontend data is sufficient for planning a visual hierarchy improvement: task title, control availability, execution flow, current-node detail, and overview regions render from current APIs.
- Existing architecture already has workspace fixtures and tests for loading, empty, planning, executing, blocked, failed, completed, retry, long text, desktop, and mobile states.
- Browser evidence workflow is viable with `agent-browser set viewport`, `snapshot -i`, `screenshot`, `console`, `errors`, and `network requests`.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/workspace-ux-contract.md`, and `quickstart.md`.

Key design decisions:

- Treat workspace UX entities as presentation contracts over existing task and plan data, not new persisted models.
- Use a stronger page-level hierarchy: task identity and state first, primary next action prominent, secondary controls grouped behind lower visual weight.
- Use differentiated status treatments for loading, empty, error, running, blocked, review-required, completed, queued, and idle states without changing their semantics.
- Make active plan node visually dominant in graph/list/detail contexts and ensure blocked/review states carry distinct labels and guidance.
- Use responsive CSS/layout refactors to collapse dense panels safely at `390px`, preserve control access, wrap/truncate long content, and prevent horizontal page scroll.
- Keep all new user-facing labels and explanatory state copy in `apps/web/src/i18n/messages/en.json` and `zh.json`.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design is limited to existing web UI components, existing view-model presentation extensions, and localized copy. No new architecture, backend contract, persistence, provider, or runtime-domain changes are approved.
- **Testing**: PASS. Quickstart records required automated checks and browser evidence. Component/view-model tests cover distinguishable states and responsive-safe content; e2e runs if implementation touches navigation or workflow behavior.
- **Frontend UX Evidence**: PASS. Pre-edit evidence exists in this spec directory. Post-edit evidence must use the same route and viewport set, plus console/error/network diagnostics and mobile scroll validation.
- **Product Behavior & API Scope**: PASS. UI contract explicitly preserves existing task creation, plan generation, acceptance, execution, assistant, schedule, and navigation actions. Backend APIs remain unchanged.
- **UX Clarity & Responsiveness**: PASS. Data model and UI contract define visible task identity, state, active node, primary action, state guidance, and mobile no-horizontal-scroll expectations.
- **Performance Budgets**: PASS. Design avoids new fetches and expensive computation; validation relies on browser observation and existing automated checks.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
