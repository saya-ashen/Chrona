# Tasks 019 — Plan-card redesign + accept-flow tests

Ordered, testable checklist derived from [`plan.md`](./plan.md). Each
task names the test/verification it satisfies and the acceptance item
(AC#) from [`spec.md`](./spec.md) §5 it advances.

Legend: **[CODE]** changes source; **[TEST]** adds/runs tests; **[GATE]**
a verification checkpoint.

---

## 019-1 — Spec scaffold + plan-state fixtures [CODE][TEST]
- [ ] Create `specs/019-plan-card-and-accept-tests/{spec,plan,tasks}.md`.
- [ ] Add `taskWorkspacePlanStateFixtures` to
      `apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts`
      with 4 entries: `planIdle`, `planGenerating`, `planWaitingAcceptance`,
      `planAccepted`. Each entry's `pageData` sets
      `task.aiPlanGenerationStatus` and (where appropriate)
      `task.savedPlan` with a `TaskPlanReadModel`-shaped object.
- **Test:** `bun run typecheck` resolves the new const; the existing
  13 fixtures in `taskWorkspaceStateFixtures` still pass.
- *(Advances: AC 3 (fixtures unblock tests).)*

## 019-2 — `resolveCurrentOperationCardSpec` + wrapper rewire [CODE]
- [ ] Add and export `resolveCurrentOperationCardSpec(planFlow, planSummary)`
      in `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`.
- [ ] Update the `WorkspaceSummaryCard` build block at lines 90-146 to
      feed the resolved spec instead of
      `input.attention ?? input.readiness`. The `eyebrow` prop stays
      `input.copy?.currentOperation ?? "Current operation"`.
- [ ] No change to `buildAcceptOrRegenerateSpec` (line 275+).
- **Test:** `bun run typecheck` passes.
- *(Advances: AC 1, AC 2.)*

## 019-A — Card spec test (4 states) [TEST]
- [ ] Create
      `apps/web/src/components/tasks/workspace/execution/__tests__/current-operation-card.spec.test.tsx`.
- [ ] 4 sub-tests, one per plan state. Each constructs an `input` for
      `buildCommandCenterNowSpec` and asserts the `status-card`
      `WorkspaceSummaryCard` props match the 4-row table in
      `plan.md` §1.
- **Test:** `bun test` (or vitest) — 4 pass.
- *(Advances: AC 1, AC 2.)*

## 019-B — Accept plan happy path [TEST]
- [ ] Create
      `apps/web/src/components/tasks/workspace/hooks/__tests__/accept-plan-happy-path.test.tsx`.
- [ ] 2 sub-tests: header card click + selected block sheet
      `acceptPlanById`. Mock `global.fetch` to return 202.
- **Test:** vitest — 2 pass.
- *(Advances: AC 3.)*

## 019-C — Accept plan error paths [TEST]
- [ ] Create
      `apps/web/src/components/tasks/workspace/hooks/__tests__/accept-plan-error-paths.test.tsx`.
- [ ] 3 sub-tests: 4xx, 5xx, network throw.
- **Test:** vitest — 3 pass.
- *(Advances: AC 3.)*

## 019-D — Accept plan race conditions [TEST]
- [ ] Create
      `apps/web/src/components/tasks/workspace/hooks/__tests__/accept-plan-race-conditions.test.tsx`.
- [ ] 2 sub-tests: double-click, 409 mid-flight.
- **Test:** vitest — 2 pass.
- *(Advances: AC 3.)*

## 019-E — Server route mocked-engine test [TEST]
- [ ] Create
      `apps/server/src/routes/tasks/__tests__/plan-accept-route.test.ts`.
- [ ] 2 sub-tests: 2xx path + engine rejection path.
- **Test:** bun — 2 pass.
- *(Advances: AC 3.)*

## 019-F — Workspace rerender after accept [TEST]
- [ ] Create
      `apps/web/src/components/tasks/workspace/page/__tests__/workspace-rerender-after-accept.test.tsx`.
- [ ] 1 sub-test: full page re-render with mocked accept route.
- **Test:** vitest — 1 pass.
- *(Advances: AC 3.)*

## 019-G — Provider generate-plan replay [TEST]
- [ ] Create
      `packages/providers/claude-code/src/__tests__/claude-code-generate-plan-run-replay.test.ts`.
- [ ] Build a synthetic `plan-generation.jsonl` fixture in `beforeAll`
      (write to `os.tmpdir()` via `Bun.write`). Mirror
      `tool-call-roundtrip.jsonl` but with the `chrona_plan_generate`
      tool call.
- [ ] Single `it`: drive the provider, assert `run_completed` terminal,
      `tool_result.tool === "chrona_plan_generate"`, and
      `terminalSnapshotFromEvents(...).status === "completed"`.
- **Test:** bun — 1 pass.
- *(Advances: AC 3, AC 4.)*

## 019-Verify — Green gate [GATE]
- [ ] All new tests wired into `bun run test:ci`.
- [ ] **[GATE]** `bun run typecheck`, `bun run lint` (no new warnings),
      `bun run check:boundaries`, `bun run test:ci` all green.
- [ ] Commit on `spec-019-plan-card-and-accept-tests` branch.
- *(Advances: AC 1, AC 2, AC 3, AC 4.)*

## 019-Evidence — Manual screenshots [GATE]
- [ ] Capture 4 PNGs of the card variants in
      `specs/019-plan-card-and-accept-tests/evidence/`.
- [ ] Capture `accept-flow-test-output.txt` and
      `provider-replay-trace.txt`.
- *(Advances: AC 5.)*

---

## Verification matrix (maps to spec §5)

| Task | Spec AC satisfied | Evidence |
| --- | --- | --- |
| 019-2, 019-A | AC 1 — 4 distinct variants | `current-operation-card.spec.test.tsx` + screenshots |
| 019-2 | AC 2 — wrapper-only edit | git diff scoped to `apps/web/.../build-execution-overview-spec.ts` |
| 019-1, 019-B, 019-C, 019-D, 019-E, 019-F, 019-G | AC 3 — deterministic test coverage | 7 test files, ~15 cases |
| 019-Verify | AC 4 — gates green | CI run link |
| 019-Evidence | AC 5 — manual screenshots | 4 PNGs under `evidence/` |

## Definition of Done (all must hold)
- All 4-state variants implemented in the wrapper, not the canonical
  builder.
- All ~15 new test cases pass.
- No new dependencies, no provider source changes, no Accept button
  moves.
- `bun run typecheck` / `bun run lint` / `bun run check:boundaries` /
  `bun run test:ci` all green.
- 4 manual screenshots + 2 trace files committed under `evidence/`.
