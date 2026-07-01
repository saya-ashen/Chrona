# Chrona Project Review & Action Handoff — 2026-06-13

> **Status:** Advisory (review) + actionable handoff. This document is written
> for the coding agent(s) advancing Chrona toward v0.2.0.
> **Authority order:** [`milestone-0.2.md`](./milestone-0.2.md) §5 guardrails and
> non-goals still bind. Where this document and the milestone disagree, the
> milestone wins. Where this document and the **code** disagree, **stop and
> surface the conflict** rather than guessing.
>
> **Reviewer stance:** Staff Engineer + product architecture advisor. Findings
> are evidence-anchored to files verified on 2026-06-13. Opinions are explicit
> and prioritized; this is not an exhaustive checklist.

---

## 0. TL;DR for the implementing agent

The architecture and planning quality are excellent. The product *thesis*
("dependable, recoverable auto-execution you don't have to read logs to trust")
is **not yet proven by code or tests**. The reachability leg (Claude Code
provider, WS-B) shipped; the reliability leg (WS-A) has no spec and no
golden-path E2E. **Do not add capabilities. Close the trust loop.**

Work the actions in §6 **in order**. Each carries acceptance criteria and the
guardrail it must not violate.

---

## 1. Project stage

Late prototype / pre-0.2. The four-loop core (Task → Plan → Schedule →
Auto-Execution) is built end-to-end and verified (see `milestone-0.2.md` §2).
The current job is **hardening for trust**, not building features.

---

## 2. Strengths (do not regress these)

| Strength | Evidence | Implication |
| --- | --- | --- |
| Enforced architecture boundaries | `bun run check:boundaries` (dependency-cruiser + ESLint) | Keep it **green**; a new violation is a regression |
| Single-writer task state | `deriveTaskState` + `rebuildTaskProjection` (`backend-execution-flow.md` §Task state authority) | Never write `Task.status`/`blockReason` outside the committer |
| Proven provider abstraction | Claude Code (spec 017) added with **zero** engine business-logic change | Keep `providers/*` free of task/plan/schedule semantics |
| Code hygiene | 7 TODO/FIXME total, 0 `@ts-ignore` across `apps`+`packages` | Don't introduce type escapes or debt markers |
| Planning discipline | `milestone-0.2.md` anti-drift contract, 19 ordered specs | Expand specs before coding new workstreams |

---

## 3. Risks (prioritized)

### R1 — Trust thesis unproven; tests sliding toward false-green (P0)
- **Evidence:** No golden-path E2E exists (the v0.2 DoD, `milestone-0.2.md`
  §1.3). `e2e/specs/task-lifecycle-execution.spec.ts` has only 18 `expect`s and
  uses `isVisible().catch(() => false)` branching + weak assertions
  (`expect(observedStatus).not.toBe("no_plan")`, ~line 125). Session history
  records assertions were **relaxed** on 2026-06-12 — which WS-A non-goal #4
  explicitly forbids, naming this exact file.
- **Consequence:** CI is green but unprotected against regressions in the one
  area Chrona cannot afford to break.
- **Fix:** Actions A3 + A4 below.

### R2 — Mandatory boundary gate is currently RED (P0)
- **Evidence:** `bun run check:boundaries` fails with 1 error:
  `packages/engine/src/modules/pages/get-schedule-page.ts → apps/web/src/components/schedule/schedule-page-utils.ts`
  (engine importing web). `package-boundaries.md` §"Known violations" already
  documents this as a stale-baseline path drift that surfaces as a hard error.
  98 `warn`s (test files reaching into engine internals) also accumulating.
- **Consequence:** `milestone-0.2.md` §5 requires every PR to pass
  `check:boundaries`. The gate is broken, so the project's strongest guardrail
  is effectively off.
- **Fix:** Action A1.

### R3 — Inbox (the recovery surface) is under-built vs its strategic weight (P0/P1)
- **Evidence:** `components/inbox` is **228 LOC / 2 files**; `components/schedule`
  is **7423 LOC / 29 files**. The product thesis lands in the Inbox
  ("explain WHY + offer recovery", `milestone-0.2.md` §1.3). WS-A items 1
  (surface eligibility) and 2 (Inbox recovery completeness) are not done.
  `derive-auto-start-eligibility` already returns 9 structured reasons, but none
  are rendered in the UI.
- **Consequence:** "recover without reading logs" is aspiration, not shipped.
- **Fix:** Actions A5 + A6.

### R4 — The two co-P0 legs progressed asymmetrically (P0 planning)
- **Evidence:** WS-B spec (017) **done**; WS-A spec (`016-auto-exec-reliability`)
  **missing**; WS-C spec (`018-external-calendar-finish`) **missing**. Only the
  narrower spec 019 covers part of WS-A.
- **Consequence:** Reachability shipped before reliability. 0.2.0's DoD (golden
  path green in CI with debug provider) is not close.
- **Fix:** Freeze WS-B follow-ons; redirect to WS-A (Actions A2–A6).

### R5 — Generated Prisma client committed to VCS (P2, independent)
- **Evidence:** `packages/db/src/generated` = 42 files / 96,894 lines tracked,
  while CI also runs `prisma generate`. (`milestone-0.2.md` §7 risk 6.)
- **Consequence:** Review noise, merge conflicts, drift risk.
- **Fix:** Action A7.

---

## 4. Architecture assessment (concise)

Solid and extensible — **no large refactor needed**. Only adjust:

1. **engine→web reverse dependency (R2)** — the one real violation. Small fix
   (move a pure helper), high priority because it breaks the gate.
2. **Sink-barrel rule path drift** — `engine-sink-modules-via-barrel` still
   names the pre-rename `task-execution`; the `execution-runtime` sink is
   therefore **not** actually barrel-enforced (`package-boundaries.md` §Internal
   module structure ⚠️). Fix the rule path.
3. **Do NOT split `packages/engine` into more packages.** Its internal
   co-recursive modules are deliberate and documented; splitting manufactures
   real cross-package cycles.

---

## 5. Product / UX assessment (concise)

`PRODUCT.md` design principles are right and anti-debugger-panel. The gap is
**delivery**, not direction:

- **"What is it waiting on?"** — the task workspace "Current operation" card is a
  static `attention ?? readiness` fallback that does not distinguish the 4 plan
  states (diagnosed in spec 019 §1). **Spec 019 fixes this — finish it.**
- **"Why is it stuck?"** — `derive-auto-start-eligibility` reasons are not
  rendered (R3).
- **Inbox too thin** (R3) — the recovery endpoint of the whole loop.
- **Schedule likely over-built** (7423 LOC) relative to Inbox — resource
  allocation is inverted vs product value.

Verdict: looks like a product, but the core promise (understand state /
understand blockers / one-click recovery) is still half-built.

---

## 6. Action plan (ordered, with acceptance criteria)

> Run in order. Each PR must pass: `bun run typecheck`, `bun run lint` (do not
> increase warning count), `bun run check:boundaries`, `bun run test:ci`.
> Obey `milestone-0.2.md` §5 guardrails. Every behavioral change ships with a
> test.

### A1 — Turn the boundary gate green (P0, small)
- **Do:** Move the pure date/aggregation helpers in
  `apps/web/src/components/schedule/schedule-page-utils.ts` into
  `packages/domain` (or `packages/shared` if not domain logic). Flip the web
  consumers and `packages/engine/src/modules/pages/get-schedule-page.ts` to
  import from the new location. Then fix the
  `engine-sink-modules-via-barrel` rule path in `.dependency-cruiser.cjs`
  (`task-execution` → `execution-runtime`).
- **Do NOT:** re-snapshot the baseline to hide the violation (contradicts the
  project's own "fix the import" rule).
- **Accept:** `bun run check:boundaries` exits 0 with 0 errors; the
  `execution-runtime` sink is actually enforced.

### A2 — Author spec `016-auto-exec-reliability/` (P0, planning)
- **Do:** Expand WS-A (`milestone-0.2.md` §WS-A) into `specs/016-…/` with
  `spec.md`, `plan.md`, `tasks.md`, mapping back to verification rows A1–A4.
  Scope = items 1 (surface eligibility), 2 (Inbox recovery completeness), 3
  (golden-path E2E), 4 (gate E2E in CI). Reference the real symbols in §2 of the
  milestone; do not duplicate `derive-auto-start-eligibility`.
- **Accept:** Spec exists, scoped to existing symbols, no logic duplication.

### A3 — Deterministic golden-path E2E (P0)
- **Do:** New Playwright spec under `e2e/specs/` for `milestone-0.2.md` §1.3
  positive **and** negative cases, using the `debug` provider and driving the
  orchestrator via `tick()` / `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`. Use
  `e2e/specs/task-workspace-test-helpers.ts`.
- **Do NOT:** use wall-clock `sleep`/timeout-based waits, or relax assertions to
  get green (WS-A non-goal #4).
- **Accept:** Spec passes deterministically; negative case asserts the specific
  eligibility reason is shown and the task does not start.

### A4 — Un-relax existing E2E assertions (P0)
- **Do:** In `e2e/specs/task-lifecycle-execution.spec.ts`, replace
  `isVisible().catch(() => false)` branching and weak assertions
  (`not.toBe("no_plan")`) with deterministic expectations on a known state.
  Where determinism requires a test seam, add one — do not weaken the assertion.
- **Accept:** No tolerant/branching assertions remain; the spec asserts exact
  expected states.

### A5 — Surface eligibility reason in the UI (P0/P1, WS-A item 1)
- **Do:** Add the `derive-auto-start-eligibility` `reason` (the 9 `ok:false`
  reasons) to the read model — `packages/engine/src/modules/pages/get-schedule-page.ts`
  and/or the task page read model — and render it on the task/schedule surface.
- **Do NOT:** recompute eligibility in the client (guardrail §5.5: UI reads
  projections, never reconstructs backend state).
- **Accept:** For each `ok:false` reason, an affected task shows the reason
  (verified by test/screenshot, ties to milestone matrix A1).

### A6 — Inbox recovery completeness (P1, WS-A item 2)
- **Do:** Audit that each of `Blocked / Failed / WaitingForInput /
  WaitingForApproval / cancelled` produces an actionable Inbox item with a
  plain-language reason, the owning task/run, and a primary recovery action.
  Fill gaps. Build out `components/inbox` as needed.
- **Accept:** One test per state confirms the Inbox item + recovery action
  (milestone matrix A2).

### A7 — Stop tracking generated Prisma client (P2, independent)
- **Do:** gitignore `packages/db/src/generated`; ensure setup/CI runs
  `prisma generate` so the client exists at build time.
- **Accept:** `git ls-files packages/db/src/generated` returns 0; clean build
  from scratch still produces a working client.

### Finish spec 019 (in flight, do alongside A3/A5)
- Spec `019-plan-card-and-accept-tests/` already targets WS-A items 1–3 at the
  card level. Implement `resolveCurrentOperationCardSpec(planFlow, planSummary)`
  (pure, no React/IO) + the 4-state "Current operation" card variants in
  `apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`,
  and land the already-staged tests (`accept-plan-flow.test.tsx`,
  `current-operation-card.spec.test.tsx`).

---

## 7. Stop / Avoid (until golden path is green in CI)

- **No third provider (Codex etc.).** Claude Code is the proof; Codex is
  post-0.2 (`milestone-0.2.md` WS-B non-goals). Adding it now widens R4.
- **No further Schedule UI surface area.** Already over-built relative to Inbox.
- **No mid-term roadmap work** (dynamic replanning, richer memory, portfolio).
- **No multi-session execution** (explicitly post-0.2).
- **Never relax tests to get CI green.** Already happened once; do not repeat.

---

## 8. Decisions for the project owner (recommendations)

1. **0.2.0 gate = "trustworthy", not "reachable".** Bind release to a green
   deterministic golden-path E2E in CI, not provider count. **Recommended.**
2. **E2E in CI = required-blocking `chromium` on PR; full 3-project on main.**
   **Recommended** (milestone default).
3. **`schedule-page-utils` = proper migration to domain/shared, not
   re-baseline.** **Recommended** (A1).
4. **Generated Prisma exits VCS.** **Recommended** (A7).

---

## 9. Definition of "trust loop closed" (exit criteria for this handoff)

- [ ] `bun run check:boundaries` green (A1)
- [ ] spec 016 authored (A2)
- [ ] golden-path E2E (positive + negative) deterministic & green (A3)
- [ ] no relaxed/branching assertions in existing E2E (A4)
- [ ] every `ok:false` eligibility reason visible in UI (A5)
- [ ] every paused/terminal state yields an actionable Inbox item (A6)
- [ ] spec 019 card variants + accept tests landed
- [ ] E2E gated in CI, green, no weakened assertions (milestone matrix A3/A4)
