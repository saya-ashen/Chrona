# Implementation Plan: External Calendar Connections

**Branch**: `015-external-calendar` | **Date**: 2026-05-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-external-calendar/spec.md`

## Summary

Add read-only external calendar subscription support so Chrona users can connect webcal-style or downloadable calendar feeds, import upcoming busy blocks, and view them in planning/schedule contexts without converting them into tasks. The implementation will add shared contracts, domain/integration parsing and normalization, database-backed calendar source/event persistence, Hono API routes, and schedule UI/source-management surfaces while deferring Google/Outlook OAuth to a later feature.

## Technical Context

**Language/Version**: TypeScript strict, Bun runtime >=1.3.11  
**Primary Dependencies**: Vite + React 19 frontend, React Router 7, Hono API server, Prisma 7 SQLite adapter, Zod contracts, existing shadcn/ui foundation, FullCalendar packages already present, planned pure TypeScript iCalendar parser dependency or small integration wrapper after package evaluation  
**Storage**: SQLite through Prisma; add workspace-owned calendar source, imported event, and sync-status fields with privacy-safe source URL handling  
**Testing**: Vitest for frontend/component and pure TypeScript tests, Bun Test for Bun-only domain/integration/API/database tests, Playwright for schedule/navigation/browser evidence  
**Target Platform**: Chrona monorepo web application: browser SPA under `apps/web/`, Hono/Bun API under `apps/server/`, shared packages under `packages/`  
**Project Type**: Monorepo web application with frontend, backend API, shared contracts, domain/integration packages, and database package  
**Performance Goals**: Add/save calendar source completes in under 2 seconds for normal feeds; planning view stays responsive with 5 sources and 500 visible imported events; refresh avoids blocking unrelated task/schedule interactions  
**Constraints**: Read-only subscription feeds only for this feature; no Google/Outlook OAuth; no live third-party dependency in routine tests; private calendar URLs must not be returned to browser after setup; business logic must stay out of React components and route handlers; mobile schedule views must not horizontally scroll  
**Scale/Scope**: First release covers source add/validate/list/update/delete, manual refresh, event import for upcoming planning range, schedule display, error/status states, and source management for one authenticated Chrona user/workspace context

No unresolved technical clarifications remain. Research decisions are recorded in [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Layer boundaries are explicit: contracts in `packages/contracts`, calendar parsing/normalization in `packages/integrations`, pure scheduling/busy-block rules in `packages/domain`, persistence in `packages/db`/Prisma, routes/services in `apps/server`, and UI composition/state in `apps/web`. No speculative OAuth/provider abstraction is included.
- **Testing**: PASS. Required coverage includes contract/schema tests, parser/normalizer unit tests, database persistence tests, API integration tests, schedule view/component tests, and e2e coverage for source setup plus schedule display. Required commands: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:bun`, `bun run test:api`, `bun run check:ui-foundation`, and `bun run test:e2e:desktop`, `bun run test:e2e:tablet`, `bun run test:e2e:mobile` because schedule/navigation UI is affected.
- **Frontend UX Evidence**: PASS. Implementation must use `agent-browser` before UI edits and after edits, capturing desktop `1440x900`, tablet `1024x768`, and mobile `390x844` evidence for source management and schedule views.
- **Product Behavior & API Scope**: PASS. Existing task scheduling, execution, active node, blocked/review, and primary-action behavior must remain unchanged. Backend API changes are justified by new external calendar data and must not alter unrelated task or execution contracts.
- **UX Clarity & Responsiveness**: PASS. Use existing schedule page patterns, shadcn primitives, existing i18n message structure, explicit read-only/source/error states, and mobile layouts with no horizontal scrolling.
- **Performance Budgets**: PASS. Source validation/save under 2 seconds for normal feeds, planning view responsive with 5 sources and 500 visible events, refresh isolated from unrelated schedule/task interactions, and database queries scoped by workspace/source/date range.

## Project Structure

### Documentation (this feature)

```text
specs/015-external-calendar/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── external-calendar-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── server/src/
│   ├── routes/
│   ├── services/
│   └── __tests__/api/
└── web/src/
    ├── components/schedule/
    ├── components/ui/
    ├── lib/
    └── test/

packages/
├── contracts/src/
├── db/src/
├── domain/src/
└── integrations/src/

prisma/
└── schema.prisma

e2e/specs/
```

**Structure Decision**: Use the existing monorepo layout. Add shared request/response schemas to contracts, source/event persistence to Prisma/db, feed fetch/parse/normalize logic to integrations/domain services, route orchestration to the Hono server, and UI/state composition to the existing schedule feature area.

## Complexity Tracking

No constitution violations or added architectural complexity are planned.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). Main decisions: start with read-only calendar subscription feeds, normalize external events into workspace-scoped busy blocks, store source URLs server-side with redacted browser responses, implement deterministic refresh/status handling, and defer authenticated provider OAuth.

## Phase 1 Design Summary

Design artifacts are complete:

- [data-model.md](./data-model.md): calendar source, imported event, sync status, busy block, and source action entities.
- [contracts/external-calendar-contract.md](./contracts/external-calendar-contract.md): API, UI, sync, privacy, and validation contracts.
- [quickstart.md](./quickstart.md): implementation and validation workflow.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design keeps parsing, normalization, persistence, API orchestration, and UI composition in their owning layers.
- **Testing**: PASS. Contract, unit, integration, API, component, browser, and viewport validation are required before completion.
- **Frontend UX Evidence**: PASS. Browser evidence is mandatory for affected calendar setup and schedule surfaces.
- **Product Behavior & API Scope**: PASS. API changes are scoped to new calendar source/event behavior and preserve unrelated task/execution contracts.
- **UX Clarity & Responsiveness**: PASS. Read-only, source, sync, empty, loading, error, and destructive states are explicit, with no mobile horizontal scrolling.
- **Performance Budgets**: PASS. Save/refresh/schedule budgets and workspace/date-range scoping are defined.
