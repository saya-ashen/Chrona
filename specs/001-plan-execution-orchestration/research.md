# Research: Plan Execution Orchestration

## Decision 1: Treat accepted-plan orchestration as the canonical brownfield execution path

- **Decision**: Use `packages/runtime/src/modules/plan-execution/orchestrator.ts` and its related modules as the primary execution-layer baseline for future work.
- **Rationale**: The accepted-plan path already advances consecutive ready nodes, records waiting and blocked states, and integrates with task projection rebuilds. It is the closest existing implementation to the feature spec's execution-layer behavior.
- **Alternatives considered**:
  - Keep the legacy run-centric flow as the primary baseline. Rejected because it does not model plan-node progression as directly.
  - Design the execution layer from scratch without reference to the current orchestration loop. Rejected because the repo already contains substantial brownfield behavior that must be preserved or migrated deliberately.

## Decision 2: Document scheduling as task-level today, not as first-class work blocks

- **Decision**: Record the current state as task-level scheduling through `Task.scheduledStartAt`, `Task.scheduledEndAt`, `Task.scheduleStatus`, and `ScheduleProposal`, with no first-class `WorkBlock` or `CalendarEvent` model.
- **Rationale**: `prisma/schema.prisma`, `packages/runtime/src/modules/commands/apply-schedule.ts`, `packages/runtime/src/modules/commands/auto-start-scheduled-plan.ts`, and `packages/runtime/src/modules/queries/get-schedule-page.ts` all treat the schedule as task metadata rather than a standalone calendar/work-block aggregate.
- **Alternatives considered**:
  - Assume work blocks already exist implicitly in projections. Rejected because the persistence model and route surface do not represent them explicitly.
  - Rename scheduled task windows to work blocks in the documentation without qualification. Rejected because it would hide a core brownfield gap the implementation must resolve.

## Decision 3: Record plan graphs as an overloaded memory-backed store

- **Decision**: Document `packages/runtime/src/modules/tasks/task-plan-graph-store.ts` as the current persistence boundary for plan graphs, with draft and accepted plans stored inside `Memory` records using `task_plan_graph_v1` payloads.
- **Rationale**: This is the actual implementation used by generation, acceptance, editing, and execution flows today.
- **Alternatives considered**:
  - Describe plans as if they are first-class Prisma tables. Rejected because that is target-state architecture, not current-state truth.
  - Ignore the persistence detail and only describe plans conceptually. Rejected because it is one of the most important design constraints for future execution-layer work.

## Decision 4: Treat provider abstraction as partially complete

- **Decision**: Document the runtime adapter contracts in `packages/common/runtime-core/src/contracts.ts` and `packages/runtime/src/modules/task-execution/registry.ts` as the intended provider boundary, while explicitly calling out remaining OpenClaw coupling in route helpers and plan execution paths.
- **Rationale**: The codebase already has an adapter registry and runtime contracts, but `apps/server/src/routes/helpers.ts` and parts of execution still call OpenClaw-specific code directly.
- **Alternatives considered**:
  - Describe the system as already backend-neutral. Rejected because that would hide concrete migration work.
  - Treat provider isolation as absent. Rejected because the current abstraction layer is meaningful and should be built on rather than replaced.

## Decision 5: Treat human-in-the-loop support as present but split across models

- **Decision**: Document the current system as already supporting waiting-for-input and waiting-for-approval states across `Task`, `Run`, accepted plan nodes, approvals, and workbench projections, but without a dedicated product-level review contract for final step outputs.
- **Rationale**: Existing routes support input, resume, message, approval resolution, and result acceptance, yet these interactions remain a blend of runtime approvals and task-level actions rather than a clean per-step review workflow.
- **Alternatives considered**:
  - Assume the review model is already feature-complete. Rejected because the spec requires explicit review of user-facing/final outputs.
  - Assume human-in-the-loop behavior is missing entirely. Rejected because the repo already includes meaningful intervention flows that should be preserved.

## Decision 6: Treat resumability as implicit state spread across task, run, session, and projection records

- **Decision**: Document resumability as an emergent property of `Task`, `Run`, `TaskSession`, accepted plan node state, `RuntimeCursor`, and projection rebuilds rather than a single `ExecutionSession` aggregate.
- **Rationale**: The existing code can continue work and preserve progress, but the state is distributed and not aligned to the target spec's work-block/session language.
- **Alternatives considered**:
  - Present `TaskSession` as equivalent to the future `ExecutionSession`. Rejected because `TaskSession` is runtime/session-key oriented, not work-block or plan-node orchestration oriented.
  - Ignore resumability because there is no explicit session aggregate. Rejected because the product already supports continuation behavior that the future implementation must not regress.

## Decision 7: Use the current Hono REST surface as the contract baseline for brownfield planning

- **Decision**: Document the route surface under `apps/server/src/routes/tasks.routes.ts`, `plans.routes.ts`, and `execution.routes.ts` as the current external contract for task, plan, schedule, and execution behavior.
- **Rationale**: These routes are the integration point the SPA and future tests already rely on, and they expose the current shape of the product flow.
- **Alternatives considered**:
  - Describe only internal runtime commands. Rejected because implementation work must preserve or deliberately evolve the external API surface.
  - Treat frontend components as the main contract. Rejected because the route layer is the clearer integration boundary for brownfield architecture decisions.

## Decision 8: Prioritize boundary cleanup and explicit execution concepts before adding new backend features

- **Decision**: The next implementation phases should first stabilize the canonical execution model, introduce first-class work-block and execution-session concepts, and finish provider isolation before widening backend support.
- **Rationale**: The biggest current risks are conceptual overlap and persistence/boundary ambiguity, not missing provider names. Adding Hermes or opencode support on top of ambiguous execution ownership would increase migration cost.
- **Alternatives considered**:
  - Add more providers first. Rejected because provider growth would harden existing architectural leaks.
  - Focus only on UI changes. Rejected because the core gaps are in data ownership, orchestration boundaries, and persistence semantics.
