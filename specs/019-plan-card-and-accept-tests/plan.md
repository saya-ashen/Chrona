# Plan 019 — Implementation roadmap

> Concrete file-level task list. Read [`spec.md`](./spec.md) first for the
> problem, goal, and non-goals.

---

## 0. Verified facts (read this before coding)

- `WorkspaceSummaryCard` props at
  `packages/ui-protocol/src/catalog/components.ts:196` —
  `eyebrow?, title, description?, statusLabel?, sourceLabel?, tone, icon?:
  "sparkles" | "archive" | "file" | "warning" | "check"`.
- `buildCommandCenterNowSpec` has TWO definitions:
  - Canonical builder:
    `packages/ui-protocol/src/builders/build-command-center-spec.ts:69`
  - Web wrapper (the one the page calls):
    `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts:90-146`.
    The redesign edits the **wrapper**, NOT the canonical builder.
- `acceptPlanById` at
  `apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-state.ts:160-170`.
  It calls
  `dispatchWorkspaceCommand(task.id, { type: "plan.accept", planId, workBlockId })`,
  then `setPlanFlow(completePlanAccept(plan))` on 2xx or
  `setPlanFlow(failPlanAccept(current, planId, cause.message))` on throw.
- `TaskPlan.status` enum: `Draft | Accepted | Superseded | Archived` at
  `prisma/schema.prisma:147, 450`.
- Server route: `POST /api/tasks/:taskId/plan/accept` at
  `apps/server/src/routes/tasks/plan.routes.ts:124-138` →
  `engine.tasks.plan.accept({ taskId, planId, workspaceId, workBlockId })`.
- Plan-arrival MCP tool (verified): `chrona_plan_generate` (canonical
  short form; the long form is `chrona.plan.generate`). Engine reads
  `aiPlanGenerationStatus` at
  `packages/engine/src/modules/plans/task-planning.ts:42`.
- `TaskData` already declares `savedPlan?: TaskPlanReadModel | null` and
  `aiPlanGenerationStatus?: TaskPlanGenerationStatus` (optionals) at
  `apps/web/src/components/tasks/workspace/model/task-workspace-types.ts:54, 57`.
- `TaskPlanReadModel` at
  `packages/contracts/src/plan-runtime/execution-state.ts:298` —
  fields: `id, status, revision, prompt, summary, updatedAt, generatedBy,
  blueprint, compiledPlan, effectivePlan`. The `blueprint`,
  `compiledPlan`, `effectivePlan` sub-objects are large. **Fixture
  strategy**: the page query only reads `savedPlan` *presence* and
  `savedPlan.status` (see
  `apps/web/src/components/tasks/workspace/model/task-workspace-query.ts:462-463`).
  Fixtures supply minimal legal shapes; the unused sub-objects are
  `as unknown as <Type>` cast to keep type-check passing without
  hand-writing 200+ lines of graph data per fixture.
- Existing fixtures: 13 in
  `apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts`.
  None set `task.aiPlanGenerationStatus`. The `idle` fixture is usable as
  a template.
- Pre-existing teardown race in
  `use-task-workspace-plan-state.accept-refresh.test.tsx` is **owned by
  WS-A** (documented in `specs/017-provider-claude-code/tasks.md` "T10
  evidence" section). This spec must NOT make it worse.

---

## 1. 4-state card variants (visual decisions)

The wrapper at
`apps/web/.../build-execution-overview-spec.ts:90-146` is the slot.
Per state, the wrapper feeds a different
`{title, description, statusLabel, tone, icon}` derived from the plan
flow state. All other card props (eyebrow =
`input.copy?.currentOperation ?? "Current operation"`, the surrounding
`Stack`, spacing) stay as-is.

| State                | `icon`     | `tone`    | `title`                  | `description`                                                                                                              | `statusLabel`            |
| -------------------- | ---------- | --------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `idle`               | `sparkles` | `info`    | "No plan yet"            | "Generate a plan to start this task."                                                                                      | "Idle"                   |
| `generating`         | `sparkles` | `info`    | "Generating plan…"       | active instruction (if any) else "Chrona is drafting a plan for this task."                                                | "Generating"             |
| `waiting_acceptance` | `sparkles` | `info`    | "Plan ready for review"  | first 120 chars of `savedPlan.summary` (truncated with `…`) else "Review the generated plan and accept it to enable execution." | "Waiting for acceptance" |
| `accepted`           | `check`    | `success` | "Plan accepted"          | "Execution will start when the block is due."                                                                              | "Accepted"               |

Decisions:

- Icon: `sparkles` for the first three (matches existing fallback) +
  `check` for accepted to mark completion. No new icons needed.
- Tone: only `info` and `success`. Accept-error tone is already handled
  by the sibling `<Alert type="error">` rendered by
  `buildAcceptOrRegenerateSpec` (line ~333).
- Spinner for `generating`: yes — the primary action
  (`resolveCommandCenterPrimaryAction` → `kind: "generate"`) already
  sets `isLoading: true, disabled: true` for `isGeneratingPlan`. No new
  dep.
- Elapsed time: NO — would require a timer dep, not justified.
- Narrow viewport: rely on the existing responsive `Stack` at the
  wrapper. No new primitive.
- New primitives: NONE. Reuse `WorkspaceSummaryCard` + `Stack` + `Text`
  + `Badge` + `Button` + `Alert`.
- `waiting_acceptance` Accept/Regenerate buttons stay OUTSIDE the card,
  rendered by `buildAcceptOrRegenerateSpec`. No duplication.

## 2. Files to modify (exact changes)

### 2.1 `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`
- Add (and export) a new pure helper:
  ```ts
  export function resolveCurrentOperationCardSpec(input: {
    planFlow: TaskWorkspacePlanFlowState;
    planSummary: string | null;
  }): {
    title: string;
    description: string;
    statusLabel: string;
    tone: "info" | "success";
    icon: "sparkles" | "check";
  }
  ```
  Implementation follows the 4-row table above. Truncates `planSummary`
  to 120 chars with `…` if longer. Pure, no React, no IO.
- Update the `WorkspaceSummaryCard` build block at lines 90-146 to feed
  the resolved spec instead of `input.attention ?? input.readiness`. The
  `eyebrow` prop stays
  `input.copy?.currentOperation ?? "Current operation"`. All other
  elements (`primary-action`, `primary-button`, `live-stack`) stay
  unchanged.
- No change to `buildAcceptOrRegenerateSpec` (line 275+) and no change
  to `buildArtifactsSpec`.

### 2.2 `apps/web/src/components/tasks/workspace/model/task-workspace-primary-action.ts`
- No change. The 5 existing kinds already cover all 4 plan states.

### 2.3 `apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts`
- Add a new exported const:
  ```ts
  export const taskWorkspacePlanStateFixtures = {
    planIdle: { pageData: ..., graphPlan: ... },
    planGenerating: { pageData: ..., graphPlan: ... },
    planWaitingAcceptance: { pageData: ..., graphPlan: ... },
    planAccepted: { pageData: ..., graphPlan: ... },
  };
  ```
  Each `pageData` is
  `createTaskWorkspaceFixturePageData({ task: { aiPlanGenerationStatus: "...", savedPlan: ... } })`.
  `planWaitingAcceptance` and `planAccepted` include a `savedPlan` with
  `id: "plan-1"`, `status: "draft" | "accepted"`, `summary: "..."`, plus
  the other `TaskPlanReadModel` required fields. The unused
  `blueprint` / `compiledPlan` / `effectivePlan` sub-objects are cast
  via `as unknown as <Type>` to keep the type-check passing without
  hand-writing 200+ lines of graph data.
  The existing 13 fixtures in `taskWorkspaceStateFixtures` stay
  untouched.

### 2.4 `apps/server/src/routes/tasks/plan.routes.ts`
- No change to the route. The test (item §4.5 below) mocks the engine
  boundary.

### 2.5 `packages/providers/claude-code/src/ClaudeCodeProviderClient.bun.test.ts` + new fixture file
- New test file:
  `packages/providers/claude-code/src/__tests__/claude-code-generate-plan-run-replay.test.ts`
  (Bun, single `it`).
- New synthetic fixture (in-memory, written to `os.tmpdir()` via
  `Bun.write` in `beforeAll`):
  `packages/providers/claude-code/src/__tests__/fixtures/plan-generation.jsonl`.
  Contents mirror the structure of `tool-call-roundtrip.jsonl` but with:
  - `system` event: instructions for `generate_plan`.
  - `assistant` event: a `tool_use` block with
    `name: "chrona_plan_generate"` and an `input` containing a draft
    plan shape (taskId, summary, node list).
  - `user` event: a `tool_result` with `tool_use_id` matching the tool
    call, `content: { ok: true, planId: "plan-1" }`.
  - `assistant` event: a final text block ("Plan generated.").
  - `result` event: `subtype: "success"`.
- Assertions:
  - Provider returns `run_completed`, not `run_failed`.
  - Stream contains at least one `tool_result` event whose `tool` is
    `"chrona_plan_generate"`.
  - `terminalSnapshotFromEvents(...).status === "completed"`.
- This is the only provider-package touchpoint. The provider source is
  not modified.

## 3. New test files (one per scenario)

All new test files use `await act(...)` around every state transition and
`cleanup()` in `afterEach` (matches the pattern in
`use-task-workspace-plan-state.accept-refresh.test.tsx`). All mock
`global.fetch` (or the Hono client) — never hit a real server.

| # | File (under `apps/web/src/components/tasks/workspace/...`) | Runner | Cases |
| - | ------------------------------------------------------------ | ------ | ----- |
| A | `execution/__tests__/current-operation-card.spec.test.tsx`    | vitest | 4     |
| B | `hooks/__tests__/accept-plan-happy-path.test.tsx`             | vitest | 2     |
| C | `hooks/__tests__/accept-plan-error-paths.test.tsx`            | vitest | 3     |
| D | `hooks/__tests__/accept-plan-race-conditions.test.tsx`        | vitest | 2     |
| E | `apps/server/src/routes/tasks/__tests__/plan-accept-route.test.ts` | bun | 2 |
| F | `page/__tests__/workspace-rerender-after-accept.test.tsx`     | vitest | 1     |
| G | `packages/providers/claude-code/src/__tests__/claude-code-generate-plan-run-replay.test.ts` | bun | 1 |

Total new test cases: **~15**.

### A. `current-operation-card.spec.test.tsx`
4 sub-tests, one per plan state. Each constructs an `input` for
`buildCommandCenterNowSpec` with the matching fixture and asserts the
resulting `UiDocument`'s `status-card` element (`WorkspaceSummaryCard`):
- `props.eyebrow === "Current operation"`
- `props.title`, `props.statusLabel`, `props.tone`, `props.icon` match
  the 4-row table.

Pure spec test — no React render needed.

### B. `accept-plan-happy-path.test.tsx`
2 sub-tests, one per Accept button location:
- Header card: render `<TaskWorkspaceHeaderCard>`, click
  `[UI_ACTION.acceptPlan]`.
- Selected block sheet: call `acceptPlanById("plan-1")` from the
  plan-state hook.

Mock `global.fetch` to return 202 with
`{ commandId, taskId, acceptedAt }`. Assert: `planFlowStatus` flips
`waiting_acceptance → accepting → accepted`; `acceptPlanError` stays
`null`; `refreshExecutionQueries` is called exactly once.

### C. `accept-plan-error-paths.test.tsx`
3 sub-tests:
- Server 4xx (409 Conflict): `planFlowStatus` → `failed`,
  `acceptPlanError` matches server message.
- Server 5xx (500): same path, generic error.
- Network error (fetch throws): status `failed`, message =
  `"Failed to dispatch workspace command"` fallback.

### D. `accept-plan-race-conditions.test.tsx`
2 sub-tests:
- Double-click: click twice in the same tick (no `await` between).
  Mock the first call with a delayed `Promise` (resolves after the
  second click). Assert `fetch` was called exactly once and
  `planFlowStatus` stays in `accepting`.
- Already-accepted (409 mid-flight): server returns 409 during the
  `accepting` window. Assert the catch branch runs (`planFlowStatus` →
  `failed`), the optimistic `accepted` is NOT set, and the error
  message matches the 409 body.

### E. `apps/server/.../plan-accept-route.test.ts`
Mocks `engine.tasks.plan.accept` at the module boundary. Asserts:
- `POST /api/tasks/:taskId/plan/accept` with
  `{ planId, workspaceId, workBlockId }` calls
  `engine.tasks.plan.accept` with the exact same args and returns 2xx
  with the engine's response shape.
- On engine rejection, the route returns 500 with
  `error: "Failed to accept task AI plan"`.

This is one test file with 2 cases.

### F. `workspace-rerender-after-accept.test.tsx`
Mount `<TaskWorkspacePage>` with
`taskWorkspacePlanStateFixtures.planWaitingAcceptance` as the initial
`TaskPageData`. Mock the accept route to return 202. Click Accept via
the header card button. After the React update:
- The "Current operation" `WorkspaceSummaryCard` now has
  `title: "Plan accepted"`, `tone: "success"`, `icon: "check"`,
  `statusLabel: "Accepted"`.
- The Accept button is no longer in the DOM
  (`queryByRole("button", { name: /accept plan/i })` returns null).
- The `start-plan` primary action is visible (since
  `hasGraphExecutionStarted` is still false at this point).

### G. `claude-code-generate-plan-run-replay.test.ts` (Bun)
Single `it`: load the synthetic `plan-generation.jsonl` fixture via
`createReplayRunner`, drive
`ClaudeCodeProviderClient.streamRun(...)`, collect events, and assert:
- `run_completed` is the terminal event.
- `events.filter(e => e.type === "tool_result").some(e => e.tool === "chrona_plan_generate")`
  is `true`.
- `terminalSnapshotFromEvents(events).status === "completed"`.

## 4. Sequencing & dependencies

1. **First** — add fixtures (§2.3). Pure data. Unblocks all tests.
2. **Second** — add `resolveCurrentOperationCardSpec` and wire it into
   the wrapper (§2.1). Only production code change.
3. **Third** — write `current-operation-card.spec.test.tsx` (A). Pure
   spec test, no React. Validates the redesign before heavier tests.
4. **Fourth** — write the hook tests (B, C, D) in any order.
5. **Fifth** — write the server route mocked test (E).
6. **Sixth** — write the full-page rerender test (F).
7. **Seventh** — write the provider replay test (G).
8. **Eighth** — capture screenshots and evidence (manual, on a
   workstation with the dev server).

No step blocks another. Step 1 + Step 2 are the only changes that touch
non-test code.

## 5. Verification

### Gates
- `bun run typecheck` — 0 errors.
- `bun run lint` — 0 errors, no new warnings (baseline: 964 warnings).
- `bun run check:boundaries` — 0 new violations.
- `bun run test:ci` — all suites pass.

### New tests wired in
- The 6 new web test files (A–D, F) are discovered by
  `apps/web/vitest.config.ts` (existing glob).
- The server test (E) is discovered by `apps/server`'s test runner.
- The provider test (G) is discovered by
  `scripts/run-bun-tests.ts` — verify the glob covers `*.test.ts`;
  if not, rename to `*.bun.test.ts`.

### Manual evidence to record (under `specs/019-plan-card-and-accept-tests/evidence/`)
- `current-operation-card-idle.png`
- `current-operation-card-generating.png`
- `current-operation-card-waiting-acceptance.png`
- `current-operation-card-accepted.png`
- `accept-flow-test-output.txt` — full test log with all cases passing.
- `provider-replay-trace.txt` — JSONL dump from G.

### Teardown-race no-regression constraint
The pre-existing race in
`use-task-workspace-plan-state.accept-refresh.test.tsx` is owned by
WS-A. This spec must not make it worse. All new test files (A–F) MUST:
- `await act(async () => { ... })` around every render + state
  assertion.
- Call `cleanup()` from `@testing-library/react` in `afterEach`.
- Not start background `setTimeout`/`setInterval` outside fake-timer
  scope.
- Resolve all in-flight promises in `afterEach` via
  `await new Promise(setImmediate)` (or equivalent) before vitest tears
  down the worker.

The provider test (G) is a bun test, not vitest — does not have the
React 18 scheduler issue. No special handling needed.

## 6. Out of scope (explicit)

- No changes to `packages/providers/claude-code` source.
- No changes to `packages/ui-protocol`.
- No changes to the engine, server route handlers, or Prisma schema.
- No changes to the Accept button positions.
- No new dependencies.
- No fix for the pre-existing teardown race in
  `use-task-workspace-plan-state.accept-refresh.test.tsx`.
- No new `CommandCenterPrimaryActionKind` variants.

## 7. Critical files for implementation

- `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts` — add `resolveCurrentOperationCardSpec`, rewire the wrapper.
- `apps/web/src/components/tasks/workspace/test-support/task-workspace-test-fixtures.ts` — add `taskWorkspacePlanStateFixtures`.
- `apps/server/src/routes/tasks/plan.routes.ts` — read-only reference (do not modify; route test mocks the engine boundary).
- `packages/contracts/src/ai-feature-specs.ts` — read-only reference for the `chrona_plan_generate` tool name.
- `packages/providers/claude-code/src/__tests__/claude-code-generate-plan-run-replay.test.ts` — new file (test + synthetic fixture).
