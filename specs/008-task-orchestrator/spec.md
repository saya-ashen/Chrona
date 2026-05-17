# Feature Specification: Task Orchestrator

**Feature Branch**: `008-task-orchestrator`  
**Created**: 2026-05-17  
**Status**: Draft  
**Input**: User description: "根据之前讨论的细节，为Chrona添加一个最合适的调度器，并且是重构，选择最优方案，并且不需要兼容任何旧代码或者旧数据。"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Reliable Task Execution State (Priority: P1)

As a Chrona user running a task workspace, I need every active task to converge to a truthful execution state so I can understand whether the task is running, waiting for me, blocked, failed, or complete without contradictory badges or stale graph nodes.

**Why this priority**: The current system can show a task as running, ready, and blocked at the same time. Reliable state convergence is the core value of adding a full scheduler.

**Independent Test**: Start a task that includes automatic work, user checkpoints, conditional branches, and terminal checkpoints. The task workspace remains internally consistent through each transition and never shows impossible node progress.

**Acceptance Scenarios**:

1. **Given** a task has a graph with pending automatic nodes, **When** execution starts, **Then** exactly one user-visible overall state is shown and the current graph node reflects the active or next actionable work.
2. **Given** an automatic node completes outside the user's current page session, **When** the scheduler observes completion, **Then** downstream ready nodes advance or the task reaches a terminal state without requiring a page refresh.
3. **Given** execution cannot continue because user input, approval, or a real blocker is required, **When** the scheduler reconciles the task, **Then** the task state, graph node state, action card, and primary button all describe the same reason.

---

### User Story 2 - Scheduled Work Starts and Continues (Priority: P2)

As a user who schedules work blocks and tasks, I need due scheduled work to start on time and continue through the task graph after external work finishes so scheduled automation behaves like a dependable assistant.

**Why this priority**: Chrona already has scheduled tasks, but the current starter only begins due tasks. The complete feature must also keep active scheduled work moving.

**Independent Test**: Schedule a task to start in the near future, leave the task workspace, and confirm the task starts, advances, pauses, or completes according to the graph without manual refresh or manual restart.

**Acceptance Scenarios**:

1. **Given** a scheduled work block becomes due, **When** the scheduler processes due work, **Then** eligible work starts once and receives a visible running state.
2. **Given** scheduled work has an active automatic run, **When** the run finishes, **Then** the scheduler advances the graph to the next ready node or the correct waiting, blocked, failed, or completed state.
3. **Given** two scheduler instances are active, **When** the same scheduled work becomes due, **Then** only one instance owns and starts the work.

---

### User Story 3 - Safe Runtime Graph Changes (Priority: P3)

As a user refining a task while it is running, I need Chrona to accept safe graph changes and clearly reject unsafe changes so the plan can evolve without corrupting execution history.

**Why this priority**: Future task editing requires a scheduler that treats the graph as versioned execution state, not a static plan snapshot.

**Independent Test**: Modify a running task graph by adding future work, replacing an unstarted branch, and attempting to change an active node. Safe changes are applied with clear status updates; unsafe changes are rejected with an explanation and no partial corruption.

**Acceptance Scenarios**:

1. **Given** a task has unstarted downstream nodes, **When** the user replaces that downstream subgraph, **Then** Chrona applies the change, marks affected future work consistently, and continues execution from the correct next node.
2. **Given** a node is currently running, **When** the user attempts to remove or rewrite that active node, **Then** Chrona prevents the change unless execution is first stopped or safely cancelled.
3. **Given** a graph change makes previously completed downstream work invalid, **When** the change is accepted, **Then** Chrona clearly marks invalidated work and recalculates progress from the new graph state.

---

### Edge Cases

- Scheduler ownership expires while work is in progress; another scheduler must resume without duplicate starts or duplicate external invocations.
- External runtime reports a result late, after the user has cancelled, changed, or replaced the affected graph node.
- Runtime sync is temporarily unavailable or degraded; Chrona must show a truthful degraded state and retry without pretending the task is ready.
- A conditional branch changes after one branch already completed; only still-valid reachable work remains active, and skipped or invalidated paths remain explainable.
- A task graph contains no ready nodes and no terminal state; Chrona must surface a recoverable inconsistent state instead of leaving the task running forever.
- A terminal checkpoint appears complete while prerequisite reachable nodes are still pending; reconciliation must detect and repair or flag the impossible state.
- The server restarts during an active run, scheduled start, or graph mutation; persisted state must allow the scheduler to continue safely.
- Multiple browser sessions observe the same task; all sessions must converge to the same visible state after scheduler reconciliation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST replace the current partial scheduled-start behavior with a single orchestration capability that owns due scheduled starts, active run synchronization, graph advancement, degraded retry, and task-state reconciliation.
- **FR-002**: System MUST ensure each task has one authoritative execution state at any moment: not started, scheduled, queued, running, waiting for user, waiting for approval, blocked, failed, cancelled, or completed.
- **FR-003**: System MUST ensure task-level state, graph-level state, node-level state, action prompts, progress summary, and primary controls are derived from the same reconciled execution state.
- **FR-004**: System MUST prevent duplicate ownership of the same scheduled start, active run sync, graph advancement, or graph mutation when multiple server processes are running.
- **FR-005**: System MUST periodically reconcile active and degraded tasks without requiring a user to open or refresh the task page.
- **FR-006**: System MUST advance a task graph after asynchronous work finishes, including continuing to downstream ready nodes, pausing for user action, marking real blockers, or completing the task.
- **FR-007**: System MUST distinguish true blockers from user input waits, approval waits, ordinary pending work, skipped branches, invalidated work, failed work, and degraded runtime sync.
- **FR-008**: System MUST detect impossible or stale graph states and either repair them deterministically or surface a specific recoverable inconsistency state to the user.
- **FR-009**: System MUST record enough execution history for users and maintainers to understand what the scheduler started, synchronized, advanced, paused, retried, repaired, cancelled, invalidated, or failed.
- **FR-010**: System MUST support runtime graph changes through explicit user-visible operations such as adding future work, replacing an unstarted subgraph, removing unstarted work, invalidating downstream work, or replanning from a selected node.
- **FR-011**: System MUST reject or require safe cancellation for graph changes that would mutate currently running work or erase needed execution history.
- **FR-012**: System MUST version graph execution state so stale graph changes cannot overwrite newer scheduler or user actions.
- **FR-013**: System MUST make scheduler progress observable in the task workspace, including active node, waiting reason, blocked reason, degraded reason, and next expected action.
- **FR-014**: System MUST provide user-safe recovery actions for inconsistent or degraded tasks, such as retry sync, resume from reconciled state, cancel active execution, or replan from a valid node.
- **FR-015**: System MUST intentionally discard legacy compatibility for older scheduler state and older saved execution projections; new behavior may require resetting or rebuilding development data.

### Quality & Experience Requirements *(mandatory)*

- Scheduler ownership, graph execution, runtime synchronization, and task workspace presentation MUST remain separate concerns with a single authoritative state contract between them.
- The refactor MUST remove obsolete partial scheduler paths instead of layering compatibility adapters over them.
- The feature MUST ship with unit coverage for state reconciliation, scheduler ownership, active run sync, graph advancement, graph mutation validation, and impossible-state handling.
- The feature MUST ship with integration coverage for scheduled task start, asynchronous node completion, user-wait pause, blocker pause, cancellation, server restart recovery, and dynamic graph mutation.
- End-to-end coverage is required because this feature affects task, schedule, and navigation flows.
- User-facing copy MUST use Chrona's existing terminology and message system, and must clearly distinguish running, waiting, blocked, failed, degraded, skipped, invalidated, and completed states.
- Frontend evidence is required for any visible workspace changes: pre-edit observation and post-edit verification at desktop 1440x900, tablet 1024x768, and mobile 390x844.
- Current task, active node, blocked or review state, degraded state, and primary action MUST be visually obvious at all supported viewport sizes with no mobile horizontal scrolling.
- Backend contract changes are allowed because a complete scheduler needs a truthful state model; any changed contract must be reflected in task workspace behavior and tests.
- Scheduler work MUST remain responsive for normal local usage: user-visible state updates should appear within 10 seconds after an external run reaches a terminal state under normal conditions.

### Key Entities *(include if feature involves data)*

- **Task**: User-visible unit of work with one authoritative execution state, progress, readiness, and current action.
- **Task Graph**: Versioned plan of nodes and edges that defines reachable work, branch choices, dependencies, skipped paths, and invalidated work.
- **Graph Node**: Individual executable, checkpoint, condition, wait, approval, or user-input step with execution state, dependencies, result, and history.
- **Execution Session**: Active or historical attempt to execute a task graph version from a specific trigger such as user start or scheduled start.
- **External Run**: Asynchronous work delegated outside the scheduler that must be synchronized back into graph execution.
- **Scheduler Lease**: Ownership record that prevents multiple scheduler instances from processing the same task, run, or mutation concurrently.
- **Graph Mutation**: User-requested change to a running or paused task graph, with version checks, validation outcome, invalidation effects, and audit history.
- **Reconciliation Result**: Derived authoritative state after comparing task, graph, nodes, sessions, external runs, blockers, waits, and mutations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test suite of representative task graphs, 100% of active tasks show exactly one coherent overall state and no contradictory running, ready, blocked, or completed indicators.
- **SC-002**: 95% of external run completions are reflected in the task workspace within 10 seconds under normal local operating conditions.
- **SC-003**: Scheduled tasks that become due start exactly once in 100 consecutive due-start trials, including trials with two scheduler instances active.
- **SC-004**: 100% of graph mutation attempts on running tasks either apply completely with a new coherent state or fail with no partial graph corruption.
- **SC-005**: In restart recovery tests, active tasks resume, pause, complete, or surface a recoverable degraded state within 30 seconds after service restart.
- **SC-006**: Impossible graph states such as completed terminal nodes with pending reachable prerequisites are detected in 100% of reconciliation tests.
- **SC-007**: Task workspace users can identify the current node, blocking or waiting reason, and primary next action within 5 seconds during usability review.
- **SC-008**: All affected task workspace screens pass desktop, tablet, and mobile verification with no horizontal scrolling and no accessibility regressions in primary controls.

## Assumptions

- Existing development data and saved execution projections may be discarded, reset, or rebuilt because the user explicitly requested no legacy compatibility.
- The optimal solution is a Chrona-specific orchestrator because the core problem is graph execution convergence, dynamic graph mutation, and truthful task state, not simple timed job execution.
- The initial implementation targets Chrona's current local and single-product deployment model while preventing duplicate ownership if more than one server process runs.
- External runtime providers may be slow, temporarily unavailable, or return late results; the scheduler must treat those as normal recoverable conditions.
- Dynamic graph editing is in scope for execution semantics and safe mutation rules, even if advanced editing UI is delivered incrementally.
- Existing task workspace UX patterns remain the baseline, but backend state contracts may change to make the visible state truthful.
