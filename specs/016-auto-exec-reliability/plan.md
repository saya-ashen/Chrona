# Spec 016 — Plan (file-level)

> Read `spec.md` first. This file is the concrete, file-level task breakdown
> referencing the verified symbols in `milestone-0.2.md` §2. Ordered steps live
> in `tasks.md`. Obey milestone §5 guardrails on every change.

---

## Sequencing rationale

Items can land as independent PRs, but the recommended order is:

1. **Eligibility read-model + UI (item 1)** first — it is the smallest backend
   change, unblocks the E2E negative case (which asserts a rendered reason), and
   WS-C item 1 / spec 018 later reuses the same surface.
2. **Inbox completeness (item 2)** next — independent, fills the `Blocked` gap.
3. **Golden-path E2E (item 3)** — depends on item 1 (negative case asserts the
   rendered reason).
4. **Un-relax existing E2E (item 4)** — alongside item 3; shares the harness and
   the determinism seam.
5. **CI gating (item 5)** — last; gate only once the specs above are green.

---

## Item 1 — Surface eligibility reason

**Backend (engine read model):**
- In `packages/engine/src/modules/pages/get-schedule-page.ts`, for each task
  surfaced with a work block, call `deriveAutoStartEligibility(...)` with the
  same inputs the orchestrator uses (`task`, `workBlock`, `now`, `activeRun`)
  and attach the result to the task's projection row: `autoStartEligible:
  boolean` + `autoStartReason: <the 9 reasons> | null`.
  - Reuse the existing function. Do **not** re-implement the predicate.
  - If the task page read model (under `modules/pages/work-page/`) is the more
    natural home for the per-task surface, add it there too. Decide by where the
    affected UI renders; surface in both if both render eligibility.
- Extend the projection DTO in `packages/contracts/src/api/projections.schema.ts`
  with the two new optional fields (Zod). Keep them optional so existing
  consumers don't break.

**Frontend:**
- Render the reason on the task/schedule surface as a short, plain-language
  label (map the 9 reason codes → human copy in the web layer; copy lives in
  the existing schedule/task copy module, not hard-coded).
- Read straight from the projection field. **Never** call
  `deriveAutoStartEligibility` (or re-derive) from `apps/web` (guardrail §5.5).

**Tests:**
- Bun test on the read model: one case per `ok:false` reason → asserts
  `autoStartReason` equals the expected code (extend
  `get-schedule-page*.bun.test.ts` or a sibling).
- Web render test: a task with each reason renders the mapped copy.

**Reason → copy map (authoritative; web layer):**
| reason | user-facing copy (English baseline) |
| --- | --- |
| `not_scheduled` | Not on a schedule block yet |
| `not_due` | Scheduled, not due yet |
| `already_running` | Already running |
| `invalid_task_status` | Task status can't auto-start |
| `no_runtime_config` | No execution runtime configured |
| `no_accepted_plan` | No accepted plan |
| `requires_human_input` | Waiting for your input |
| `requires_approval` | Waiting for approval |
| `runtime_unsupported` | Runtime doesn't support auto-start |

---

## Item 2 — Inbox recovery completeness

**Audit result (from reading `get-inbox.ts`):**
- `WaitingForApproval` → covered via pending `Approval` rows (`approvalItems`).
- `WaitingForInput` → covered (`runItems`, `kind:"input"`).
- `Failed` → covered (`runItems`, `kind:"recovery"`, `riskLevel:"critical"`).
- `Cancelled` → covered (`runItems`, `kind:"recovery"`).
- **`Blocked` → NOT covered.** `Blocked` is a **`TaskStatus`** (with
  `Task.blockReason: Json?`), **not** a `RunStatus` — `get-inbox.ts` keys items
  off the latest-**run** status, so a blocked task never produces an Inbox item.

**Backend (data model — verified 2026-06-13):**
- `Blocked` is a **`TaskStatus`**, not a `RunStatus`
  (`prisma/schema.prisma`: `enum RunStatus` has no `Blocked`; `enum TaskStatus`
  does, paired with `Task.blockReason: Json?`). So `get-inbox.ts`, which keys
  Inbox items off the **latest-run** status, structurally cannot surface a
  blocked task — this is the gap, and it is a task-status gap, not a run-status
  filter gap.
- Add a query branch in `get-inbox.ts` for tasks where `status = Blocked`
  (independent of the latest-run join). Emit an actionable item: plain-language
  reason derived from `Task.blockReason`, the owning task/run, and a primary
  recovery action (mirror the existing `recovery` item shape; pick a `kind`
  consistent with the contracts — extend the DTO union if a `blocked` kind is
  cleaner than reusing `recovery`).
- The other four states map to existing surfaces (`WaitingForApproval` →
  pending `Approval`; `WaitingForInput`/`Failed`/`Cancelled` → latest-run query)
  — verify each still produces an item; do not regress them.

**Frontend:**
- Ensure `inbox-list.tsx` renders the new item kind + its recovery action;
  extend `inbox-page-client.tsx` action wiring as needed.

**Tests (matrix A2 — one per state):**
- Engine `get-inbox` Bun test: seed a task whose latest run is in each of the 5
  states → assert exactly one actionable item with the expected
  reason/action per state.

---

## Item 3 — Golden-path E2E

**New spec:** `e2e/specs/auto-execution-golden-path.spec.ts`.

- Use `task-workspace-test-helpers.ts` (`createTaskWorkspaceTask`, command
  helpers). Configure the `debug` provider.
- **Positive (§1.3):** create executable task → place on a due-shortly block →
  drive orchestrator `tick()` → assert auto plan generated → assert auto-start →
  if a node blocks/needs approval, assert the Inbox item + resolve it → assert
  resume to completion → assert final result inspectable on the Work page.
- **Negative (§1.3):** a due task NOT eligible (e.g. `no_accepted_plan`) → run
  `tick()` → assert the task does **not** start AND the specific eligibility
  reason (from item 1) is rendered.
- Determinism: drive via `tick()` / `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`;
  **no** `sleep`/timeout-based waits (open question §7.3 resolution: confirm the
  tick seam works inside Playwright; if not, add a test-only tick endpoint —
  do not add wall-clock waits).

---

## Item 4 — Un-relax existing E2E

**File:** `e2e/specs/task-lifecycle-execution.spec.ts`.

- Replace `isVisible().catch(() => false)` branching with deterministic
  expectations on a known seeded state.
- Replace weak assertions (`expect(observedStatus).not.toBe("no_plan")`, ~line
  125) with exact expected-state assertions.
- Where determinism requires a seam (e.g. forcing a known plan/run state), add
  the seam in the harness or via the `debug` provider — never weaken the
  assertion to pass.

---

## Item 5 — Gate E2E in CI

**File:** `.github/workflows/ci.yml` (+ `playwright.config.ts` if needed).

- Add a job (or extend the existing one) that installs Playwright browsers and
  runs the `chromium` project on PRs.
- Policy (default, document in the job): `chromium` on PR (required-blocking),
  full 3-project on `main`.
- Quarantine or fix flaky specs; do **not** disable assertions to get green.

---

## Verification mapping

| Step | Milestone matrix row |
| --- | --- |
| Item 1 (eligibility read-model + UI + tests) | A1 |
| Item 2 (Inbox completeness + per-state tests) | A2 |
| Item 3 (golden-path E2E positive+negative) | A3 |
| Item 4 (un-relax lifecycle spec) | A4 |
| Item 5 (CI `chromium` gate) | A4 |
