# Feature Specification: Harden Execution Kernel

**Feature Branch**: `013-harden-execution-kernel`  
**Created**: 2026-05-24  
**Status**: Draft  
**Input**: User description: "按照刚才讨论的继续，注意以下几点：不要保留旧代码和数据的兼容，直接按照最优方案进行设计，现在Chrona还没有发布正式版本，不需要管迁移的问题。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prevent duplicate node execution (Priority: P1)

As a Chrona user running an automated task plan, I need each plan node to execute at most once per intended attempt, even when manual starts, scheduler triggers, provider callbacks, and terminal completion signals happen close together, so that completed work is not repeated and external AI/provider side effects are not duplicated.

**Why this priority**: Duplicate execution is the root defect observed in active task runs. It creates repeated provider runs, unstable node results, user confusion, and unnecessary cost.

**Independent Test**: Can be fully tested by starting the same running task through overlapping execution triggers and verifying that only one node attempt and one provider-side run are produced for the active node.

**Acceptance Scenarios**:

1. **Given** a task plan with a ready node and no active execution, **When** two start or continuation triggers arrive concurrently, **Then** exactly one trigger becomes the active executor and the other exits without starting another node run.
2. **Given** a node already has a running attempt, **When** another eligible trigger observes the same plan before the first attempt finishes, **Then** the system reuses or observes the existing attempt instead of creating a new provider run.
3. **Given** a node has completed successfully, **When** the plan is resumed, restarted, recovered, or advanced, **Then** that node's completed result remains the effective result and its provider-side work is not executed again unless the user explicitly retries that node.

---

### User Story 2 - Make stop and pause authoritative (Priority: P1)

As a Chrona user who stops or pauses a running task, I need the task to stay stopped or paused until I explicitly resume it, so that late provider callbacks, scheduler ticks, or automatic continuations cannot silently restart execution.

**Why this priority**: Users must be able to trust stop and pause controls. Current behavior can continue or recover execution after stop, which makes the product unsafe for long-running autonomous plans.

**Independent Test**: Can be fully tested by stopping or pausing a task while a provider run is active, then delivering a late completion callback and confirming that no downstream node starts and completed prior node results are preserved.

**Acceptance Scenarios**:

1. **Given** a task is paused while a node provider run is still active, **When** that provider run later reports completion, **Then** the callback is recorded but does not advance the plan or start downstream work.
2. **Given** a task is stopped while one node is running and earlier nodes are completed, **When** stop is applied, **Then** only active running work is cancelled and previously completed results remain visible and current.
3. **Given** a stopped task remains in the task list, **When** background scheduling or recovery checks run, **Then** no new node execution begins until the user explicitly starts or resumes the task.

---

### User Story 3 - Keep node results stable and auditable (Priority: P2)

As a Chrona user reviewing a task plan, I need completed node results to remain stable, traceable, and tied to the exact execution attempt that produced them, so that I can trust the task history and understand why the plan advanced.

**Why this priority**: Stable results are necessary for user trust and for debugging autonomous work. They also make duplicate execution detectable instead of hidden by projection state.

**Independent Test**: Can be fully tested by running a multi-node task with callbacks, pause/resume, and recovery events, then verifying that each node's result, attempt, and provider run history remain consistent and queryable.

**Acceptance Scenarios**:

1. **Given** a node completes successfully, **When** later nodes run, fail, pause, stop, or recover, **Then** the completed node's effective result does not change unless an explicit retry replaces it.
2. **Given** provider callbacks arrive after the node has already been completed or superseded, **When** those callbacks are processed, **Then** they are recorded as stale or ignored for progression and cannot overwrite the effective node result.
3. **Given** the user opens the task activity/history view, **When** a node has provider events, manual terminal events, or stale callbacks, **Then** the history clearly distinguishes accepted execution events from ignored stale events.

---

### User Story 4 - Preserve strict serial execution by default (Priority: P2)

As a Chrona user running a DAG that contains independent branches, I need Chrona's configured serial execution mode to stay serial across all execution entry points, so that a plan with parallelizable branches does not accidentally run multiple AI nodes at once.

**Why this priority**: Chrona currently intends to run one node at a time. The observed bug proves serial behavior can be broken by overlapping engine entries even when the graph runner itself is configured as serial.

**Independent Test**: Can be fully tested with a plan containing multiple ready independent nodes, triggering execution from multiple sources, and verifying that no more than one provider-backed node is running at any time.

**Acceptance Scenarios**:

1. **Given** a DAG has two ready independent nodes and serial execution is active, **When** execution begins, **Then** only one node starts and the second remains pending until the first is durably completed.
2. **Given** a scheduler tick occurs while one node is running, **When** the tick evaluates the same task, **Then** it does not start another ready branch.
3. **Given** manual start, terminal continuation, runtime callback, and scheduler evaluation overlap, **When** the task is already being advanced, **Then** only the active executor can mutate execution state.

### Edge Cases

- Concurrent user start/resume clicks for the same task.
- Scheduler tick overlaps with a manual start or continuation.
- Provider completion arrives after stop, pause, retry, or a newer execution attempt.
- Terminal completion arrives before the provider run completion callback.
- A provider run starts successfully but the local process crashes before projection state is updated.
- A task has multiple ready independent DAG branches while the configured execution mode is serial.
- A stale callback references a node attempt that is no longer current.
- A user explicitly retries a completed node; this is the only normal path that may replace the node's effective result.
- A task is recovered after process restart while prior provider runs are still active.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST ensure that only one execution owner can advance a given task plan run at a time.
- **FR-002**: The system MUST reject, defer, or no-op overlapping execution triggers for the same task plan run when another owner is actively advancing it.
- **FR-003**: The system MUST assign every accepted execution advance a durable ownership token that is validated before mutating execution state.
- **FR-004**: The system MUST prevent stale execution owners from overwriting newer task, node, attempt, or result state.
- **FR-005**: The system MUST associate each node execution with a stable node attempt identity.
- **FR-006**: The system MUST prevent multiple provider-side runs from being created for the same node attempt.
- **FR-007**: The system MUST preserve a completed node's effective result until the user explicitly retries that node or replaces it through a defined user action.
- **FR-008**: The system MUST treat completed node output as a durable checkpoint that recovery and continuation can reuse without repeating provider-side work.
- **FR-009**: The system MUST record late or stale provider callbacks without allowing them to advance the plan or overwrite current node results.
- **FR-010**: The system MUST make pause and stop authoritative over automatic continuation, provider callback sync, and scheduler recovery.
- **FR-011**: The system MUST ensure stop/cancel affects active running work without invalidating completed node results from earlier nodes.
- **FR-012**: The system MUST ensure serial execution mode never runs more than one provider-backed node at the same time for a task plan run.
- **FR-013**: The system MUST require all execution entry points, including manual start, resume, scheduler advance, provider callback sync, terminal node completion, retry, pause, and stop, to follow the same ownership and fencing rules.
- **FR-014**: The system MUST expose enough execution history for users and maintainers to distinguish accepted events, ignored stale events, retries, cancellations, and recovered work.
- **FR-015**: The system MUST provide deterministic behavior after process restart: already completed nodes remain completed, active work is recovered or marked safe to resume, and no completed provider-side work is repeated automatically.
- **FR-016**: The system MUST remove obsolete legacy execution-state paths that conflict with the new execution ownership model rather than preserving compatibility with previous unpublished data.
- **FR-017**: The system MUST keep user-visible task and node status consistent across task detail views, activity/history views, and any plan graph inspector.
- **FR-018**: The system MUST allow an explicit user retry to create a new node attempt and replace the effective result only after the retry action is accepted.

### Quality & Experience Requirements *(mandatory)*

- Execution ownership, node attempts, provider-side runs, callbacks, pause, stop, retry, and recovery MUST have a single authoritative model; duplicate or conflicting legacy state sources must be removed instead of kept for compatibility.
- The task execution layer MUST have clear ownership boundaries: product task/plan data remains separate from durable execution ownership, provider-side run records, and user-visible event history.
- Automated coverage MUST include regression tests for concurrent execution triggers, serial DAG branches, stop with late callbacks, pause with late callbacks, completed-node resume, explicit retry replacement, and process-restart recovery.
- Existing product behavior around task creation, plan display, node result inspection, and activity history MUST remain understandable to users, while execution-state wording may be updated to reflect the new authoritative model.
- User-facing status and history messages MUST use existing Chrona terminology and must clearly distinguish running, paused, stopped, completed, retried, stale callback, and ignored event states.
- User-facing strings introduced by this feature MUST be localizable.
- No frontend visual redesign is required for this feature; if UI changes are made to expose new status/history distinctions, they MUST preserve existing Chrona visual patterns and must be verified on desktop, tablet, and mobile without horizontal scrolling.
- Backend behavior changes are expected because this feature changes the execution authority model; task detail and plan graph consumers MUST continue to receive coherent task and node state.
- Performance risk exists around ownership checks and event history growth; execution ownership checks MUST not create user-visible delay during normal task start/resume/stop operations.

### Key Entities *(include if feature involves data)*

- **Task Plan Run**: The user's active execution instance for a task plan. It owns the high-level task execution lifecycle and links product plan state to durable execution state.
- **Execution Owner**: The currently accepted actor allowed to advance a task plan run. It has a durable ownership token and expires or releases ownership when work completes or stops.
- **Execution Epoch**: A monotonic generation for a task plan run. It prevents stale owners, callbacks, or recovered work from mutating newer state.
- **Node Attempt**: A single intended execution attempt for a plan node. It is the unit of idempotency for provider-side work and result replacement.
- **Provider Run**: A concrete external AI/provider execution associated with one node attempt. The same node attempt cannot create multiple provider runs.
- **Node Result**: The durable checkpoint produced by a successful node attempt. It remains the effective result until explicit retry or replacement.
- **Execution Event**: A user-visible or diagnostic record of accepted progression, ignored stale callback, retry, pause, stop, cancellation, or recovery activity.
- **Stale Callback**: A provider or terminal completion signal that refers to an older epoch, owner, or node attempt and therefore must not advance current execution state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test plan with two simultaneous start/continue triggers for the same task, 100% of runs create no more than one active node execution attempt.
- **SC-002**: In a serial DAG plan with multiple ready independent branches, 100% of runs have at most one provider-backed node running at any time.
- **SC-003**: In stop and pause scenarios with late provider callbacks, 100% of callbacks are recorded without starting downstream work unless the user explicitly resumes.
- **SC-004**: In completed-node recovery scenarios, 100% of completed nodes keep their effective result and do not repeat provider-side work automatically.
- **SC-005**: In explicit retry scenarios, 100% of retries create exactly one new node attempt and replace the effective result only after the retry is accepted.
- **SC-006**: In regression tests covering the observed duplicate-execution failure, duplicate provider-side runs for the same node attempt are reduced to zero.
- **SC-007**: Users can start, pause, stop, resume, and inspect a task without seeing contradictory node statuses across task detail and plan graph views.
- **SC-008**: Normal start, pause, stop, and resume actions complete their visible state update within 1 second in local single-user operation.
- **SC-009**: Execution history for stale callbacks and ignored overlapping triggers is visible to maintainers in 100% of targeted diagnostic scenarios.

## Assumptions

- Chrona has not shipped a formal stable release, so the feature may remove or reshape unpublished execution state without compatibility migration.
- Existing local development data may be reset or regenerated during implementation and verification.
- The product should keep Chrona's current task plan and graph user experience while replacing the unsafe execution authority model underneath it.
- Serial execution remains the default expected behavior for provider-backed nodes, even when the DAG contains independent branches that could be parallelized later.
- Explicit retry is the intended user action for re-running completed node work.
- Provider-side work may be costly or irreversible, so preventing duplicate external runs is more important than maximizing automatic recovery aggressiveness.
- Durable workflow systems are a reference model for execution ownership and checkpointing concepts, but this feature does not introduce a new workflow runtime dependency.
