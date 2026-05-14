# Implementation Plan: MCP Task Tools

**Branch**: `005-mcp-task-tools` | **Date**: 2026-05-14 | **Spec**: `specs/005-mcp-task-tools/spec.md`
**Input**: Feature specification from `specs/005-mcp-task-tools/spec.md`

## Summary

Chrona will move agent-driven task lifecycle changes from provider-authored final structured JSON to Chrona-owned MCP tool operations. The implementation should reuse existing task, plan, schedule, and execution business paths first: shared schemas in `packages/contracts`, task/execution orchestration in `packages/engine`, persistence in `packages/db`, provider tool-call tracing in provider packages, and Hono/Bun server boundaries in `apps/server`. MCP tools become a transport and agent-facing contract over Chrona-owned operations; accepted tool results are authoritative, while provider text or structured output remains non-authoritative session evidence.

## Technical Context

**Language/Version**: TypeScript strict; Bun >=1.3.11 runtime; React 19/Vite SPA unaffected except for existing task workspace consistency checks.  
**Primary Dependencies**: Existing Hono API server, Prisma 7 with `prisma-adapter-bun-sqlite`, Zod contracts in `packages/contracts`, engine services in `packages/engine`, OpenClaw provider bridge/tool-call tracing in `packages/providers/openclaw`. No new dependency is planned unless implementation proves an MCP server/client package is required and Bun-compatible.  
**Storage**: Existing SQLite through Prisma task, plan, schedule/work block, execution session, run, activity/event, and tool-call detail records. New persistence should be limited to idempotency/audit fields only if existing records cannot prove retries and accepted/rejected tool operations.  
**Testing**: Vitest for domain/contract/engine behavior, Bun API tests for Hono/MCP integration where Bun runtime paths are required, provider tests for tool-call bridging, and existing workspace tests for no human-flow regression. Required proof commands: `bun run typecheck`, `bun run lint`, `bun run test`, plus `bun run test:api` or `bun run test:bun` for server/runtime coverage when touched.  
**Target Platform**: Local Chrona Bun/Hono server and supported agent runtimes that can call MCP-compatible tools.  
**Project Type**: Monorepo web application and agent runtime integration: `apps/server`, `apps/web`, `packages/contracts`, `packages/domain`, `packages/db`, `packages/engine`, `packages/providers/*`, and runtime/provider support packages.  
**Performance Goals**: Agent-facing state-changing tool calls return accepted/rejected feedback within 1 second for validation-only paths and complete or fail within 3 seconds for ordinary task lifecycle operations under normal local conditions; no additional polling loop is introduced for existing workspace flows; provider session recording should not block accepted Chrona state changes beyond the 3 second operation budget.  
**Constraints**: No Next.js patterns; Bun-compatible runtime only; business logic stays out of React components and Hono route handlers; shared Zod schemas live in `packages/contracts`; pure rules live in `packages/domain`; database access stays in `packages/db`; provider-specific OpenClaw logic remains under `packages/providers/openclaw`; MCP/tool transport must not become the source of task lifecycle business authority; structured final JSON from agents cannot override Chrona-owned tool results.  
**Scale/Scope**: Core lifecycle operations for Task -> Plan -> Schedule -> Execution, including state reads, mutations, idempotency, stale-state rejection, audit/evidence capture, and compatibility with existing provider session content. Scope excludes a full task workspace UI redesign, every possible task metadata operation, and replacing all provider adapters in v1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan preserves ownership boundaries: tool contracts in `packages/contracts`, business validation in domain/engine layers, persistence in `packages/db`, provider details in provider packages, and Hono/MCP handlers as transport adapters only. Smallest correct design is to wrap existing lifecycle services instead of rewriting task execution.
- **Testing**: PASS. Required coverage includes contract validation, successful tool calls, invalid/unauthorized/stale/conflicting calls, idempotent retries, absent/malformed final structured output, provider tool-call traces, and no regression for existing human task workspace flows. Proof commands are listed in Technical Context.
- **User Experience Consistency**: PASS. Feature preserves current task, plan, schedule, execution, loading, success, and error terminology; agent-facing failures must be concise and actionable, and human workspace flows must not change semantics.
- **Performance Budgets**: PASS. Budgets are explicit in Technical Context: validation feedback within 1 second, ordinary lifecycle completion/failure within 3 seconds, and no new polling loop or blocking provider evidence path.

## Project Structure

### Documentation (this feature)

```text
specs/005-mcp-task-tools/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── chrona-mcp-task-tools.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
apps/server/
└── src/
    ├── routes/tasks/
    │   └── execution.routes.ts
    └── ...                 # MCP/tool transport handlers if implemented server-side

packages/contracts/
└── src/api/
    └── execution.schema.ts  # Existing task, plan, schedule, execution schemas to extend/reuse

packages/domain/
└── src/...                 # Pure lifecycle validation shared by human and agent paths when needed

packages/db/
└── src/...                 # SQLite/Prisma persistence and audit/idempotency support

packages/engine/
└── src/
    ├── services/task-execution.service.ts
    └── modules/plan-execution/task-plan-execution.ts

packages/providers/
└── openclaw/
    └── src/...             # Provider tool-call evidence remains provider-specific

apps/web/
└── src/...                 # Existing task workspace regression checks only unless UI needs status display
```

**Structure Decision**: Use the existing monorepo ownership areas and add the thinnest MCP/tool adapter around current Chrona lifecycle services. Do not introduce a parallel task execution model or provider-owned business path.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved clarifications:

- MCP is the agent-facing operation surface for this feature, but Chrona's internal contracts remain Zod/TypeScript contracts shared across Hono, engine, and tests.
- Existing `executionActionBodySchema`, plan mutation schema, schedule schemas, and task result endpoints are the first reuse targets for tool inputs rather than creating unrelated operation names.
- Current provider tool-call parsing in OpenClaw is evidence/trace infrastructure, not the authority for applying task lifecycle changes.
- Idempotency must be explicit for mutating tool calls. Existing execution actions already accept optional `idempotencyKey`; task, plan, and schedule tool operations need equivalent semantics if not already available.
- Stale-state protection should use expected revision/state fields for plan/task/schedule/execution mutations, with structured rejection and no partial writes.
- No existing MCP files or implementation were found, so implementation should add a new adapter surface while preserving existing API and engine paths.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/chrona-mcp-task-tools.md`, and `quickstart.md`.

Key design decisions:

- Define a `ChronaToolOperation` envelope with operation name, actor/session context, target identifiers, idempotency key for mutations, optional expected state/revision, and operation-specific payload.
- Define `ChronaToolResult` as the only authoritative mutation result. It returns `accepted`, `rejected`, or `noop`, affected entity identifiers, state summary, idempotency status, audit reference, and recovery guidance.
- Expose read tools before mutation tools so agents can inspect current task, plan, schedule, and execution state instead of guessing.
- Reuse the same business services behind human and agent operations. MCP handlers should validate transport input, call Chrona services, and translate results; they should not contain lifecycle rules.
- Keep provider final structured output as `AgentSessionEvidence`. It may be displayed or audited, but cannot override accepted Chrona tool results.
- Treat concurrent/stale operations as expected failures: reject with current state summary, expected-vs-actual metadata, and a safe next action.
- Preserve existing streaming execution behavior for human UI while offering MCP operation results suitable for non-SSE tool callers.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design keeps MCP transport separate from contracts, domain/engine rules, persistence, and provider-specific traces. It extends existing lifecycle paths instead of replacing them.
- **Testing**: PASS. `quickstart.md` defines required proof for schema contracts, service behavior, MCP integration, provider compatibility without final JSON, idempotency, stale rejection, and standard repo validation commands.
- **User Experience Consistency**: PASS. Human UI behavior remains a regression surface, while agent-facing messages reuse Chrona lifecycle terminology and structured recovery details.
- **Performance Budgets**: PASS. Contracts and quickstart retain 1 second feedback and 3 second ordinary operation budgets; evidence recording must not block authoritative state mutation beyond the operation budget.

## Complexity Tracking

No constitution violations. No complexity exceptions approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
