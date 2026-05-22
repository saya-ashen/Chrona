# Implementation Plan: Plan Execution Orchestration

**Branch**: `main` | **Date**: 2026-05-12 | **Spec**: `specs/001-plan-execution-orchestration/spec.md`
**Input**: Feature specification from `specs/001-plan-execution-orchestration/spec.md`; user direction to use `docs/assets/设计参考.png` as the visual reference for the task workspace page redesign.

## Summary

Chrona will preserve the existing task-to-plan execution model while improving the task workspace into an execution console that makes plan state, current-node progress, human review needs, artifacts, and execution timeline visible in one screen. The implementation approach is brownfield-first: reuse the current Vite React task workspace, existing `TaskPlanGraphPanel`, plan execution read models, task detail loader data, and Hono/Bun contracts where they are sufficient, while allowing narrowly scoped read APIs when required data is not currently available to the UI. The first planned UI increment focuses on `apps/web/src/components/tasks/` and maps current plan graph data into the reference layout: top execution header, central flow graph, lower node-detail panel, and right-side execution overview.

## Technical Context

**Language/Version**: TypeScript strict; React 19; Bun >=1.3.11; Vite SPA frontend; Hono API backend.  
**Primary Dependencies**: React Router 7, `@xyflow/react` plan graph rendering, Hono, Prisma 7 with `prisma-adapter-bun-sqlite`, Zod contracts in `packages/contracts`, Hermes runtime bridge.  
**Storage**: SQLite through Prisma; current accepted/draft task plan graphs are serialized `task_plan_graph_v1` payloads stored in `Memory`; task, run, artifact, approval, event, projection, and schedule proposal records remain Prisma-backed.  
**Testing**: Vitest/Testing Library for web components and domain logic; Bun tests for runtime/server paths; Playwright for end-to-end flows when execution UI behavior crosses browser interactions. Required proof commands: `bun run typecheck`, `bun run lint`, `bun run test`, plus targeted web/runtime tests listed in Quickstart.  
**Target Platform**: Local and deployed Chrona web app using Bun server runtime and Vite SPA frontend.  
**Project Type**: Monorepo web application: `apps/web` frontend, `apps/server` Hono API, `packages/contracts`, `packages/domain`, `packages/runtime`, `packages/db`, and provider packages.  
**Performance Goals**: Task workspace first meaningful render stays under 1.5s on seeded sample data; task workspace interactions that only derive UI state from loaded plan data complete within one animation frame for supported sample plans; execution action responses surface visible feedback within 300ms after the API response resolves; graph + side panel layout avoids layout shift above 0.1 CLS during normal task page load.  
**Constraints**: No Next.js patterns; no Node.js-only runtime paths; business logic must stay out of React components and Hono route handlers; shared schemas belong in `packages/contracts`; pure business rules belong in `packages/domain`; all frontend SSE must use `apps/web/src/lib/fetch-json-event-source.ts`; redesign must preserve existing plan generation, plan acceptance, AI workspace, deletion, and task edit flows.  
**Scale/Scope**: Initial supported scope is a small curated set of sample tasks and plans, especially product launch planning and competitor research summary scenarios. UI redesign scope is one task workspace page plus its immediate task components; backend model changes are documented as future work, but small API additions are allowed when existing task detail/plan-state data cannot support required execution-console components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan keeps ownership boundaries intact: React components render and derive view state, runtime/domain modules remain owners of orchestration rules, API contracts stay in server/contracts packages. The smallest correct UI change is preferred: adapt existing task workspace components and graph panel before adding new abstractions.
- **Testing**: PASS. Required coverage includes unit tests for derived workspace view-model helpers, component tests for task workspace layout states, existing graph tests, and integration/API tests for execution actions when behavior is touched. Proof commands: `bun run typecheck`, `bun run lint`, `bun run test`; targeted commands are listed in `quickstart.md`.
- **User Experience Consistency**: PASS. The redesign intentionally revises the task workspace visual structure to match the provided execution-console reference while preserving Chrona shell navigation, existing button/status badge patterns, loading/empty/error feedback, keyboard access, and current AI workspace behavior.
- **Performance Budgets**: PASS. Budgets are defined above for first render, derived UI interactions, visible action feedback, and layout shift. Validation is through targeted component tests, browser inspection during implementation, and query-count review for any new task workspace read API.

## Project Structure

### Documentation (this feature)

```text
specs/001-plan-execution-orchestration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── execution-architecture.md
├── contracts/
│   ├── current-api-surfaces.md
│   └── task-workspace-execution-console.md
├── checklists/
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/
├── src/components/tasks/
│   ├── task-workspace-page.tsx
│   ├── task-workspace-header-card.tsx
│   ├── task-workspace-plan-section.tsx
│   ├── task-workspace-plan-content.tsx
│   ├── task-workspace-ai-section.tsx
│   ├── task-workspace-types.ts
│   └── task-workspace-query.ts
├── src/components/task/panels/
│   └── task-plan-graph-panel.tsx
├── src/components/task/plan/task-plan-graph/
│   ├── inspector.tsx
│   ├── inspector-details.tsx
│   ├── inspector-run-panel.tsx
│   └── types.ts
└── src/pages.tsx

apps/server/
└── src/routes/
    ├── tasks.routes.ts
    ├── plans.routes.ts
    └── execution.routes.ts

packages/contracts/
└── src/ai.ts

packages/runtime/
└── src/modules/
    ├── plan-execution/
    ├── tasks/
    └── queries/
```

**Structure Decision**: Use the existing monorepo structure. The task workspace visual redesign remains in `apps/web/src/components/tasks/` and reuses `apps/web/src/components/task/plan/task-plan-graph/` for graph and inspector behavior. Backend route and runtime files are contract context for the broader execution orchestration feature and may receive narrow read-contract additions if required console data cannot be derived from existing task detail, plan state, artifacts, approvals, and run summaries.

## Phase 0: Research

Research output is captured in `research.md`. Existing brownfield decisions remain valid for execution orchestration. Additional UI decisions record how the reference image maps to current Chrona components and why the first increment should avoid new backend persistence.

Resolved clarifications:

- The task workspace may have enough plan graph, task, latest run, proposal, approval, and artifact data for the first console layout, but implementation must verify each required card before deciding whether a new read API is needed.
- The reference image should revise only the task workspace content area, not the global `ControlPlaneShell` navigation.
- Right-side overview cards are initially read-only derived summaries from existing loader and graph data.
- Node detail should wrap or reuse the existing graph inspector rather than duplicating execution action behavior.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/current-api-surfaces.md`, `contracts/task-workspace-execution-console.md`, and `quickstart.md`.

Key design decisions:

- Define a frontend-only `TaskWorkspaceExecutionConsoleView` view model derived from `TaskPageData`, `TaskPlanReadModel`, and `TaskPlanGraphPlan`.
- Preserve current route contracts for task detail, plan state, generation, acceptance, execution dispatch, approvals, and artifacts.
- Add a UI contract that documents required visible regions, responsive behavior, state mapping, and criteria for adding narrowly scoped task workspace read APIs.
- Update AGENTS.md plan reference remains `specs/001-plan-execution-orchestration/plan.md`.

## Post-Design Constitution Check

- **Code Quality**: PASS. New design uses view-model derivation and existing components instead of moving business rules into React. Any helper introduced for progress/sidebar derivation must stay pure and testable.
- **Testing**: PASS. `quickstart.md` lists targeted tests and full validation commands. Implementation tasks must add tests for progress mapping, empty graph, active node, blocked/waiting node, artifact list, and responsive layout visibility.
- **User Experience Consistency**: PASS. The redesign intentionally aligns task workspace with execution-console reference while preserving Chrona shell, existing graph interactions, status terminology, AI workspace entry, and error/empty states.
- **Performance Budgets**: PASS. Existing data should be reused first; any new API round trip must be justified by a visible console requirement and validated for query count and response latency. Derived summaries must be memoization-free unless profiling shows a real issue; sample-plan derivation should remain trivial.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
