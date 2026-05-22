# Implementation Plan: Test Coverage

**Branch**: `006-test-coverage` | **Date**: 2026-05-15 | **Spec**: `specs/006-test-coverage/spec.md`
**Input**: Feature specification from `specs/006-test-coverage/spec.md`

## Summary

Add complete automated coverage for Chrona's current plan-to-execution capability, with emphasis on complex plan graph safety, checkpoint regression protection, and task workspace UI usability. The implementation should extend existing test surfaces rather than introduce a parallel test system: Bun tests for server/runtime and graph execution, Vitest/jsdom tests for React view-model and component states, and Playwright tests for full user journeys, responsive layout, accessibility-relevant interactions, and diagnostic evidence.

## Technical Context

**Language/Version**: TypeScript strict; Bun >=1.3.11 runtime; React 19 with Vite for the web workspace; Hono server under Bun.  
**Primary Dependencies**: Existing Vitest/jsdom setup, Bun test runner, Playwright, Testing Library, Hono API test helpers, engine plan-execution modules, contracts schemas, and existing task workspace components. No new test framework is planned.  
**Storage**: Existing SQLite/Prisma local database for API and e2e flows; seeded or isolated local test data for repeatable task, plan, graph, checkpoint, and execution scenarios.  
**Testing**: `bun run test` for Vitest UI/unit coverage, `bun run test:bun` and `bun run test:api` for Bun runtime/API coverage, `bun run test:e2e` for Playwright flows, plus `bun run typecheck` and `bun run lint` for release gates.  
**Target Platform**: Local Chrona monorepo development environment: Vite web app, Bun/Hono API server, engine packages, provider integrations, and Playwright-controlled browser sessions.  
**Project Type**: Vite + React SPA, Hono/Bun API server, SQLite/Prisma persistence, TypeScript packages for contracts/domain/db/engine/providers.  
**Performance Goals**: Primary functional and interface test suites complete within 10 minutes locally; complex graph scenarios remain deterministic across repeated runs; UI checks capture visible failures within one test report without requiring manual reproduction first.  
**Constraints**: No Next.js patterns; Bun-compatible runtime only; business logic stays out of React components and Hono route handlers; shared schemas remain in `packages/contracts`; pure rules remain in `packages/domain`; database access remains in `packages/db`; Hermes-specific behavior remains under `packages/providers/hermes`; SSE logic in `apps/web` must keep using the shared fetch-event-source helper.  
**Scale/Scope**: Covers core Chrona task creation, plan generation, plan graph execution, checkpoints, retries, blocked/failure paths, partial progress recovery, and task workspace UI states. Scope excludes broad UI redesign, replacing agent providers, or exhaustive graph-theory validation beyond product-relevant scenarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. The plan keeps tests near the behavior they prove: graph/runtime coverage in engine/server layers, schema expectations in contracts, and UI state/layout coverage in web/e2e layers. No production behavior or provider boundary changes are required by planning.
- **Testing**: PASS. This feature is itself test coverage. Required levels include unit/view-model tests, integration/API tests, graph runtime tests, provider regression tests where checkpoint evidence is involved, and Playwright end-to-end UI checks. Proof commands are listed in Technical Context.
- **User Experience Consistency**: PASS. Interface tests preserve current Chrona visual language and workflow terminology, and report issues in loading, empty, executing, blocked, failed, completed, retry, desktop, mobile, keyboard, and accessible-name states.
- **Performance Budgets**: PASS. Test suite budget is explicit: primary functional and interface checks should complete within 10 minutes locally, with deterministic results for at least 95% of scenarios.

## Project Structure

### Documentation (this feature)

```text
specs/006-test-coverage/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── test-coverage-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
packages/contracts/
└── src/                  # Shared task, plan, graph, checkpoint, and API schemas under test

packages/domain/
└── src/                  # Pure task/plan state rules and graph validation behavior under test

packages/engine/
└── src/modules/
    ├── plan-execution/   # Complex graph, checkpoint, retry, blocked, failure, and recovery tests
    ├── plans/            # Plan generation/materialization tests
    └── tasks/            # Task lifecycle and runnability tests

apps/server/
└── src/__tests__/api/    # API-level plan generation, execution, checkpoint, and persistence flows

apps/web/
└── src/components/tasks/ # Task workspace view-model, graph, execution, and state component tests

e2e/specs/
└── task-workspace*.spec.ts # Browser workflow, responsive layout, usability, and diagnostics checks

scripts/
└── run-*.ts              # Existing test command orchestration reused when needed
```

**Structure Decision**: Use existing monorepo test ownership and runner commands. Add or extend tests in the package/app that owns the behavior being verified, with Playwright reserved for full workflow and layout assertions that require a browser.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved clarifications:

- Existing tooling is sufficient: Vitest/jsdom, Bun test, API test scripts, and Playwright already exist and should be reused.
- Complex graph coverage belongs primarily around `packages/engine/src/modules/plan-execution/` and API lifecycle tests, with contract/schema checks where graph payload shapes are validated.
- The checkpoint regression should be tested by asserting the legacy message never appears in successful supported checkpoint flows and becomes diagnostic evidence if it appears in logs, visible errors, or result payloads.
- UI usability/layout validation needs both component-level state coverage and browser-level assertions for desktop/mobile viewport behavior.
- Repeatability requires seeded or isolated test data, named scenarios, and reports that distinguish setup failure from Chrona product failure.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/test-coverage-contract.md`, and `quickstart.md`.

Key design decisions:

- Define a `Test Scenario` catalog grouped into core flow, complex graph, checkpoint regression, recovery, and interface usability suites.
- Keep scenario fixtures explicit and deterministic: graph topology, node states, checkpoint result shape, expected transitions, expected visible states, and diagnostic evidence.
- Use API/engine tests to prove state correctness and Playwright tests to prove user-visible flow, responsive layout, and accessibility-relevant behavior.
- Treat UI tests as product checks, not visual redesign approvals: failures should identify hidden actions, clipped content, overlap, unclear state messaging, or unreachable controls.
- Require every high-risk regression test to capture evidence: scenario name, expected state, actual state, visible text, logs or screenshots where applicable.
- Preserve current runner entry points so the feature can be validated through existing local and CI-style commands.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design avoids new architecture and keeps tests aligned with current layer ownership. Shared fixtures and contracts are documentation/test assets, not a new business path.
- **Testing**: PASS. Plan defines coverage by runner and behavior level, including regression coverage for the known Hermes checkpoint error and complex plan graph scenarios.
- **User Experience Consistency**: PASS. UI checks enforce existing terminology, primary action visibility, responsive layout, keyboard reachability, and clear state feedback.
- **Performance Budgets**: PASS. Quickstart keeps the 10 minute local suite budget and deterministic-run expectation from the spec.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
