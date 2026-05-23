# Provider Boundary

Providers are protocol adapters. They connect Chrona to external AI/runtime systems, but they do not own Chrona workflow semantics.

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

## Current provider packages

| Package | Role |
| --- | --- |
| `packages/providers/foundation` | Provider-neutral contracts and shared adapter shapes |
| `packages/providers/hermes` | Hermes-specific transport, session, event, and tool-call adaptation |
| `packages/providers/debug` | Development/debug execution runtime, hidden unless explicitly enabled |

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

## Boundary with AI clients

Settings / AI Clients stores configured clients and feature bindings in the database. The engine loads the selected client for a feature such as `generate_plan`, `suggest`, `chat`, or `dispatch_task`, then calls provider/foundation-facing abstractions. There is no generic bridge chat endpoint standing in for every product capability; feature-specific flows should have explicit contracts.

## Boundary with MCP tools

MCP tools are public agent-facing contracts. They submit Chrona execution outcomes with AI-visible refs and session metadata. MCP route/tool code should translate the external call into engine-level input, but the engine remains responsible for validation, idempotency, state transition, and projection updates.

## Design checklist for new providers

Before adding provider code, decide:

1. Is this a canonical Chrona schema? Put it in `packages/contracts`.
2. Is this a provider-neutral adapter shape? Put it in `packages/providers/foundation`.
3. Is this external protocol behavior? Put it in a concrete package under `packages/providers/`.
4. Is this task/plan/schedule/execution policy? Put it in `packages/engine`.
5. Is this only HTTP route wiring? Put it in `apps/server`.

If upper layers need to parse raw provider wire format, the boundary is wrong.
