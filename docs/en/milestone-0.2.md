# Chrona v0.2 Milestone — "Dependable Auto-Execution"

> **Status:** Planning (authoritative). This document is the single source of
> truth for the v0.2 milestone. It defines *what* to build, *in what order*,
> *how we know it is done*, and *what not to do*. Each workstream points to a
> detailed implementation spec to be authored under `specs/` before coding.
>
> **Audience:** the coding agent(s) implementing v0.2. Read this top to bottom
> before starting. When this document and your assumptions disagree, this
> document wins; when this document and the code disagree, **stop and surface
> the conflict** rather than guessing.

---

## 0. How to use this document (anti-drift contract)

This milestone is large, so the biggest risk is *scope drift* — building the
wrong thing, rebuilding something that already exists, or leaking
responsibilities across package boundaries. To prevent that:

1. **Do not start coding from this document.** Each workstream (WS-A/B/C) must
   first be expanded into a detailed spec under `specs/NNN-…/` (numbering in
   §4). This document tells you the boundaries; the spec tells you the steps.
2. **Respect the verified baseline in §2.** Everything listed there already
   exists and works. Do not re-implement it. Extend it.
3. **Honor the non-goals in each workstream.** If a task is not explicitly in
   scope, it is out of scope for v0.2.
4. **Obey the architecture boundaries in §5.** They are already enforced by
   `bun run check:boundaries`; a change that needs to cross a boundary is a
   signal to re-read, not to relax the rule.
5. **The Definition of Done is the golden-path acceptance test in §1.3**, plus
   the per-workstream acceptance criteria and the verification matrix in §6. A
   workstream is not "done" until its row in §6 is green with evidence.
6. **Every behavioral change to task / plan / schedule / execution flows must
   ship with a test** (Bun-native, API, or Playwright as appropriate). This is
   already a CONTRIBUTING rule; v0.2 makes E2E coverage a CI gate (WS-A).

---

## 1. Milestone thesis

### 1.1 One-sentence goal

> Any user running a mainstream coding agent (Claude Code first) can, within ten
> minutes of setup, put a task on the schedule and have Chrona automatically
> plan it, automatically start it when due, and surface an accountable result —
> recovering through the Inbox when something blocks — without reading logs.

### 1.2 Why this milestone (rationale)

The four-layer loop (Task → Plan → Schedule → Auto-Execution) is **already built
end-to-end** (see §2). The remaining gaps to daily usability are two:

- **Reachability** — the only real execution provider is Hermes, which gates
  adoption to the few users already running a Hermes gateway.
- **Trustworthiness** — the auto-execution path is covered by unit/integration
  tests but has never been hardened against *real daily use*, and its decisions
  ("why didn't this start?") are not visible in the UI.

v0.2 closes exactly these two gaps and finishes the in-flight external-calendar
work that makes "schedule-first" credible. It deliberately does **not** broaden
the surface area (no new pages, no multi-session execution, no
production/multi-user concerns — those stay post-0.2).

### 1.3 Definition of Done — the golden path

This scripted scenario is the milestone acceptance test. It must pass as an
automated end-to-end test (WS-A delivers it) **and** be reproducible manually.

```
GIVEN a fresh Chrona install with one execution provider configured
      (Claude Code via Settings → AI Clients, bound to dispatch_task /
       execute_task_node), and the task orchestrator enabled
WHEN  I create a task with enough context to be executable
AND   I place it on a schedule block due shortly
THEN  Chrona auto-generates a plan for the due task (no manual click)
AND   Chrona auto-starts execution when the block becomes due and eligible
AND   if a node blocks / needs approval, an Inbox item explains WHY and offers
      the recovery action
AND   when I resolve the Inbox item, execution resumes to completion
AND   the final result is persisted and inspectable from the task workspace
AND   at no point did I need to read a log file to understand current state
```

Plus the negative case, equally important:

```
GIVEN a due task that is NOT eligible to auto-start
WHEN  the orchestrator tick runs
THEN  the task does not start
AND   the UI shows the specific eligibility reason (e.g. "no accepted plan",
      "requires approval", "runtime unsupported") on the task/schedule surface
```

---

## 2. Verified baseline — what already exists (do NOT rebuild)

The following was verified against the codebase on 2026-06-13. Treat it as
ground truth and build on it.

### 2.1 Auto-execution / orchestration (substantial)

| Capability | Location | Notes |
| --- | --- | --- |
| Task orchestrator loop | `packages/engine/src/modules/orchestration/task-orchestrator.ts` | `createTaskOrchestrator()`, `createDefaultTaskOrchestratorWorkers()`, lease-based, `tick()` |
| Orchestrator config | `packages/engine/src/modules/orchestration/orchestrator-config.ts` | env: `CHRONA_TASK_ORCHESTRATOR_ENABLED/INTERVAL_MS/TICK_ON_START/LEASE_*` |
| Workers (registered by default) | same module | `restart-recovery`, `due-scheduled-work`, `due-auto-plan-generation`, `graph-advancement`, `recurring-work-block-expansion` |
| Lease / ownership / recovery | `scheduler-lease-repository.ts`, `restart-recovery-worker.ts`, `reconcile-task-state.ts`, `reconcile-invariants.ts` | single-owner tick, restart recovery, invariant reconciliation |
| Auto-plan generation | `packages/engine/src/modules/scheduling/auto-generate-scheduled-plan.ts` | drives plan creation for due work |
| Auto-start | `packages/engine/src/modules/scheduling/auto-start-runner.ts`, `auto-start-scheduled-plan.ts` | starts due, eligible work |
| **Eligibility decision** | `packages/engine/src/modules/scheduling/derive-auto-start-eligibility.ts` | returns `{ok:true,...}` or `{ok:false, reason}` with reasons: `not_scheduled`, `not_due`, `already_running`, `invalid_task_status`, `no_runtime_config`, `no_accepted_plan`, `requires_human_input`, `requires_approval`, `runtime_unsupported` |

**Implication for WS-A:** the *decision* already exists and is well-structured.
The gap is (a) surfacing that decision in the UI and (b) end-to-end regression
protection — not building the engine.

### 2.2 Provider abstraction (clean, ready for a second provider)

| Capability | Location | Notes |
| --- | --- | --- |
| Provider interface | `packages/providers/foundation/src/contracts/provider.ts` → `AgentProviderClient` | methods: `provider`, `getCapabilities`, `checkHealth`, `createSession`, `startRun`, `streamRun` (AsyncIterable), `getRun`, `cancelRun`, optional `resolveApproval` |
| Foundation exports / schemas | `packages/providers/foundation/src/index.ts` | all Zod schemas + types + replay helpers |
| Reference provider | `packages/providers/hermes/src/HermesProviderClient.ts` (+ `http.ts`, `sse.ts`, `normalizers.ts`, `types.ts`) | full working implementation to mirror |
| Minimal provider template | `packages/providers/debug/src/ChronaDebugProviderClient.ts` | smallest end-to-end example |
| Engine registry | `packages/engine/src/modules/ai/runtime/client-registry.ts`, `packages/engine/src/modules/ai/providers.ts` | maps `AiClientRecord` → provider client; health checks |
| Client type union | `packages/contracts/src/ai-feature-types.ts` → `AiClientType = "llm" \| "hermes" \| "debug" \| (string & {})` | extensible by design |
| Feature bindings | AI features: `generate_plan`, `edit_plan`, `suggest`, `chat`, `dispatch_task`, `execute_task_node` | bound per-client in Settings → AI Clients |
| Agent ↔ Chrona contract | MCP tools + AI-visible refs (`chrona.task.complete`, `chrona.condition.select`, `chrona.node.block`, `chrona.node.fail`, `chrona.wait.complete`) | agents never see backend IDs |
| Hermes plugin pattern | `external-plugins/hermes/` | exposes Chrona MCP tools to the agent runtime |

**Implication for WS-B:** adding a provider is a *bounded* task — a new
`packages/providers/<name>` package implementing `AgentProviderClient`, plus
registry wiring, a config type, and a Settings UI entry. The hard part is the
runtime adapter, not the architecture.

### 2.3 External calendar (further along than expected — finish, don't build)

| Capability | Location | Notes |
| --- | --- | --- |
| DB models | `prisma/schema.prisma` → `CalendarSource`, `ImportedCalendarEvent` + enums (`CalendarSourceLifecycleState`, `CalendarEventStatus`, `CalendarSyncState`, `CalendarSyncPolicy`, `CalendarAutomationPolicy`) | `automationPolicy` defaults to `auto_plan` |
| Feed fetch + parse | `packages/integrations/src/calendar/` → `feed-fetcher.ts`, `feed-client.ts`, `parse-feed.ts`, `normalizer.ts`, `recurrence.ts`, `source-url.ts` | real ICS/feed ingestion exists |
| Service | `apps/server/src/services/external-calendar-service.ts` | `refreshSource(...)`, `allowBlockedNetwork` guard |
| Routes | `apps/server/src/routes/calendar-sources.routes.ts` | create / list / refresh / delete |
| Contracts | `packages/contracts/src/external-calendar.ts` | DTOs + request schemas |
| Reaches scheduling | `packages/engine/src/modules/pages/get-schedule-page.ts`, `apply-schedule.ts`, `move-work-block.ts` | imported events already flow into schedule reads |
| Existing E2E | `e2e/specs/external-calendar-*.spec.ts` (3 files) | management / schedule / source |

**Implication for WS-C:** the read path (subscribe to an ICS feed → import →
show on schedule) largely exists. The gaps are: (1) imported "busy" events are
**not** consulted by `derive-auto-start-eligibility` / auto-scheduling, so Chrona
can still schedule or auto-start over a real external commitment; (2) refresh is
manual, not periodic; (3) polish/UX of overlay. WS-C closes these.

### 2.4 CI / test topology

| Item | Location | Notes |
| --- | --- | --- |
| CI workflow | `.github/workflows/ci.yml` | runs typecheck, lint, `bun run test:ci` |
| `test:ci` scope | `scripts/chrona.ts` (`ci` entry) | vitest + Bun tests + API tests + LLM replay — **no Playwright E2E** |
| `test all` scope | `scripts/chrona.ts` (`all` entry) | adds Playwright |
| Playwright projects | `playwright.config.ts` | `chromium`, `tablet`, `mobile` |
| E2E specs | `e2e/specs/*.spec.ts` (14 specs) | run locally only today |

**Implication for WS-A:** the golden-path E2E exists nowhere yet and E2E is not
gated in CI. Both are WS-A deliverables.

---

## 3. Workstreams

Three workstreams. Priority order for daily-usability impact: **WS-A and WS-B
are co-P0** (reliability and reachability are the two legs of the thesis); WS-C
is **P1** (it makes the schedule-first claim honest but the loop works without
it).

---

### WS-A — Auto-execution reliability + E2E gating (P0)

**Spec to author:** `specs/016-auto-exec-reliability/`

#### Objective
Make the schedule→auto-execution loop trustworthy for daily use by (1) making
every auto-execution decision *visible*, (2) making recovery from blocked/failed
runs *obvious in the Inbox*, and (3) protecting the golden path with an
automated E2E test that runs in CI.

#### In scope
1. **Surface eligibility in the UI.** Expose the `derive-auto-start-eligibility`
   result (the `reason` when `ok:false`) on the task and/or schedule surface so
   the user can answer "why didn't this auto-start?" without logs. This is a
   read-model + UI change; the decision logic already exists — do not duplicate
   it. Add the reason to the relevant page projection
   (`packages/engine/src/modules/pages/get-schedule-page.ts` and/or the task
   page read model) and render it.
2. **Inbox recovery completeness.** Audit the Inbox so that every terminal /
   paused auto-execution state (`Blocked`, `Failed`, `WaitingForInput`,
   `WaitingForApproval`, cancelled) produces an actionable Inbox item with: a
   plain-language reason, the owning task/run, and a primary recovery action.
   Fill any gaps where a state pauses execution but produces no Inbox item.
3. **Golden-path E2E** (§1.3 positive + negative cases) as a new Playwright spec
   under `e2e/specs/`, using the existing test harness
   (`e2e/specs/task-workspace-test-helpers.ts`, the `debug` provider so it is
   deterministic and needs no real agent). Drive the orchestrator
   deterministically via `tick()` / `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START`
   rather than wall-clock waits.
4. **Gate E2E in CI.** Add a CI job (or extend `ci.yml`) that runs at least the
   `chromium` Playwright project on PRs. Keep it green; quarantine or fix flaky
   specs rather than disabling assertions. Decide and document whether E2E runs
   on every PR or as a required pre-merge job.

#### Non-goals (do NOT do in WS-A)
- No new orchestrator workers or scheduling semantics.
- No changes to lease/recovery internals beyond bug fixes uncovered by the E2E.
- No multi-session execution.
- Do **not** "fix" flakiness by relaxing assertions (this regressed before —
  see git history around `task-lifecycle-execution.spec.ts`). Harden the test or
  the product instead.

#### Acceptance criteria
- [ ] The golden-path E2E (positive + negative) passes deterministically.
- [ ] For every `ok:false` eligibility reason, there is a UI surface that shows
      it for an affected task (verified by test or screenshot).
- [ ] Each of `Blocked` / `Failed` / `WaitingForInput` / `WaitingForApproval` /
      cancelled produces an Inbox item with reason + recovery action.
- [ ] CI runs Playwright `chromium` on PRs and is green.
- [ ] No assertion in any existing E2E was weakened to achieve green.

---

### WS-B — Provider break-out: Claude Code (P0)

**Spec to author:** `specs/017-provider-claude-code/`

#### Objective
Ship the first non-Hermes execution provider so that users who already run a
mainstream coding agent can use Chrona without installing Hermes. Target
**Claude Code** first (first-class Agent SDK + native MCP support makes the
adapter and the Chrona-tool exposure cleanest). The deliverable also *validates
the provider abstraction* — if adding Claude Code requires changing
`packages/engine` business logic, the abstraction has leaked and that leak must
be fixed, not worked around.

> **Before implementing WS-B**, the agent MUST consult the `claude-code-guide`
> and `claude-api` references for current Claude Code headless / Agent SDK
> invocation, streaming event format, MCP wiring, and model IDs. Do not rely on
> training memory for SDK specifics — verify against official docs.

#### In scope
1. **New provider package** `packages/providers/claude-code/` implementing
   `AgentProviderClient` (mirror `packages/providers/hermes` structure;
   `packages/providers/debug` is the minimal template). Map each interface
   method to Claude Code headless/SDK:
   - `getCapabilities` / `checkHealth` — detect the Claude Code binary/SDK and
     report reachability + supported capabilities.
   - `createSession` / `startRun` — launch a headless Claude Code run for the
     dispatched task/node.
   - `streamRun` — adapt Claude Code's streaming output into
     `ProviderRunEvent`s (use `normalizers.ts` in Hermes as the pattern).
   - `getRun` / `cancelRun` — poll/terminate the run.
   - `resolveApproval` — map Chrona approvals if Claude Code supports
     interactive approval; otherwise omit (it is optional).
2. **Expose Chrona tools to the agent.** Provide the Claude Code equivalent of
   `external-plugins/hermes/` — register Chrona's MCP server with Claude Code so
   the agent reports outcomes via the existing AI-visible-ref tool contract
   (`chrona.task.complete`, `chrona.node.*`, etc.). Reuse the existing MCP
   surface; do not invent a new agent contract.
3. **Engine registry + config wiring.**
   - Add the provider type to `AiClientType`
     (`packages/contracts/src/ai-feature-types.ts`) and a config type
     (mirror `HermesClientConfig`).
   - Register the client in
     `packages/engine/src/modules/ai/runtime/client-registry.ts` and health
     handling in `packages/engine/src/modules/ai/providers.ts`.
4. **Settings UI.** Add a "Claude Code" client option under Settings → AI
   Clients with configuration + a diagnose/test-availability action mirroring
   the Hermes setup flow. Allow binding to `dispatch_task` / `execute_task_node`
   (and optionally `generate_plan`).
5. **Replay fixtures + tests.** Use the foundation replay helpers
   (`providers/foundation/src/replay.ts`) so the provider has deterministic
   tests that run under `CHRONA_LLM_FIXTURE_MODE=replay` in CI, matching how
   Hermes is tested.

#### Non-goals (do NOT do in WS-B)
- Do **not** move task lifecycle, plan progression, retry, or projection logic
  into the provider package (boundary rule, §5).
- Do **not** drop or bypass the AI-visible-ref MCP contract for "convenience."
- No second provider (Codex etc.) in v0.2 — Claude Code is the proof; Codex is a
  post-0.2 confirmation that the abstraction generalizes. (If the abstraction
  needed changes to support Claude Code, note them so Codex is cheap later.)
- No provider-specific behavior leaking into `apps/web` beyond the Settings
  client entry.

#### Acceptance criteria
- [ ] `packages/providers/claude-code` implements `AgentProviderClient` with no
      changes to engine *business* logic (registry/config wiring is allowed).
- [ ] A user can add + diagnose a Claude Code client in Settings and bind it to
      `dispatch_task` / `execute_task_node`.
- [ ] A dispatched task/node executes via Claude Code and reports completion
      through the existing Chrona MCP tool contract.
- [ ] Deterministic replay tests pass in CI.
- [ ] The golden path (§1.3) passes with Claude Code as the configured provider
      (in addition to the `debug`-provider E2E from WS-A).

---

### WS-C — External calendar: conflict-aware read-sync (P1)

**Spec to author:** `specs/018-external-calendar-finish/`

#### Objective
Make the existing external-calendar import *actually inform scheduling*, so
Chrona's schedule-first promise is honest: it should not auto-schedule or
auto-start over a real external commitment, and external events should refresh
without manual clicks. Read-only first; two-way write-back is out of scope.

#### In scope
1. **Conflict-aware scheduling/eligibility.** Make imported "busy" events
   (`ImportedCalendarEvent`) participate in:
   - schedule conflict detection / suggestions, and
   - `derive-auto-start-eligibility` — add a reason (e.g.
     `external_calendar_conflict`) so a task scheduled over an external event
     does not auto-start, and the reason is visible (ties into WS-A item 1).
2. **Periodic refresh.** Add an orchestrator worker (mirror the existing worker
   pattern in `packages/engine/src/modules/orchestration/`) that periodically
   calls the existing `external-calendar-service.refreshSource` for active
   sources, respecting `CalendarSyncPolicy` and the `allowBlockedNetwork` guard.
   Reuse the existing service — do not re-implement fetching.
3. **Overlay polish.** Ensure imported events are clearly distinguishable from
   Chrona work blocks on the schedule view (read-only styling, source label),
   consistent with `PRODUCT.md` design principles.

#### Non-goals (do NOT do in WS-C)
- No write-back / two-way sync (Chrona → external calendar). Read-only only.
- No new auth providers beyond what feed ingestion already supports unless the
  spec explicitly adds CalDAV/Google OAuth; default v0.2 target is ICS/webcal
  feeds already supported by `feed-fetcher.ts`. (CalDAV/Google OAuth may be
  scoped into 018 only if cheap; otherwise defer.)
- No changes to the canonical event/projection model beyond what conflict
  detection requires.

#### Acceptance criteria
- [ ] A task scheduled over an imported external event is reported as conflicted
      and does **not** auto-start; the eligibility reason is visible.
- [ ] Active calendar sources refresh automatically on the orchestrator
      interval without a manual click.
- [ ] Imported events render distinctly (read-only) on the schedule view.
- [ ] Existing `external-calendar-*` E2E specs still pass; new behavior covered
      by tests.

---

## 4. Dependencies, sequencing & milestone slices

### Dependency graph
- **WS-A and WS-B are independent** and can proceed in parallel.
- **WS-C item 1 depends on WS-A item 1** (it adds a new eligibility reason and
  reuses the same UI surface). Do WS-A item 1 first, then WS-C item 1.
- The **golden-path E2E (WS-A item 3)** should land with the `debug` provider
  first (no external dependency), then be parameterized to also run against the
  Claude Code provider once WS-B lands (WS-B acceptance criterion).

### Release slices
| Slice | Contents | Definition of done |
| --- | --- | --- |
| **0.2.0** | WS-A (all) + WS-B (all) | Golden path (§1.3) passes in CI with `debug` provider, and manually with Claude Code; eligibility + Inbox recovery visible; E2E gated in CI |
| **0.2.1** | WS-C (all) | Conflict-aware auto-start + periodic refresh + overlay polish |

Rationale: 0.2.0 delivers the thesis (reliable + reachable). 0.2.1 makes
schedule-first honest. Shipping 0.2.0 without WS-C is acceptable; shipping
without either WS-A or WS-B is not.

---

## 5. Cross-cutting guardrails (architecture — already enforced)

These are existing rules (`docs/package-boundaries.md`,
`docs/provider-boundary.md`, `docs/architecture.md` §"Architecture rules"). They
are enforced by `bun run check:boundaries`. Restated here because they are the
main drift vectors for this milestone:

1. **Routes stay thin** — parse/validate HTTP, call an engine use case. No
   business logic in `apps/server/src/routes`.
2. **Engine owns application decisions** — task lifecycle, plan progression,
   scheduling policy, eligibility, retries, projections all live in
   `packages/engine`. Providers and routes must not own these.
3. **Providers own protocol adaptation only** — `packages/providers/*` may know
   sessions, transport, streaming, tool calls, approvals; they must **not** know
   Chrona task/plan/schedule semantics. (Primary WS-B trap.)
4. **Contracts own shared schemas** — DTOs and cross-layer types in
   `packages/contracts`; do not redefine them per package.
5. **UI reads projections, submits commands** — `apps/web` must not reconstruct
   backend state from raw logs/events. (Primary WS-A trap: surface the
   eligibility *reason from the read model*, do not recompute it in the client.)
6. **Agents use the public MCP tool contract + AI-visible refs** — never expose
   backend IDs to an agent. (Primary WS-B trap.)

Every PR in this milestone must pass: `bun run typecheck`, `bun run lint`
(do not increase the warning count), `bun run check:boundaries`,
`bun run test:ci`, and — new in WS-A — the gated E2E.

---

## 6. Verification matrix (Definition of Done)

A workstream is done only when its row is green **with linked evidence**
(test name / CI run / screenshot).

| # | Claim | Evidence required |
| --- | --- | --- |
| A1 | Eligibility reason visible in UI for every `ok:false` reason | E2E/screenshot per reason |
| A2 | Every paused/terminal exec state yields an actionable Inbox item | Test per state |
| A3 | Golden path (positive+negative) passes deterministically | New Playwright spec, green |
| A4 | Playwright `chromium` gated in CI, green, no weakened assertions | CI run link + diff review |
| B1 | `claude-code` provider implements `AgentProviderClient`, no engine business-logic change | Diff scoped to `providers/*` + registry/config |
| B2 | Add/diagnose/bind Claude Code client in Settings | Manual + test |
| B3 | Task executes via Claude Code, reports via Chrona MCP tools | Integration/replay test |
| B4 | Replay tests pass in CI | CI run link |
| B5 | Golden path passes with Claude Code provider | Manual run + recording |
| C1 | Task over external event is conflicted and won't auto-start; reason visible | Test |
| C2 | Active sources auto-refresh on orchestrator interval | Test |
| C3 | Imported events render distinctly read-only | Screenshot |

---

## 7. Risks & open questions

Resolve these in the per-workstream specs before coding the affected part.

1. **WS-B — Claude Code invocation surface.** Headless CLI (`claude -p` /
   stream-json) vs Agent SDK: which gives the cleanest mapping to
   `startRun`/`streamRun`/`cancelRun` and the most reliable MCP wiring? Decide in
   spec 017 against current official docs (`claude-code-guide` / `claude-api`).
2. **WS-B — MCP exposure mechanism.** How Chrona's MCP server is registered with
   Claude Code (project `.mcp.json` vs `claude mcp add` vs SDK option) and how
   the AI-visible-ref scoping is preserved per run. Mirror the intent of
   `external-plugins/hermes`.
3. **WS-A — E2E determinism.** Confirm the orchestrator can be driven via
   explicit `tick()` / `TICK_ON_START` inside Playwright so the golden path does
   not depend on wall-clock timing. If not, add a test seam (do not add
   `sleep`-based waits).
4. **WS-A — CI cost/time.** Decide whether full 3-project Playwright runs on
   every PR or only `chromium` on PR + full on main. Default: `chromium` on PR.
5. **WS-C — feed scope.** Confirm whether 018 targets ICS/webcal feeds only
   (already supported) or also adds CalDAV/Google OAuth. Default: feeds only;
   OAuth deferred unless cheap.
6. **Generated Prisma client in VCS.** `packages/db/src/generated` (~98k lines)
   is committed while CI also runs `prisma generate`; this is a drift risk
   orthogonal to v0.2 but worth resolving (gitignore generated output) — track
   separately, not a milestone blocker.

---

## 8. Appendix — spec authoring checklist

When expanding a workstream into its `specs/NNN-…/` spec, each must contain:
- `spec.md` — problem, scope (in/out from this doc), acceptance criteria.
- `plan.md` — concrete file-level task list referencing the real symbols in §2.
- `data-model.md` — only if schema changes (WS-C conflict reason; WS-B config).
- `tasks.md` — ordered, testable steps; each step names its test.
- A verification section mapping back to the §6 rows it satisfies.
