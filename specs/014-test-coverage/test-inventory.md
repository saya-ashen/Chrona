# Test Inventory: Complete Test Coverage

## Inventory Contract

| Area | Existing tests | Covered workflows | Known gaps | Planned action | Priority |
|------|----------------|-------------------|------------|----------------|----------|
| Frontend | `apps/web/src/**/*.test.ts(x)`, `apps/web/src/test/ui-foundation-guard.test.ts` | Component rendering, hooks, UI foundation guardrails, shared React Query helpers, task workspace MSW refresh/error workflows, selected-block sheet open-state regression | No remaining P1 frontend regression gap after US3; full command matrix remains Phase 7 | add | P1 |
| Server API | `apps/server/src/__tests__/api/*.bun.test.ts` | Task CRUD, plan lifecycle, schedule proposals, workflow-style route behavior, task validation edges, plan lifecycle conflicts, schedule conflict decisions, provider malformed execution workflow, duplicate schedule decision regression | No remaining P1 API workflow gap after US3; full command matrix remains Phase 7 | add | P1 |
| Domain | `packages/domain/src/**/*.bun.test.ts` | Task state derivation, static state, plan validation, AI proposal state, task/plan/schedule boundary matrices | No remaining P1 pure domain gap after US1; workflow coverage is represented by US2/API tests | add | P1 |
| Engine/runtime | `packages/engine/src/modules/**/*.bun.test.ts`, `packages/engine/src/test/*.bun.test.ts` | AI plan generation, node capability routing, fixture replay smoke coverage, execution state invariants, duplicate execution, stop/pause, and serial branch regressions | No remaining P1 execution regression gap after US3; full command matrix remains Phase 7 | add | P1 |
| Graph runtime | `packages/graph-runtime/src/*.bun.test.ts` | Execution guards, graph execution, branch behavior, replayed node constraints, invalid transitions | No remaining P1 pure graph-runtime gap after US1; workflow interactions remain covered by engine/API tests | add | P1 |
| Provider | `packages/providers/**/src/**/*.bun.test.ts`, `packages/engine/src/test/llm-fixtures.bun.test.ts` | Provider transport/feature behavior, deterministic cassette replay, provider response parsing, malformed provider failure propagation through execution API, replayed provider failure snapshots | No remaining P1 fixture replay regression gap after US3; full LLM replay command remains Phase 7 | add | P1 |
| Database | `packages/db/src/**/*.bun.test.ts`, server API workflow tests using Prisma SQLite | Persistence behavior through API and db package tests | No new database helper needed unless workflow tests expose missing fixture setup | no-change | P2 |
| Contracts | `packages/contracts/src/**/*.bun.test.ts` | API task schemas, MCP task tools, task/plan boundary schemas | No remaining P1 schema gap after US1; workflow contract evidence remains in API tests | add | P1 |
| E2E | `e2e/specs/*.spec.ts` | Control plane, schedule, task workspace layout, demo/readme journeys, task workspace desktop/tablet/mobile responsive flow, body/document no-horizontal-scroll assertions | Full e2e command matrix remains Phase 7 validation | add | P1 |

## Update Rules

- Add a row or update `Known gaps` when a new uncovered behavior is discovered.
- Move a gap into `Covered workflows` only after a deterministic test and validation command exist.
- Any remaining P1 gap must also appear in `coverage-summary.md` as a residual risk with a recommended next step.
