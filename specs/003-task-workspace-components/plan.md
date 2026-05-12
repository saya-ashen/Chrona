# Implementation Plan: Task Workspace Component Parity

**Branch**: `003-task-workspace-components` | **Date**: 2026-05-12 | **Spec**: `specs/003-task-workspace-components/spec.md`
**Input**: Feature specification from `specs/003-task-workspace-components/spec.md`; user direction to follow locally introduced tech stack and dependencies, add new libraries only when they are the best design choice, and avoid keeping old compatibility code or old data patterns during implementation.

## Summary

Chrona will revise the task workspace into a functional execution console that matches the provided reference image at the component level: global task navigation, task execution header, flow map, selected-node detail panel, right-side result/attention/artifact/activity overview, and state-specific actions. The implementation should remain brownfield-aware but not compatibility-heavy: reuse existing Vite React task workspace, React Router data flow, `@xyflow/react` graph capabilities, and existing task execution read data first; add small view-model helpers or narrow contracts only where required for visible component parity; remove or replace obsolete workspace structures instead of preserving duplicate legacy layouts.

## Technical Context

**Language/Version**: TypeScript strict; React 19; Bun >=1.3.11; Vite SPA frontend; Hono API backend.  
**Primary Dependencies**: Existing React Router 7, `@xyflow/react`, Testing Library, Vitest, Playwright, Hono, Prisma 7 with `prisma-adapter-bun-sqlite`, Zod contracts in `packages/contracts`, `lucide-react`, `clsx`, and `tailwind-merge`. New dependencies are permitted only when they materially improve the design; current plan expects no new dependency because `@xyflow/react` already covers the flow map need.  
**Storage**: Existing SQLite through Prisma and current task/plan/run/artifact/event records. No new persisted data model is planned for the component-parity increment unless implementation proves a required visible field cannot be derived from existing records.  
**Testing**: Vitest and Testing Library for component/view-model behavior; Playwright for end-to-end workspace verification if interactions require browser coverage. Required proof commands: `bun run typecheck`, `bun run lint`, `bun run test`; targeted tests are listed in `quickstart.md`.  
**Target Platform**: Chrona web app served by Bun/Hono with Vite React SPA frontend.  
**Project Type**: Monorepo web application: `apps/web`, `apps/server`, `packages/contracts`, `packages/domain`, `packages/db`, `packages/runtime`, and provider packages.  
**Performance Goals**: Workspace first meaningful render remains under 1.5s on seeded sample task data; node selection, tab switching, flow zoom/center controls, and overview refresh feel responsive within 1 second for typical tasks up to 20 nodes and 20 artifacts; no material layout shift after task data resolves.  
**Constraints**: No Next.js patterns; no Node.js-only runtime paths; business logic must stay out of React components and Hono route handlers; shared schemas belong in `packages/contracts`; pure business rules belong in `packages/domain`; database access stays in `packages/db`; frontend SSE, if touched, must use `apps/web/src/lib/fetch-json-event-source.ts`; implementation should not retain old compatibility UI or old data-shaping patterns without a concrete shipped-data or external-consumer need.  
**Scale/Scope**: One task workspace page and immediate supporting components under existing task workspace and task graph component areas. Scope includes component-level functional parity with the reference image, not unrelated Chrona pages or pixel-perfect CSS polish.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan keeps presentation in `apps/web`, reusable UI derivation in pure helpers, shared contracts in `packages/contracts` only if needed, and avoids compatibility layers unless backed by a persisted or external-consumer need.
- **Testing**: PASS. Required coverage includes view-model/unit tests for state mapping and progress summaries, component tests for header/flow/details/overview states, and targeted browser or integration checks when actions cross routing or API boundaries. Proof commands: `bun run typecheck`, `bun run lint`, `bun run test`.
- **User Experience Consistency**: PASS. Feature intentionally revises task workspace structure to align with the reference while preserving Chrona terminology, shell navigation, accessible controls, loading/empty/error states, and existing task execution semantics.
- **Performance Budgets**: PASS. Budgets are defined in Technical Context and validated through targeted tests plus manual workspace verification during implementation. No new network round trip is allowed unless needed to satisfy a visible reference component.

## Project Structure

### Documentation (this feature)

```text
specs/003-task-workspace-components/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── task-workspace-component-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/web/
├── src/components/tasks/
│   ├── task-workspace-page.tsx
│   ├── task-workspace-header-card.tsx
│   ├── task-workspace-plan-section.tsx
│   ├── task-workspace-plan-content.tsx
│   ├── task-workspace-types.ts
│   ├── task-workspace-query.ts
│   ├── task-workspace-page.test.tsx
│   └── task-workspace-query.test.ts
├── src/components/task/panels/
│   └── task-plan-graph-panel.tsx
└── src/components/task/plan/task-plan-graph/
    ├── index.tsx
    ├── node-card.tsx
    ├── frame.tsx
    ├── legend.tsx
    ├── inspector.tsx
    ├── inspector-details.tsx
    ├── inspector-run-panel.tsx
    └── task-plan-graph.test.tsx

packages/contracts/
└── src/...

packages/domain/
└── src/...
```

**Structure Decision**: Use the existing monorepo structure and keep the first implementation inside the current task workspace and task graph component ownership areas. Add or adjust contract/domain files only if implementation needs a durable shared schema or pure state-mapping rule that cannot responsibly live in web-only view-model helpers.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved clarifications:

- Current stack is sufficient for this feature: React 19 + Vite + React Router 7 for the SPA, `@xyflow/react` for the execution flow, and existing test tooling for verification.
- No new UI library is planned. A new dependency may be introduced only if implementation proves it materially improves flow behavior, accessibility, or maintainability beyond existing dependencies.
- Compatibility code should not be preserved for the old workspace layout. Replace obsolete workspace sections with the execution-console structure while protecting persisted task data and current external contracts.
- Data should be derived from current task, plan, artifact, run, and activity sources first. Add a narrow read model only if a required visible component cannot be derived cleanly.
- The reference image is a functional component benchmark, not a CSS/pixel-perfect mandate.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/task-workspace-component-contract.md`, and `quickstart.md`.

Key design decisions:

- Define a `TaskWorkspaceComponentView` concept for the page-level view model: task header state, execution flow, selected-node detail, right-side overview, and navigation/account context.
- Keep execution state mapping pure and testable. React components should render state and dispatch existing actions; they should not own business rules for task progress or node status.
- Reuse `@xyflow/react` graph capabilities and existing graph components instead of adding a second graph renderer.
- Make old workspace content regions yield to the new reference-aligned component hierarchy rather than maintaining parallel legacy and new layouts.
- Document UI contract first; add server/API contracts only if implementation requires new data fields after auditing existing loader data.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design honors layer ownership, uses the smallest correct component/view-model changes, avoids speculative abstractions, and explicitly rejects legacy compatibility layout duplication.
- **Testing**: PASS. `quickstart.md` lists targeted validation for state mapping, header controls, flow states, node details, right-side overview, empty/error states, and responsive reachability.
- **User Experience Consistency**: PASS. The reference-aligned layout intentionally revises workspace structure while preserving Chrona terms, shell navigation expectations, accessible controls, and visible feedback states.
- **Performance Budgets**: PASS. View-model derivation from loaded data avoids avoidable network calls; graph interactions and node-detail changes remain bounded by the 1 second perceived-response budget.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
