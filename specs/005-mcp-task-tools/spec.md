# Feature Specification: MCP Task Tools

**Feature Branch**: `005-mcp-task-tools`  
**Created**: 2026-05-14  
**Status**: Draft  
**Input**: User description: "Redesign Chrona agent integration and task execution so Chrona exposes task, plan, schedule, and execution operations as MCP tools. Agents should call Chrona tools to create, modify, and advance internal state; Chrona tools own business logic and return trusted structured results. Agent-generated structured JSON must not remain the main path because backend capabilities vary across Hermes, Hermes, Claude Code, OpenCode, and similar agents."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agents Advance Chrona State Through Tools (Priority: P1)

An agent working on a Chrona task can discover and call Chrona-owned tools to create or update tasks, modify plans, schedule work, and advance execution state without having to produce a Chrona-specific JSON document for Chrona to parse.

**Why this priority**: This is the core shift in the integration model and removes the most fragile dependency on inconsistent agent structured-output behavior.

**Independent Test**: Can be fully tested by running an agent session that uses only Chrona-provided tools to move a task from task creation through plan update and execution progress, with Chrona state reflecting each accepted operation.

**Acceptance Scenarios**:

1. **Given** an active agent session and an existing Chrona workspace, **When** the agent calls the Chrona tool for creating or updating a task, **Then** Chrona validates the request, updates task state, and returns a structured confirmation that matches the resulting task state.
2. **Given** an agent has a task with an editable plan, **When** the agent calls a Chrona plan operation tool, **Then** Chrona applies the permitted plan change, records the reason for the change, and returns the updated plan state.
3. **Given** a task is ready to progress, **When** the agent calls a Chrona execution operation tool, **Then** Chrona advances execution according to current task and plan rules and returns the new execution state.

---

### User Story 2 - Chrona Owns Business Rules And Trust Boundaries (Priority: P2)

Chrona operators and product users can trust that agent-driven changes obey the same task, plan, schedule, and execution rules as human-driven changes, because agents request operations and Chrona decides what is valid.

**Why this priority**: Tool exposure is only safe if Chrona remains the authority for validation, state transitions, idempotency, permissions, and auditability.

**Independent Test**: Can be fully tested by submitting valid, invalid, duplicate, out-of-order, and unauthorized tool calls and verifying that Chrona accepts only valid operations while returning clear failure results for all others.

**Acceptance Scenarios**:

1. **Given** an agent requests a state transition that violates the current task lifecycle, **When** Chrona evaluates the tool call, **Then** the operation is rejected with a structured error and no state is changed.
2. **Given** an agent repeats a tool call with the same operation intent, **When** Chrona receives the duplicate request, **Then** Chrona prevents duplicate side effects and returns the current authoritative result.
3. **Given** an agent requests an operation outside its allowed workspace or task scope, **When** Chrona evaluates the request, **Then** Chrona rejects it and records the rejected attempt for observability.

---

### User Story 3 - Legacy Agent Output Becomes Non-Primary (Priority: P3)

Developers integrating different agent backends can keep using provider-specific text or structured outputs for display, diagnostics, or optional assistance, while Chrona state changes rely on Chrona tool calls instead of parsing agent-authored final JSON.

**Why this priority**: Existing integrations may still emit structured results, but those results should not be required for reliable task progression across agents with different capabilities.

**Independent Test**: Can be fully tested by running sessions against agent backends with different structured-output capabilities and verifying that Chrona state progression succeeds when tool calls are available, even if final structured JSON is absent or malformed.

**Acceptance Scenarios**:

1. **Given** an agent backend does not reliably return structured JSON, **When** it uses Chrona tools during the session, **Then** task, plan, schedule, and execution state still progress successfully.
2. **Given** an agent emits malformed or incomplete structured output after already using Chrona tools, **When** the session completes, **Then** Chrona preserves authoritative state from tool results and treats the malformed output as non-authoritative session content.
3. **Given** an existing backend still returns a structured result, **When** Chrona records the session, **Then** the structured result may be retained as supporting output without overriding validated tool-owned state.

---

### Edge Cases

- Agent calls a plan operation for a task that has no accepted or editable plan yet.
- Agent calls an execution operation while a task is blocked, waiting for approval, or already completed.
- Agent supplies stale state expectations while another user or agent has changed the task or plan.
- Agent retries a mutating operation after a timeout or lost response.
- Agent backend supports text only, partial tool capability, or provider-specific tool metadata.
- Tool call returns a validation error that the agent must use to correct the next action.
- Session output conflicts with Chrona's already accepted tool result.
- Multiple agents attempt to modify the same task, plan, schedule, or execution session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Chrona MUST expose agent-callable operations for the core lifecycle of Task -> Plan -> Schedule -> Execution.
- **FR-002**: Chrona MUST provide task operations that allow agents to create tasks, update task details, query task state, and mark task-level outcomes through Chrona-owned validation.
- **FR-003**: Chrona MUST provide plan operations that allow agents to create, revise, inspect, and explain plan changes without requiring the agent to return a complete parsed plan document as the primary path.
- **FR-004**: Chrona MUST provide schedule operations that allow agents to propose, set, update, clear, or inspect schedule state according to Chrona scheduling rules.
- **FR-005**: Chrona MUST provide execution operations that allow agents to start, resume, advance, retry, block, unblock, cancel, or complete execution state according to the current task and plan lifecycle.
- **FR-006**: Chrona MUST make each accepted tool result the authoritative structured result for the operation it performed.
- **FR-007**: Chrona MUST reject invalid, unauthorized, stale, conflicting, or out-of-order tool calls with structured failure results and without applying partial state changes.
- **FR-008**: Chrona MUST record enough operation context for accepted and rejected agent tool calls to support debugging, audit trails, and task activity history.
- **FR-009**: Chrona MUST support idempotent handling for mutating tool calls so retries do not create duplicate tasks, duplicate plan changes, duplicate schedule changes, or duplicate execution progress.
- **FR-010**: Chrona MUST preserve compatibility with agent session content as non-authoritative evidence when that content does not come from a Chrona-owned operation result.
- **FR-011**: Chrona MUST stop treating agent-authored final structured JSON as the required main path for creating plans, modifying plans, or advancing task execution.
- **FR-012**: Chrona MUST present tool availability and failure reasons clearly enough for agents to recover from validation errors by choosing a valid next operation.
- **FR-013**: Chrona MUST keep human-driven and agent-driven task lifecycle changes consistent so the same business rules determine valid state transitions regardless of initiator.
- **FR-014**: Chrona MUST expose enough state-reading operations for agents to avoid guessing current task, plan, schedule, or execution status before requesting a mutation.

### Quality & Experience Requirements *(mandatory)*

- Chrona MUST preserve existing product boundaries between task state, plan state, schedule state, execution state, and provider session content; agent integration changes must not move business authority into provider-specific responses.
- Changed behavior MUST ship with automated coverage for successful tool calls, validation failures, idempotent retries, stale-state conflicts, and sessions where final structured agent output is absent or invalid.
- User-facing task workspace behavior MUST remain consistent with existing task, plan, schedule, execution, loading, success, and error terminology.
- Agent-facing results MUST be predictable, concise, and actionable so supported agents can decide the next operation without parsing natural language.
- State-changing operations MUST provide visible or queryable feedback within 1 second under normal local conditions and complete or return a failure within 3 seconds for ordinary task lifecycle operations.

### Key Entities *(include if feature involves data)*

- **Agent Tool Operation**: A Chrona-owned operation an agent can request for task, plan, schedule, or execution state; includes operation name, input, validation outcome, resulting state, and error details when rejected.
- **Tool Result**: The trusted structured outcome returned by Chrona after applying or rejecting an operation; includes status, affected entity identifiers, state summary, and recovery information when relevant.
- **Task**: The user goal or work item being created, planned, scheduled, and executed.
- **Plan**: The ordered or graph-based representation of work for a task, including revisions and reasons for change.
- **Schedule**: The timing or work block information associated with when task work should occur.
- **Execution State**: The current runtime progress of a task plan, including active, waiting, blocked, completed, canceled, and retryable states.
- **Agent Session Evidence**: Provider-specific conversation, text, tool trace, or optional structured output retained for observability but not treated as authoritative state mutation unless produced by Chrona-owned operations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of normal agent-driven task lifecycle actions in supported local test scenarios complete through Chrona-owned tool results without requiring final agent-authored JSON.
- **SC-002**: 100% of invalid or stale mutating tool calls in automated tests leave Chrona state unchanged and return a structured failure result.
- **SC-003**: Duplicate retries for mutating agent operations produce no duplicate state changes in 100% of covered retry scenarios.
- **SC-004**: Agent sessions without valid final structured output can still complete task creation, plan revision, scheduling, and execution progress in covered end-to-end scenarios.
- **SC-005**: Ordinary accepted or rejected lifecycle operations return actionable feedback within 3 seconds under normal local test conditions.
- **SC-006**: Existing human-facing task workspace flows continue to pass their current behavioral checks with no visible terminology or state regression.
- **SC-007**: Developers can integrate a new agent backend that supports Chrona tool calls without adding backend-specific parsing of final structured plan or execution JSON for the main lifecycle path.

## Assumptions

- MCP-compatible tool exposure is the intended agent-facing operation surface, while Chrona may keep provider-specific adapters for transport, session recording, or diagnostics.
- Existing task, plan, schedule, and execution domain concepts remain valid; the feature changes how agents mutate them, not the overall product lifecycle.
- Existing structured output handling can remain only where needed for compatibility, display, or historical evidence, but it must not override Chrona-owned tool results.
- Human-driven task workspace actions remain in scope for consistency checks, but redesigning the entire user interface is out of scope for this feature.
- The first version should prioritize core lifecycle operations over every possible task metadata or reporting action.
