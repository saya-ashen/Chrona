# Implementation Plan: Complete Test Coverage

**Branch**: `014-test-coverage` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-test-coverage/spec.md`

## Summary

Complete Chrona's practical behavior coverage by inventorying existing tests, then adding focused unit/domain tests, integration workflow tests, edge/error regression tests, and deterministic provider/external-dependency fixtures. The implementation will keep business behavior unchanged, prefer narrow test additions over production refactors, and reorganize tests only where clarity or independence improves.

## Technical Context

**Language/Version**: TypeScript strict, Bun runtime >=1.3.11  
**Primary Dependencies**: Vite + React 19 frontend, Hono API server, Prisma 7 SQLite adapter, provider bridge contracts, React Router 7, Testing Library, Playwright, MSW, fast-check, axe-core Playwright helper  
**Storage**: SQLite through Prisma for API/server/runtime integration tests; file-based provider response fixtures for deterministic AI/provider replay  
**Testing**: Vitest for frontend/component/pure TypeScript tests, Bun Test for Bun-only engine/API/provider/database tests, Playwright for browser workflows and viewport coverage  
**Target Platform**: Local and CI development on the Chrona monorepo, covering browser SPA, Hono server, engine/runtime packages, domain packages, and provider packages  
**Project Type**: Monorepo web application with frontend, backend API, domain/runtime packages, provider integrations, CLI packaging surfaces  
**Performance Goals**: Routine local validation should remain practical for contributor use; any large runtime increase must be documented with split commands or focused verification paths  
**Constraints**: No live network or third-party provider dependency in routine tests; no business-code refactor unless narrowly needed for testability; preserve current product behavior; provider fixtures record provider-level snapshots only  
**Scale/Scope**: Existing repository has frontend, server, contracts, db, domain, engine, graph-runtime, providers, and e2e areas; plan targets critical workflow and bug-prone coverage, not a global line-coverage percentage target

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan preserves ownership boundaries: domain behavior in domain/runtime packages, API workflows in server tests, browser journeys in e2e tests, provider behavior in provider/engine tests. Production code changes are allowed only for narrow testability without behavior change.
- **Testing**: PASS. Required coverage includes unit/domain, integration/API/runtime, provider contract/fixture replay, and e2e browser workflow checks. Required commands: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:bun`, `bun run test:api`, `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay`, and relevant `bun run test:e2e:*` commands when navigation/task/schedule browser flows are touched.
- **Frontend UX Evidence**: PASS with conditional evidence. If browser-facing workflow tests or UI behavior assertions are added or changed, use pre-edit observation and post-edit verification at desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
- **Product Behavior & API Scope**: PASS. Existing Chrona behavior is preserved. Backend API shape changes are out of scope unless a discovered defect requires a separately justified fix.
- **UX Clarity & Responsiveness**: PASS. Browser workflow coverage must preserve current task visibility, active node visibility, blocked/review state visibility, primary action discoverability, i18n patterns, and no mobile horizontal scrolling.
- **Performance Budgets**: PASS. No user-facing runtime performance risk expected. Test-suite budget is practical contributor runtime; substantial runtime growth must be documented with focused command alternatives.

## Project Structure

### Documentation (this feature)

```text
specs/014-test-coverage/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── test-coverage-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── server/src/__tests__/
│   ├── api/
│   └── bridge/
└── web/src/
    ├── components/**/__tests__/
    └── test/

e2e/specs/
├── *.spec.ts
└── accessibility-test-helpers.ts

packages/
├── contracts/src/**/*.bun.test.ts
├── db/src/**/*.bun.test.ts
├── domain/src/**/*.bun.test.ts
├── engine/src/modules/**/__tests__/*.bun.test.ts
├── engine/src/test/
├── graph-runtime/src/*.bun.test.ts
└── providers/**/src/**/*.bun.test.ts

docs/zh/testing.md
```

**Structure Decision**: Use the existing monorepo-aligned test layout. Add or reorganize tests beside the behavior they protect, use shared helpers under existing `test` or `__tests__` support directories, and keep provider replay fixtures under the engine test fixture area already created for this feature family.

## Complexity Tracking

No constitution violations or added architectural complexity are planned.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). Main decisions: keep the current multi-runner strategy, use deterministic external dependency substitutes, record provider-level response snapshots only, prioritize bug-prone execution/provider/schedule coverage, and treat final risk mapping as part of the deliverable.

## Phase 1 Design Summary

Design artifacts are complete:

- [data-model.md](./data-model.md): test inventory, behavior test, workflow test, regression test, provider response fixture, and coverage summary entities.
- [contracts/test-coverage-contract.md](./contracts/test-coverage-contract.md): coverage inventory, provider fixture, regression evidence, workflow evidence, and final report contracts.
- [quickstart.md](./quickstart.md): planning and validation workflow for implementing the coverage work.

## Post-Design Constitution Check

- **Code Quality**: PASS. Artifacts keep tests mapped to existing ownership boundaries and avoid production redesign.
- **Testing**: PASS. Plan defines full required command matrix and coverage levels.
- **Frontend UX Evidence**: PASS. Browser evidence remains conditional for browser workflow changes and is explicitly required before implementation when applicable.
- **Product Behavior & API Scope**: PASS. No API or user-facing behavior changes are planned.
- **UX Clarity & Responsiveness**: PASS. Viewport and state-visibility expectations are carried into contracts and quickstart.
- **Performance Budgets**: PASS. Test runtime budget and mitigation documentation are defined.
