# Spec 016 — Tasks (ordered, testable)

> Read `spec.md` and `plan.md` first. Each step names its test and the
> milestone matrix row (§6) it advances. Every PR must pass `bun run typecheck`,
> `bun run lint` (no new warnings), `bun run check:boundaries`,
> `bun run test:ci`, and (from T5 onward) the gated E2E. Never relax an
> assertion to get green (WS-A non-goal #4).

---

## T1 — Eligibility reason in the schedule read model  → A1
- Add `autoStartEligible: boolean` + `autoStartReason: <9 reasons>|null` to the
  per-task projection in `get-schedule-page.ts` by calling the existing
  `deriveAutoStartEligibility` with `{task, workBlock, now, activeRun}`.
- Extend the projection DTO (Zod) in
  `packages/contracts/src/api/projections.schema.ts` (both fields optional).
- **Test:** extend `get-schedule-page*.bun.test.ts` — one case per `ok:false`
  reason asserting `autoStartReason`. Do not duplicate the predicate logic.

## T2 — Eligibility reason in the task page read model (if it renders there) → A1
- If the task/work page surface renders eligibility, attach the same two fields
  in the work-page read model (`modules/pages/work-page/`).
- **Test:** Bun test on that read model, one case per reason.
- If the task page does not render eligibility, skip T2 and record why in the
  PR description (surface only on the schedule surface).

## T3 — Render the eligibility reason in the web UI  → A1
- Map the 9 reason codes → plain-language copy (use the existing schedule/task
  copy module; do not hard-code strings inline). Render on the task/schedule
  surface, reading the projection field. **No** client-side re-derivation
  (guardrail §5.5).
- **Test:** web render test — a task with each reason shows the mapped copy.
- **Gate:** typecheck + lint + boundaries + test:ci green.

## T4 — Inbox: close the `Blocked` gap + audit the 5 states  → A2
- Verified: `Blocked` is a **`TaskStatus`** (with `Task.blockReason: Json?`),
  not a `RunStatus`; `get-inbox.ts` keys items off the latest **run** status, so
  blocked tasks never surface. Add a task-status query branch
  (`status = Blocked`) in `get-inbox.ts` and emit an actionable item (reason
  from `blockReason` + owning task/run + primary recovery action). Extend the
  Inbox DTO union if a `blocked` kind is cleaner than reusing `recovery`.
- Render the new item kind + action in
  `apps/web/src/components/inbox/{inbox-list,inbox-page-client}.tsx`.
- **Test:** `get-inbox` Bun test — one case per `Blocked / Failed /
  WaitingForInput / WaitingForApproval / cancelled` asserting exactly one
  actionable item with the expected reason + recovery action.

## T5 — Golden-path E2E (positive + negative)  → A3
- New `e2e/specs/auto-execution-golden-path.spec.ts` using
  `task-workspace-test-helpers.ts` + the `debug` provider.
- Positive: §1.3 full loop, driven by `tick()` /
  `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`. Assert: auto-plan, auto-start,
  (if blocked) Inbox item + resolve, resume to completion, result on Work page.
- Negative: due-but-ineligible task → `tick()` → assert NOT started AND the
  specific eligibility reason (from T1/T3) is rendered.
- **No** `sleep`/timeout waits. If the tick seam doesn't reach into Playwright,
  add a test-only tick trigger; do not add wall-clock waits.
- **Test:** the spec itself; must pass deterministically (run 3×, stable).

## T6 — Un-relax `task-lifecycle-execution.spec.ts`  → A4
- Replace `isVisible().catch(()=>false)` branching and weak assertions
  (`not.toBe("no_plan")`) with deterministic expectations on known state.
- Add a determinism seam in the harness / `debug` provider where required —
  never weaken an assertion.
- **Test:** the spec asserts exact expected states; no tolerant/branching
  assertions remain (grep the file for `.catch(() => false)` → 0 hits).

## T7 — Gate Playwright `chromium` in CI  → A4
- Extend `.github/workflows/ci.yml` with a job that installs Playwright browsers
  and runs the `chromium` project on PRs (required-blocking). Document PR vs
  main policy (default: `chromium` on PR, full 3-project on `main`).
- Quarantine/fix flaky specs; do not disable assertions.
- **Evidence:** green CI run link + diff review confirming no weakened
  assertions.

---

## Definition of done (maps to `spec.md` §5 / milestone §6)

- [ ] T1–T3: every `ok:false` reason visible in UI, read from projection → A1
- [ ] T4: every paused/terminal state yields an actionable Inbox item → A2
- [ ] T5: golden-path E2E (positive + negative) deterministic & green → A3
- [ ] T6: no relaxed/branching assertions remain in the lifecycle spec → A4
- [ ] T7: `chromium` gated in CI, green, no weakened assertions → A4
