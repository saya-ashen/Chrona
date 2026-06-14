# Spec 019 — Plan-card redesign + accept-flow tests

> Parent: [`docs/en/milestone-0.2.md`](../../docs/en/milestone-0.2.md) → **WS-A**
> (specifically items 1, 2, and 3 of WS-A's in-scope list).
> This spec is the authoritative, implementable expansion of that work.
> Where this spec and the milestone doc disagree, the milestone doc's
> guardrails (§5) and non-goals still bind; where this spec and the code
> disagree, **stop and surface it** rather than guessing.

Status: **Ready to implement.** Read this file, then `plan.md`, then `tasks.md`.

---

## 1. Problem

The Work page's "Current operation" card (`WorkspaceSummaryCard` from
`@chrona/ui-protocol`, eyebrow `"Current operation"`) is the slot Chrona uses
to tell a user *what is the system waiting on right now*. Today it is wired
to `input.attention ?? input.readiness` from the page model — a single static
fallback. The page does have a 4-state plan state machine
(`idle | generating | waiting_acceptance | accepted`, defined in
`apps/web/src/components/tasks/workspace/model/task-workspace-types.ts:7`),
but the "Current operation" card does not differentiate those four states.

Result: a user landing on a task in `waiting_acceptance` sees a generic
readiness card instead of "Plan ready for review"; a user landing on a
generating task sees no plan-specific feedback inside the Current operation
slot. Accept-Plan is handled correctly (the buttons exist in two locations —
header card + selected block sheet) but the card *around* the buttons does
not visually distinguish the four states, and there is no automated coverage
for the click → server → DB → re-render path.

This matters because WS-A item 1 ("surface eligibility") and item 2 ("Inbox
recovery completeness") both lean on this card to be informative, and
WS-A item 3 (the golden-path E2E) depends on the accept flow working in
practice.

## 2. Goal

The "Current operation" card carries four distinct visual variants, one per
plan state. The accept flow is end-to-end-tested: the buttons are wired, the
state machine transitions correctly, errors are surfaced, the server route
flips the right DB column, and a full-page re-render reflects the accepted
state. No new dependencies; no provider source changes; no move of the
existing Accept buttons.

## 3. Scope (in)

1. **Redesign the "Current operation" card** in the web app wrapper
   (`apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts:90-146`)
   to have one variant per plan state. Each variant has its own
   `{title, description, statusLabel, tone, icon}`. See `plan.md` for the
   exact 4-row table.
2. **Add a pure helper** `resolveCurrentOperationCardSpec(planFlow, planSummary)`
   in the same file. Pure, no React, no IO. The wrapper consumes it.
3. **Add deterministic test coverage** for the plan / accept flow:
   - 4-state card render (one test per state)
   - Accept happy path (header + selected block sheet)
   - Accept error paths (4xx, 5xx, network)
   - Accept race conditions (double-click, 409 mid-flight)
   - Server route `POST /api/tasks/:taskId/plan/accept` mocked-engine test
   - Full `<TaskWorkspacePage>` re-render after accept
4. **Add a provider-side replay test** in `packages/providers/claude-code`
   asserting that a Claude Code `generate_plan` run produces a
   `run_completed` with a `tool_result` for `chrona_plan_generate` (the
   verified MCP tool name). This is the only WS-B touchpoint and it does
   not modify the provider source.

## 4. Scope (out — non-goals)

- **No new dependencies.** Reuse `WorkspaceSummaryCard` + `Stack` + `Text` +
  `Badge` + `Button` + `Alert` from `@chrona/ui-protocol`.
- **No move of the Accept buttons.** They stay in the header card and the
  selected block sheet, both of which are read-only references for this
  spec.
- **No engine / server route / Prisma schema changes.** The route is
  exercised via mocked engine boundary.
- **No `packages/providers/claude-code` source changes** (only a new test
  file + a synthetic JSONL fixture).
- **No `packages/ui-protocol` changes** (the builder is reused; the
  redesign edits the web wrapper, not the canonical builder).
- **No fix for the pre-existing teardown race** in
  `use-task-workspace-plan-state.accept-refresh.test.tsx` — owned by WS-A
  in a follow-up; this spec must not make it worse.
- **No new `CommandCenterPrimaryActionKind` variants** — the existing 5
  kinds already cover all 4 plan states.
- **No production run-time timer for "elapsed" feedback** during plan
  generation — would require a new dep; not justified.

## 5. Acceptance criteria (Definition of Done)

- [ ] The "Current operation" card has 4 distinct variants, one per plan
      state. Each variant's `icon`, `tone`, `title`, `description`,
      `statusLabel` match the table in `plan.md` §2.
- [ ] The redesign is implemented by editing the web wrapper, NOT the
      `ui-protocol` builder.
- [ ] Deterministic tests cover: 4 card variants, accept happy path
      (2 button locations), 3 error paths, 2 race conditions, server
      route mocked-engine call, full-page re-render after accept,
      provider `generate_plan` replay.
- [ ] `bun run typecheck` passes (0 errors).
- [ ] `bun run lint` passes (0 errors, no new warnings).
- [ ] `bun run check:boundaries` passes (0 new violations).
- [ ] `bun run test:ci` is green.
- [ ] Spec is traceable: each `tasks.md` step names the AC it advances.
- [ ] Manual screenshots of the 4 card variants are attached under
      `evidence/`.

## 6. Cross-references

- Milestone thesis: [`docs/en/milestone-0.2.md`](../../docs/en/milestone-0.2.md) §1
- Milestone verification matrix: §6 rows A1, A2, A3
- `TaskWorkspacePlanFlowState` state machine:
  `apps/web/src/components/tasks/workspace/model/task-workspace-plan-flow-machine.ts:8-14`
- Server route:
  `apps/server/src/routes/tasks/plan.routes.ts:124-138`
- Engine accept use case: `engine.tasks.plan.accept`
- MCP tool name (verified): `chrona_plan_generate`
  (`packages/contracts/src/ai-feature-specs.ts:33`,
  `packages/contracts/src/api/mcp-task-tools.schema.ts:19`)
- Pre-existing teardown race documented in:
  `specs/017-provider-claude-code/tasks.md` "T10 evidence" section
