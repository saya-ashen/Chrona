# Provider Boundary

Providers are protocol adapters. They connect Chrona to external AI/runtime systems, but they do not own Chrona workflow semantics.

Provider runtime code is intentionally separate from local integration management. Runtime providers send requests, stream events, parse external protocol data, and expose health/capabilities. Integration code may inspect or modify local machine state only when the user explicitly asks for setup or diagnosis.

## Core rule

Provider code may know how to:

- authenticate with an external provider
- create, resume, or virtualize provider sessions
- send requests and stream responses
- parse provider-native tool calls, text deltas, approvals, and status events
- normalize provider-native output into Chrona contracts
- expose provider health/capabilities

Provider code must not decide:

- what a Chrona task means
- how a plan node should progress
- whether a task should retry, block, fail, or complete
- how approvals change Chrona state
- how projections, Work records, or schedule state are derived

Those decisions belong in `packages/engine`.

## Stable local provider support matrix

Codex, OMP, and Claude Code are stable released providers with the same product feature surface: planning, Goal review, execution, and dashboard briefs. Codex is the default recommendation. Stable support does not imply identical provider-native protocols; capability-specific approval, reconnect, and recovery behavior remains explicit in the capability matrix.

| Provider | Support level | Release claim |
| --- | --- | --- |
| `codex` | Stable · Recommended | ACP adapter validated against OpenAI Responses-compatible endpoints, with tool-isolated planning/review, structured results, approvals, execution, and session-history recovery. |
| `omp` | Stable | In-process SDK adapter with tool-isolated planning/review, structured results, execution, local result finalization, and session-history recovery. |
| `claude_code` | Stable | Claude Agent SDK adapter with tool-isolated planning/review, structured results, execution, and provider session recovery. |
| `hermes` | Internal / hidden | Existing gateway adapter remains internal and is omitted from production Settings until explicitly restored to the released provider set. |

## Current provider packages

| Package | Role |
| --- | --- |
| `packages/providers/foundation` | Provider-neutral contracts and shared adapter shapes |
| `packages/providers/hermes` | Hermes-specific transport, session, event, and tool-call adaptation |
| `packages/providers/debug` | Development/debug execution runtime, hidden unless explicitly enabled |
| `packages/providers/omp` | In-process OMP SDK transport across the supported selectable wire protocols |
| `packages/providers/claude-code` | Claude Code CLI transport, session, stream, and tool-call adaptation |
| `packages/providers/codex` | OpenAI Codex via ACP (`codex-acp`), session, stream, MCP, and tool-call adaptation. Codex is the first ACP-backed provider; future provider work may migrate other providers toward ACP where it fits. |

## Integration packages

| Package | Role |
| --- | --- |
| `packages/integrations/hermes` | Hermes environment diagnosis, local plugin install/update, Hermes `.env` management, setup planning, and explicit gateway restart helper |

Integration packages are allowed to do side-effectful local setup work that provider packages must not do:

- inspect local CLI availability
- read or write local integration config files
- install or update an external runtime plugin
- produce manual setup guidance for remote machines
- run explicit user-requested local commands such as `hermes gateway restart`

Integration packages must keep these side effects behind explicit setup/diagnosis APIs. They should not run automatically during normal provider execution.

## Feature Runtime recovery contract

Feature Runtime bindings for side-effect-free, terminal-only AI features such as
`task.plan` and `goal.review` require one of two provider contracts:

1. authoritative cross-process attach: idempotent start plus active-run lookup
   and stream reattachment; or
2. explicit `readOnlySingleAttempt`: Chrona starts exactly one terminal-only,
   tool-isolated request. If the start or stream outcome is uncertain, Chrona
   never auto-replays it and the user starts a new operation explicitly.

The second contract is bounded to terminal-only work. It does not permit
engine-managed actions, and it does not weaken the authoritative attach
requirements for action-invoking Feature Runtime work. Codex, OMP, and Claude
Code implement this bounded contract with provider-specific tool isolation; a
local SDK/model configuration check alone is not proof of remote credentials or
model access. A real provider request is that proof.

## Session ownership

External runtimes often have native session/run IDs. The provider layer may store and translate provider-native continuity state such as:

- provider session ID
- native run ID
- response ID
- conversation continuation token
- provider approval ID

Chrona business execution state stays above the provider boundary:

- task ID
- task plan/run state
- execution session state
- node attempt state
- task status
- block/retry/failure reason

Chrona also owns execution context segmentation. Providers may preserve or compress their own native conversation history, but provider compression is not a correctness boundary. The engine decides which plan nodes share a provider session, when to switch sessions, and which structured summary is handed to the next segment.

The default long-task policy should be segment-scoped provider sessions: related nodes share one provider session, then Chrona summarizes that segment and starts the next segment with compact explicit context. Provider-native session identity must be persisted from the first trustworthy scoped event that exposes it; terminal-action cancellation must not replace a richer session-bearing snapshot with a poorer fallback. If resume is unavailable or compaction omits a required fact, Chrona marks recovery explicitly and exposes bounded prior-node semantic results through AI-visible refs.

## Standard provider responsibilities

A provider integration should converge on these capabilities:

1. declare identity and capabilities
2. validate runtime configuration
3. create or resume a session/run
4. execute a request
5. stream normalized runtime events
6. expose run/response status when the upstream supports it
7. expose or resolve provider-native approvals when applicable
8. surface errors without leaking secrets

## Hermes-specific notes

Hermes may expose native concepts such as session keys, run refs, native run IDs, history entries, tool calls, and approvals. Hermes code should normalize these into Chrona runtime events and feature results before upper layers consume them.

Hermes code should not expose a high-level `executeTask()` abstraction that embeds Chrona task lifecycle decisions. The engine starts/continues execution and decides what to do with provider events.

Hermes local setup belongs in `packages/integrations/hermes`, not `packages/providers/hermes`. Examples include checking `~/.hermes/.env`, installing the Chrona Hermes plugin, writing the plugin MCP URL, planning restart requirements, and starting `hermes gateway restart` after an explicit user action.

## ACP and Codex-specific notes

Chrona is moving provider implementations toward ACP where the upstream runtime supports it. ACP is the intended provider-boundary direction, not a legacy compatibility path.

Codex is currently the first ACP-backed provider. It uses `codex-acp` over stdio, not `@openai/codex-sdk`. Chrona starts the ACP adapter, initializes the agent, then creates or resumes a session with a Chrona HTTP MCP server entry pointing at `/api/mcp`.

The provider requires ACP HTTP MCP capability during health/startup. If `agentCapabilities.mcpCapabilities.http` is not true, the provider should fail before a run consumes model turns.

`binaryPath` and `codexPath` are operator escape hatches only. They are not AI Clients UI settings. Normal users configure model, API key, base URL, and timeout.

Codex capabilities currently mirror ACP stdio limits:

- sessions: supported
- streaming: supported
- cancellation: supported
- tool calls: supported
- run lookup/reconnect: unsupported
- Chrona provider approval bridge: unsupported

ACP-backed providers should:

- keep ACP transport/session/protocol handling below `packages/providers/*`
- pass Chrona scoped MCP control tools at runtime
- normalize text, reasoning, tool, terminal, cancellation, and failure events into provider-neutral events
- expose health and capability readiness without leaking API keys or raw provider payloads
- keep Chrona task/plan/schedule semantics in `packages/engine`

Terminal evidence remains event-based. `terminalToolName` is only prompt guidance; Chrona records completion only from actual completed/failed ACP tool updates.

Provider UI copy should describe product-level provider setup and capability readiness, not the underlying ACP transport unless the user is reading developer docs.

## Boundary with AI clients

Settings / AI Clients stores configured clients and feature bindings in the database. The engine loads the selected client for a feature such as `generate_plan`, `suggest`, `chat`, or `dispatch_task`, then calls provider/foundation-facing abstractions. There is no generic bridge chat endpoint standing in for every product capability; feature-specific flows should have explicit contracts.

Task execution has exactly one provider-selection source: an enabled `Task.aiClientId`, then the enabled `task.execution` feature binding, then the enabled default AI client. Tasks and Workspaces do not store a separate adapter/runtime selector. Provider adapter choice, provider name, capabilities, model routing, and persisted runtime provenance all derive from the resolved AI client. Internal provider packages remain protocol adapters, but adapter identity is never a user-editable task field.

## Boundary with MCP tools

MCP tools are public agent-facing contracts. They submit Chrona execution outcomes with AI-visible refs and session metadata. MCP route/tool code should translate the external call into engine-level input, but the engine remains responsible for validation, idempotency, state transition, and projection updates.

## Design checklist for new providers

Before adding provider code, decide:

1. Is this a canonical Chrona schema? Put it in `packages/contracts`.
2. Is this a provider-neutral adapter shape? Put it in `packages/providers/foundation`.
3. Is this external protocol behavior? Put it in a concrete package under `packages/providers/`.
4. Is this local install/config/diagnosis behavior for an external runtime? Put it in `packages/integrations/`.
5. Is this task/plan/schedule/execution policy? Put it in `packages/engine`.
6. Is this only HTTP route wiring? Put it in `apps/server`.

If upper layers need to parse raw provider wire format, the boundary is wrong.
