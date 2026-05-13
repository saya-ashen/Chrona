# Implementation Plan: Task Workspace UI Functionality

**Branch**: `004-task-workspace-ui` | **Date**: 2026-05-13 | **Spec**: `specs/004-task-workspace-ui/spec.md`
**Input**: Feature specification from `specs/004-task-workspace-ui/spec.md`

## Summary

Chrona will audit the existing task workspace UI, classify every visible interactive component by whether it works, should be wired to real behavior, should be disabled with a clear reason, or should be removed, then implement the smallest set of frontend, contract, domain, and server changes needed so no visible control is decorative or dead. The plan builds on the task workspace component parity work from `specs/003-task-workspace-components`: keep the existing Vite React workspace, React Router data flow, Hono API, shared contracts, domain boundary, and current task execution data; add narrow action contracts or backend handlers only where a retained UI action needs durable behavior.

## Technical Context

**Language/Version**: TypeScript strict; React 19; Bun >=1.3.11; Vite SPA frontend; Hono API backend.  
**Primary Dependencies**: Existing React Router 7, Testing Library, Vitest, Playwright when browser coverage is needed, Hono, Prisma 7 with `prisma-adapter-bun-sqlite`, Zod contracts in `packages/contracts`, `@xyflow/react` for the task flow map, `lucide-react`, `clsx`, and `tailwind-merge`. No new dependency is planned.  
**Storage**: Existing SQLite through Prisma and current task, plan, run, artifact, approval, and activity records. New persistence is not planned unless implementation finds a retained action has no existing durable state.  
**Testing**: Vitest and Testing Library for component, hook, and view-model behavior; server/contract tests for any new or changed action endpoint; Playwright for end-to-end workspace action validation if component tests cannot prove user behavior. Required proof commands: `bun run typecheck`, `bun run lint`, `bun run test`.  
**Target Platform**: Chrona web app served by Bun/Hono with Vite React SPA frontend.  
**Project Type**: Monorepo web application: `apps/web`, `apps/server`, `packages/contracts`, `packages/domain`, `packages/db`, `packages/runtime`, and provider packages.  
**Performance Goals**: Workspace first meaningful render remains within the existing 1.5s target on seeded task data; ordinary visible actions show feedback within 1 second and complete or report failure within 3 seconds under normal local conditions; removing unused components must not add extra workspace network round trips.  
**Constraints**: No Next.js patterns; no Node.js-only runtime paths; business logic must stay out of React components and Hono route handlers; shared API contracts and Zod schemas belong in `packages/contracts`; pure business rules belong in `packages/domain`; database access stays in `packages/db`; frontend SSE, if touched, must use `apps/web/src/lib/fetch-json-event-source.ts`; remove obsolete UI/data-shaping paths instead of keeping compatibility code without a concrete persisted-data or external-consumer need.  
**Scale/Scope**: One existing task workspace page and immediate supporting task workspace components, helpers, tests, and narrow backend APIs if required. Scope excludes unrelated Chrona pages, speculative future workflow controls, and pixel-perfect redesign beyond preserving current product visual language.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan keeps UI rendering in `apps/web`, shared contracts in `packages/contracts` only when needed, pure action availability/state rules in testable helpers or `packages/domain` when shared, and database/server behavior out of React. Complexity is limited by removing dead components rather than preserving legacy compatibility paths.
- **Testing**: PASS. Required coverage includes UI inventory tests, action success/failure tests, disabled-state tests, empty/loading/error-state tests, contract/server tests for changed APIs, and proof commands `bun run typecheck`, `bun run lint`, and `bun run test`.
- **User Experience Consistency**: PASS. Feature preserves Chrona task workspace terminology, layout language from the component-parity work, accessible controls, keyboard reachability, and consistent loading/empty/success/error feedback while removing misleading affordances.
- **Performance Budgets**: PASS. Budgets are explicit in Technical Context: feedback within 1 second, completion/failure within 3 seconds, preserve 1.5s first meaningful render target, and no unnecessary extra workspace round trips.

## Project Structure

### Documentation (this feature)

```text
specs/004-task-workspace-ui/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── task-workspace-action-contract.md
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
    ├── inspector.tsx
    ├── inspector-details.tsx
    ├── inspector-run-panel.tsx
    └── task-plan-graph.test.tsx

apps/server/
└── src/...

packages/contracts/
└── src/...

packages/domain/
└── src/...

packages/db/
└── src/...
```

**Structure Decision**: Use the existing monorepo task workspace ownership areas. Start with an audit of current task workspace components and tests in `apps/web`; add contract, domain, server, or database files only for retained actions that need shared validation, business rules, or persisted behavior.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved clarifications:

- Current stack is sufficient for functionalizing the task workspace UI. No new dependency is required for action wiring, disabled-state feedback, removal of dead controls, or state tests.
- The action inventory is the implementation source of truth: every visible interactive component must be classified and then wired, disabled with reason, or removed.
- Existing task workspace data and action paths must be reused first. New backend endpoints are allowed only when a retained visible action cannot be completed through current contracts.
- Dead future-facing controls should be removed rather than hidden behind compatibility code or shipped as inactive affordances.
- Testing must prove both presence and absence: retained controls work, unavailable controls explain why, and removed controls no longer render.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/task-workspace-action-contract.md`, and `quickstart.md`.

Key design decisions:

- Define a `WorkspaceActionInventory` to map each visible interactive component to owner, current status, expected behavior, availability rules, and implementation decision.
- Define a `WorkspaceActionContract` for retained controls: trigger, required state, success feedback, failure feedback, disabled reason, and freshness behavior.
- Keep action availability and status derivation testable outside React render bodies. React components should render the derived contract and dispatch existing or narrowly added actions.
- Add or change Hono APIs only for actions that require server-side state changes. Any new contract must live in `packages/contracts`, with business rules outside route handlers and persistence access in `packages/db`.
- Remove redundant components from the workspace layout instead of leaving no-op buttons, inactive menu items, placeholder tabs, or decorative clickable regions.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design maintains layer boundaries, keeps business rules testable, and treats deletion of dead UI as the default for controls without current user value.
- **Testing**: PASS. `quickstart.md` defines required proof for inventory coverage, retained action behavior, failure paths, disabled states, removed components, responsive reachability, and standard repo validation commands.
- **User Experience Consistency**: PASS. Contracts require clear disabled reasons, visible progress, success/failure feedback, current terminology, accessibility, and no misleading controls.
- **Performance Budgets**: PASS. Action contracts preserve 1 second feedback and 3 second completion/failure budgets, and new server round trips require a retained action need.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
