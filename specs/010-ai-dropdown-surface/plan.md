# Implementation Plan: AI Dropdown Surface

**Branch**: `010-ai-dropdown-surface` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-ai-dropdown-surface/spec.md`

## Summary

Replace the existing context-aware AI sidebar with a single global top-bar AI dropdown that reflects current page assistant status, renders backend-derived quick actions, accepts short page-scoped requests, and routes all AI-generated mutations into page-owned proposal previews before confirmation. The implementation will migrate current sidebar contracts and page adapters into an Assistant Surface State model, keep page projections/events as the source of truth, and remove dropdown-based proposal confirmation in favor of schedule, task, graph, and workbench preview surfaces.

## Technical Context

**Language/Version**: TypeScript strict; React 19 SPA under `apps/web/`; Hono API server under `apps/server/`; Bun runtime  
**Primary Dependencies**: Vite, React Router 7, Hono, Prisma 7 SQLite adapter for Bun, `@chrona/contracts`, `@chrona/domain`, existing i18n and UI component primitives  
**Storage**: SQLite via existing Prisma/Bun data layer; no new persistence source for assistant surface state; proposal persistence only through existing event/projection/page data flows where applicable  
**Testing**: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`; focused unit/integration coverage for contracts, page surface aggregation, dropdown behavior, proposal routing, and no mutation before confirmation  
**Target Platform**: Chrona web app on desktop, tablet, and mobile web viewports  
**Project Type**: Vite + React web application with Hono backend and shared contracts/domain packages  
**Performance Goals**: Dropdown opens within 150 ms after trigger interaction under warm page data; assistant surface state resolution adds no more than one page-scoped backend request when data is not already available; no visible layout shift in top bar when summaries rotate  
**Constraints**: No ordinary global mutable store as source of truth; no hardcoded frontend quick actions; no complex diff in dropdown; all mutating AI output becomes a proposal; explicit page-level confirmation required before command handlers apply mutations; no mobile horizontal scrolling at 390x844  
**Scale/Scope**: Replace existing global AI sidebar usage for Schedule and Task workspace; add Workbench result surface contract for execution-result actions; unsupported pages show safe unavailable/no-actions state

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan keeps contracts in `packages/contracts`, pure mapping/priority rules in shared domain/service layers, backend aggregation in server route/service code, and React components focused on rendering and navigation. Complexity is limited to replacing the sidebar surface with an assistant surface model and page-owned preview routing.
- **Testing**: PASS. Required commands are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e` because task, schedule, workbench, and navigation flows are affected. Coverage must include contract schema tests, action mapping tests, dropdown rendering tests, page preview routing tests, and no-mutation-before-confirm tests.
- **Frontend UX Evidence**: PASS. Implementation tasks must start with `agent-browser` observation of current sidebar/top-bar behavior and end with screenshots/snapshots for desktop `1440x900`, tablet `1024x768`, and mobile `390x844` with no horizontal scroll.
- **Product Behavior & API Scope**: PASS. Existing schedule/task execution behavior stays intact except the AI entry changes from sidebar to dropdown. Backend/API changes are justified only to provide Assistant Surface State and proposal-oriented action results; visual polish must not create unrelated API changes.
- **UX Clarity & Responsiveness**: PASS. The dropdown must preserve existing Chrona navigation/top-bar patterns, use i18n strings, show loading/empty/disabled/error states, prioritize blocked/error/conflict summaries, and make primary action and review state visually obvious.
- **Performance Budgets**: PASS. Budgets are defined for dropdown open latency, assistant state lookup, summary rotation layout stability, and mobile responsiveness; validation belongs in quickstart and tasks.

## Project Structure

### Documentation (this feature)

```text
specs/010-ai-dropdown-surface/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── assistant-surface-state.md
│   ├── proposal-routing.md
│   └── ui-surface-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/server/
└── src/
    ├── api/                  # Assistant surface state/action endpoints or route handlers
    └── services/             # Page-state aggregation from existing projections/events

apps/web/
└── src/
    ├── app-shell.tsx         # Provider wiring for new assistant surface context if still needed for UI state
    ├── components/
    │   ├── control-plane-shell.tsx
    │   ├── assistant-surface/ # New top-bar dropdown trigger/menu components
    │   ├── schedule/          # Schedule timeline proposal preview routing
    │   └── tasks/workspace/   # Task config/graph/workbench proposal preview routing
    ├── i18n/                 # User-facing dropdown/action/proposal strings
    └── lib/                  # Page-scoped assistant client helpers, not source-of-truth stores

packages/contracts/
└── src/                      # AssistantSurfaceState, quick action, proposal routing contracts

packages/domain/
└── src/                      # Pure severity priority, action mapping, confirmability helpers
```

**Structure Decision**: Use the existing monorepo structure. Replace `apps/web/src/components/global-ai-sidebar/*` with an assistant dropdown surface and page preview routing; keep shared contracts in `packages/contracts`; keep pure priority/action mapping logic in `packages/domain`; keep backend aggregation under `apps/server/src` without creating a new persistent or mutable global truth source.

## Complexity Tracking

No constitution violations identified. No added project, framework, or global mutable state is planned.

## Phase 0 Research Summary

See [research.md](./research.md). Key decisions: Assistant Surface State replaces sidebar context, quick actions are generated from server/page-state mapping, dropdown owns only lightweight UI state, and all mutating outputs route to page-owned proposal previews.

## Phase 1 Design Summary

See [data-model.md](./data-model.md) and [contracts/](./contracts/). Key entities: AssistantSurfaceState, PageStatusSummary, AssistantQuickAction, AssistantProposal, ProposalRoute, PreviewSurface, and PageContextSnapshot.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design assigns ownership to contracts/domain/server/page components and avoids business logic inside React rendering components.
- **Testing**: PASS. Design identifies unit, integration, contract, component, and e2e tests plus required commands.
- **Frontend UX Evidence**: PASS. Quickstart requires pre-edit and post-edit `agent-browser` evidence at all mandated viewports.
- **Product Behavior & API Scope**: PASS. API changes are scoped to Assistant Surface State/action proposal contracts; dropdown cannot apply mutations.
- **UX Clarity & Responsiveness**: PASS. Contracts include priority severity, disabled reasons, preview surfaces, fallback states, and mobile constraints.
- **Performance Budgets**: PASS. Quickstart includes latency/layout/mobile validation; no unresolved budget remains.
