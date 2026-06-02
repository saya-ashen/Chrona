# Implementation Plan: Workspace Activity Feed

**Branch**: `012-activity-feed` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-activity-feed/spec.md`

## Summary

Replace the node drawer Evidence workflow with a unified Activity experience that lets users inspect task-wide execution in Command Center and node-scoped execution in the selected node drawer. The implementation will introduce a structured, node-aware activity contract across persisted and live events, render provider tool calls with useful details, support progressive history browsing, and end in a clean final model with no old Evidence UI, coarse-only activity renderer, unreliable node inference, or old-data compatibility fallback.

## Technical Context

**Language/Version**: TypeScript strict; React 19 SPA under `apps/web/`; Hono API server and engine packages on Bun runtime  
**Primary Dependencies**: Vite, React Router 7, shadcn/ui primitives, Tailwind CSS tokens, existing i18n messages, `@microsoft/fetch-event-source`, provider runtime event contracts, Prisma 7 SQLite access through Bun adapter  
**Storage**: Existing SQLite task event storage via Prisma; activity is derived from task execution events, with Phase 2 adding a paged activity read surface over the same persisted event history  
**Testing**: `bun run typecheck`, `bun run lint`, `bun run test`; focused Bun tests for engine/contracts/server behavior; web component/model tests for workspace activity; `bun run test:e2e` required because task workspace navigation/drawer/live execution flows are affected  
**Target Platform**: Chrona web workspace on desktop `1440x900`, tablet `1024x768`, and mobile `390x844`  
**Project Type**: Vite + React frontend with Hono/Bun backend in a TypeScript monorepo  
**Performance Goals**: Initial visible activity for a task with at least 3,000 recorded events appears within 2 seconds on standard development hardware; no mobile horizontal scrolling; live activity append remains visually responsive while a task is running  
**Constraints**: Preserve task execution semantics; use shared SSE helper for live frontend events; no business logic in React components; user-facing copy in i18n files; use shadcn/ui primitives for basic controls; final phase removes old Evidence drawer behavior and old compatibility fallbacks rather than keeping aliases  
**Scale/Scope**: Task workspace Command Center activity, selected node drawer activity, activity shaping from persisted task events, live runtime event merging, provider tool detail display, activity history browsing, and tests for the affected model/server/web surfaces

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Activity shaping belongs in contracts/engine/model layers; React components render already-shaped activity and do not own business rules. The plan prefers one shared Activity model and feed component over duplicate Command Center and drawer implementations.
- **Testing**: PASS. Required commands are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e` because drawer/navigation/live task workspace behavior changes. Focused tests must cover contract validation, backend activity mapping, live/persisted deduplication, node filtering, tool detail rendering, empty states, and final legacy removal.
- **Frontend UX Evidence**: PASS. Implementation must capture pre-edit screenshots before UI changes, then post-edit verification at desktop `1440x900`, tablet `1024x768`, and mobile `390x844` with no horizontal scroll.
- **Product Behavior & API Scope**: PASS. Existing task execution, approval, artifact, schedule, and provider run behavior are preserved. Backend read surfaces may change because structured node-aware activity is required for the specified UX and cannot be reliably produced from the current coarse presentation.
- **UX Clarity & Responsiveness**: PASS. Activity must keep current task, active/selected node, blocked/review state, and primary action visible. Existing workspace tab/drawer patterns, shadcn primitives, i18n, loading/empty/error states, and responsive behavior are required.
- **Performance Budgets**: PASS. Initial activity view budget is under 2 seconds for 3,000 recorded events. Phase 2 must add progressive browsing so longer histories do not force unbounded initial payloads or rendering.

## Project Structure

### Documentation (this feature)

```text
specs/012-activity-feed/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── activity-feed-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/
├── plan-runtime/events.ts          # runtime event display contract alignment
└── api/tasks.schema.ts             # task page/activity response contract updates if needed

packages/engine/src/modules/
├── tasks/get-task-page.ts          # persisted activity shaping for task page
└── plan-execution/                 # node-aware provider event persistence already established and finalized

apps/server/src/
└── __tests__/api/                  # integration coverage for task page/activity payloads

apps/web/src/components/tasks/workspace/
├── execution/                      # shared Activity feed and drawer/Command Center rendering
├── model/                          # workspace activity model, filtering, deduplication, view shaping
├── hooks/                          # live runtime event state fed by shared SSE helper
└── sections/                       # pass task-wide and node-scoped activity views

apps/web/src/components/ui/         # shadcn primitives used by activity controls
apps/web/src/lib/fetch-json-event-source.ts # existing SSE helper, not bypassed
AGENTS.md                          # active Spec Kit plan pointer
```

**Structure Decision**: Use the existing Chrona monorepo layering. Contracts define the public activity shape, engine/server code shapes persisted activity, web model code merges and filters activity, and UI components render the feed with shadcn primitives. No new application or compatibility layer is introduced.

## Complexity Tracking

No constitution violations identified. The only added complexity is a shared structured Activity model plus progressive history browsing, which is required to satisfy task-wide and node-scoped visibility without duplicate renderers or unreliable node inference.

## Phase 0 Research Summary

See [research.md](./research.md). Key decisions: use `Activity` singular, make structured node-aware Activity the single final model, filter node drawer activity only by recorded node identity, merge live and persisted activity by stable activity identity, and add progressive history browsing in Phase 2 rather than rendering unbounded event history in the initial page.

## Phase 1 Design Summary

See [data-model.md](./data-model.md) and [contracts/activity-feed-contract.md](./contracts/activity-feed-contract.md). Key entities: ActivityItem, ToolActivityDetails, AssistantActivityDetails, ActivityScope, ActivityFeedState, ActivityPage, and ActivityPhase.

## Post-Design Constitution Check

- **Code Quality**: PASS. Data model and contracts keep activity semantics outside React components and assign shaping/filtering ownership to model/server layers.
- **Testing**: PASS. Quickstart defines focused tests plus full required commands, including e2e because workspace drawer/navigation/live behavior changes.
- **Frontend UX Evidence**: PASS. Quickstart requires pre-edit and post-edit across all mandated viewports.
- **Product Behavior & API Scope**: PASS. Contract changes are justified by structured, node-aware operational history requirements; task execution behavior itself is preserved.
- **UX Clarity & Responsiveness**: PASS. Design includes task-wide feed, node-scoped feed, empty states, expandable details, state visibility, and no horizontal scroll checks.
- **Performance Budgets**: PASS. Initial feed budget and progressive history behavior are specified with validation steps.
