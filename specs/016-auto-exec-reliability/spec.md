# Spec 016 — Auto-execution reliability + E2E gating

> Parent: [`docs/en/milestone-0.2.md`](../../docs/en/milestone-0.2.md) → **WS-A**.
> This file is the authoritative, implementable expansion of WS-A.
> **Authority order:** the milestone's §5 guardrails and WS-A non-goals bind.
> Where this spec and the milestone disagree, the milestone wins; where this
> spec and the **code** disagree, **stop and surface it** rather than guessing.
>
> Related in-flight: [`specs/019-plan-card-and-accept-tests/`](../019-plan-card-and-accept-tests/spec.md)
> covers the "Current operation" card + accept-flow tests (WS-A items 1–3 at the
> card level). 016 is the parent; 019 is a slice. Do not duplicate 019's card
> work here — 016 owns the read-model reason, the Inbox audit, and the E2E.

Status: **Ready to implement.** Read this file, then `plan.md`, then `tasks.md`.

---

## 1. Problem

The four-loop core (Task → Plan → Schedule → Auto-Execution) is built and unit-
/integration-tested, but the **trust thesis is unproven by code**:

- **Decisions are invisible.** `deriveAutoStartEligibility`
  (`packages/engine/src/modules/scheduling/derive-auto-start-eligibility.ts`)
  returns one of 9 structured `ok:false` reasons, but **none are rendered** in
  any UI surface. A user cannot answer "why didn't this auto-start?" without
  reading logs — the exact failure the milestone forbids (§1.3 negative case).
- **Recovery is incomplete.** The Inbox (`get-inbox.ts`) is the recovery
  surface, but it queries latest-run statuses `WaitingForInput`, `Failed`,
  `Cancelled` (+ pending `Approval` rows for `WaitingForApproval`). A
  **`Blocked` task produces no Inbox item** — `Blocked` is a `TaskStatus` (with
  `Task.blockReason`), not a `RunStatus`, so the run-keyed query can't reach it
  and a blocked task has no actionable recovery surface.
- **No golden-path regression protection.** The §1.3 golden path exists nowhere
  as an automated E2E. The one lifecycle spec
  (`e2e/specs/task-lifecycle-execution.spec.ts`) had its assertions **relaxed**
  on 2026-06-12 (tolerant `isVisible().catch(()=>false)` branching, weak
  `not.toBe("no_plan")`), which WS-A non-goal #4 explicitly forbids by name.
- **E2E is not gated in CI.** `test:ci` runs vitest + Bun + API + replay, no
  Playwright. Regressions in the one area Chrona cannot afford to break are
  unprotected.

## 2. Goal

Make the schedule→auto-execution loop trustworthy for daily use:

1. Every `ok:false` auto-start eligibility reason is **visible** on a task /
   schedule surface, read from the projection (never recomputed in the client).
2. Every paused / terminal auto-execution state
   (`Blocked`, `Failed`, `WaitingForInput`, `WaitingForApproval`, cancelled)
   produces an **actionable Inbox item** with a plain-language reason, the
   owning task/run, and a primary recovery action.
3. The §1.3 golden path (positive **and** negative) is a **deterministic**
   Playwright spec driven by `tick()` / `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`
   and the `debug` provider — no wall-clock waits, no relaxed assertions.
4. The existing lifecycle spec is **un-relaxed** to deterministic expectations.
5. Playwright `chromium` is **gated in CI** on PRs and green.

## 3. Scope (in)

1. **Surface eligibility (WS-A item 1 / matrix A1).** Add the eligibility
   `reason` to the relevant page read model
   (`packages/engine/src/modules/pages/get-schedule-page.ts` and/or the task
   page read model) and render it on the task/schedule surface. Reuse
   `deriveAutoStartEligibility`; do **not** duplicate the decision logic.
2. **Inbox recovery completeness (WS-A item 2 / matrix A2).** Audit `get-inbox.ts`
   so each of `Blocked / Failed / WaitingForInput / WaitingForApproval /
   cancelled` yields an actionable item (reason + owning task/run + primary
   recovery action). Close the `Blocked` gap. Build out `components/inbox`
   (`inbox-list.tsx`, `inbox-page-client.tsx`) only as needed to render new
   items + actions.
3. **Golden-path E2E (WS-A item 3 / matrix A3).** New spec under `e2e/specs/`
   covering §1.3 positive + negative, using `task-workspace-test-helpers.ts`
   and the `debug` provider, driving the orchestrator via `tick()`.
4. **Un-relax existing E2E (WS-A item 4 / matrix A4).** Replace tolerant /
   branching assertions in `task-lifecycle-execution.spec.ts` with deterministic
   expectations on known state. Add a test seam where determinism requires one;
   never weaken an assertion.
5. **Gate E2E in CI (matrix A4).** Add/extend a CI job running the `chromium`
   Playwright project on PRs. Document PR vs main policy (default: `chromium` on
   PR, full 3-project on main).

## 4. Scope (out — non-goals)

- **No new orchestrator workers or scheduling semantics** (milestone WS-A
  non-goal). The decision logic already exists — surface it, don't extend it.
- **No changes to lease/recovery internals** beyond bug fixes uncovered by the
  E2E.
- **No multi-session execution** (post-0.2).
- **No relaxing assertions to get green** (WS-A non-goal #4 — regressed once;
  do not repeat). Harden the test or the product instead.
- **No new eligibility reasons.** `external_calendar_conflict` belongs to WS-C
  / spec 018, not here.
- **No client-side recomputation of backend state** (guardrail §5.5).
- **No "Current operation" card variants** — owned by spec 019; 016 supplies the
  read-model reason that 019 and the task surface consume.

## 5. Acceptance criteria (Definition of Done)

- [ ] For **every** `ok:false` reason
      (`not_scheduled`, `not_due`, `already_running`, `invalid_task_status`,
      `no_runtime_config`, `no_accepted_plan`, `requires_human_input`,
      `requires_approval`, `runtime_unsupported`), an affected task shows the
      reason on a UI surface (verified by test/screenshot). → matrix A1
- [ ] The reason is read from the projection, not recomputed in the client.
- [ ] Each of `Blocked / Failed / WaitingForInput / WaitingForApproval /
      cancelled` produces an Inbox item with reason + owning task/run + a
      primary recovery action; one test per state. → matrix A2
- [ ] A new Playwright spec covers §1.3 positive + negative, passes
      deterministically (no `sleep`/timeout waits); the negative case asserts
      the specific eligibility reason is shown and the task does not start.
      → matrix A3
- [ ] No tolerant/branching assertions remain in
      `task-lifecycle-execution.spec.ts`; it asserts exact expected states.
      → matrix A4
- [ ] CI runs Playwright `chromium` on PRs and is green; no existing E2E
      assertion was weakened to achieve it. → matrix A4
- [ ] Each PR passes `bun run typecheck`, `bun run lint` (no new warnings),
      `bun run check:boundaries`, `bun run test:ci`, and the gated E2E.

## 6. Cross-references (verified symbols — do not duplicate)

- Eligibility decision + 9 reasons:
  `packages/engine/src/modules/scheduling/derive-auto-start-eligibility.ts`
  (`deriveAutoStartEligibility`, `AutoStartEligibility`).
- Auto-start callers: `auto-start-runner.ts`, `auto-start-scheduled-plan.ts`.
- Schedule read model: `packages/engine/src/modules/pages/get-schedule-page.ts`.
- Inbox read model: `packages/engine/src/modules/pages/get-inbox.ts`
  (covers `WaitingForInput`/`Failed`/`Cancelled` runs + pending `Approval`;
  **`Blocked` `TaskStatus` is the gap** — not a `RunStatus`, so the run-keyed
  query can't reach it).
- Inbox UI: `apps/web/src/components/inbox/{inbox-list,inbox-page-client}.tsx`.
- Inbox DTOs: `packages/contracts/src/api/projections.schema.ts`.
- Orchestrator + tick seam:
  `packages/engine/src/modules/orchestration/{task-orchestrator,orchestrator-config}.ts`
  (`CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`).
- E2E harness: `e2e/specs/task-workspace-test-helpers.ts`.
- Existing lifecycle spec (to un-relax): `e2e/specs/task-lifecycle-execution.spec.ts`.
- CI: `.github/workflows/ci.yml`, `playwright.config.ts` (`chromium`/`tablet`/`mobile`).
- Milestone verification matrix rows: A1, A2, A3, A4.
