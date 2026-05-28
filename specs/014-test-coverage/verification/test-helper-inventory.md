# Shared Test Helper Inventory

| Helper area | Existing file | Reuse decision |
|-------------|---------------|----------------|
| React Query render helper | `apps/web/src/test/fixtures.ts` | Reuse `createTestQueryClient()` and `renderWithQueryClient()` for component tests that need query state. Add tests for retry-disabled defaults and provider wrapping. |
| Frontend MSW server | `apps/web/src/test/msw/server.ts` | Reuse shared server, but each test file must explicitly call `server.listen()`, `server.resetHandlers()`, and `server.close()`. |
| Bun API helpers | `apps/server/src/__tests__/bun-test-helpers.ts` | Reuse database reset/seed helpers for API workflow tests; do not import full production route graph when inline route handlers are enough. |
| Engine compiled-plan builders | `packages/engine/src/test/builders.ts` | Reuse for execution/runtime tests; add deterministic metadata coverage before story tests depend on it. |
| LLM fixture recorder | `packages/engine/src/test/llm-fixture-recorder.ts` | Reuse record/replay/off modes; add guardrail tests for cassette paths, sanitizer hooks, and replay behavior. |
| E2E accessibility helper | `e2e/specs/accessibility-test-helpers.ts` | Reuse for browser workflow accessibility assertions where viewport task flows are touched. |

Decision: add targeted tests for helpers instead of introducing new helper layers.
