# Research: MCP Task Tools

## Decision: MCP Tools Wrap Chrona-Owned Lifecycle Services

**Rationale**: The feature needs agents to mutate Task -> Plan -> Schedule -> Execution state without relying on provider-authored final JSON. Existing implementation already has Chrona-owned paths for execution dispatch, plan mutation schemas, schedule schemas, task result endpoints, engine orchestration, and provider tool-call tracing. The smallest safe design is to expose tool operations over those Chrona-owned services and keep business rules inside existing domain/engine/persistence layers.

**Alternatives considered**:

- Keep parsing final structured JSON from agent responses. Rejected because provider capabilities differ across OpenClaw, Hermes, Claude Code, OpenCode, and similar agents, and the spec requires final JSON to stop being the main lifecycle path.
- Build a parallel MCP-specific task execution engine. Rejected because it would duplicate business logic and risk divergence from human-driven flows.
- Let provider adapters apply state changes directly. Rejected because provider packages should remain transport/evidence-specific and must not own Chrona lifecycle authority.

## Decision: Reuse Existing Contracts Before Adding New Shapes

**Rationale**: `packages/contracts/src/api/execution.schema.ts` already defines execution actions, plan graph mutation input, schedule input, task result actions, assistant messages, and approval/memory operations. MCP tool inputs should map to or extend these schemas so human and agent paths share validation language and tests.

**Alternatives considered**:

- Define unrelated MCP-only operation payloads. Rejected because it creates two validation vocabularies and increases drift.
- Expose raw internal database models as tool input. Rejected because agents need stable operations, not storage details.

## Decision: Tool Results Are Authoritative, Provider Output Is Evidence

**Rationale**: OpenClaw provider code currently parses function calls and function outputs for traces, while prior structured-output paths exist for provider/session compatibility. The new trust boundary requires accepted Chrona tool results to be the source of state truth. Provider text, malformed JSON, or optional structured output can still be recorded as `AgentSessionEvidence` for debugging and history.

**Alternatives considered**:

- Merge provider final structured output with tool results. Rejected because conflicts would reintroduce non-authoritative provider data into state decisions.
- Drop provider output recording. Rejected because compatibility and observability remain required.

## Decision: Mutations Require Idempotency And Expected-State Guards

**Rationale**: Agents may retry after timeouts, lose responses, or race with humans/other agents. Existing execution actions already include optional `idempotencyKey`; the MCP surface should make retry behavior explicit for every mutating task, plan, schedule, and execution tool. Expected revision/state fields let Chrona reject stale or out-of-order operations without partial writes.

**Alternatives considered**:

- Rely on agent behavior to avoid duplicates. Rejected because retries and transport failures are expected.
- Always last-write-wins. Rejected because plan and execution state changes can conflict and must be auditable.

## Decision: Read Tools Are First-Class

**Rationale**: FR-014 requires agents to avoid guessing current state. Read tools for task, plan, schedule, and execution summaries reduce invalid mutations and give agents actionable recovery after validation failures.

**Alternatives considered**:

- Put full state in prompts only. Rejected because prompts go stale and are not reliable concurrency guards.
- Require mutation tools to accept incomplete guesses. Rejected because that moves validation/recovery into fragile natural-language loops.

## Decision: Bun-Compatible MCP Adapter, No New Dependency By Default

**Rationale**: Project rules require Bun runtime compatibility and no Node.js-only paths. No existing MCP implementation was found, so implementation can add a server-side adapter surface, but should start with project-owned contracts and only add an MCP package if it is Bun-compatible and materially reduces transport risk.

**Alternatives considered**:

- Add a dependency immediately. Rejected until implementation confirms protocol needs and Bun compatibility.
- Use Node-specific MCP server patterns. Rejected by constitution and repo rules.

## Decision: Performance Budget Applies To Operation Feedback

**Rationale**: Spec requires visible/queryable feedback within 1 second and ordinary operation completion/failure within 3 seconds. Tool handlers should validate quickly, return structured rejection instead of hanging on provider output, and avoid blocking authoritative state mutation on session evidence persistence when possible.

**Alternatives considered**:

- Wait for provider final response before applying tool state. Rejected because it keeps final output on the critical path.
- Defer all validation to background jobs. Rejected because agents need immediate recovery information.
