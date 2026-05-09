# Chrona Engine Boundary Plan

This package owns Chrona application behavior. It should be runnable by Bun and
must not depend on the HTTP server, Hono, React, or route-layer concerns.

The server should become a transport adapter: validate HTTP input, call the
engine boundary, and map engine results or typed engine errors to HTTP
responses. It should not orchestrate engine internals directly.

## Current State

- `apps/server` depends on `@chrona/engine`; `@chrona/engine` does not depend on
  the server. This direction is correct.
- The package can run in the Bun runtime through its existing modules and DB
  access. A separate deployment unit is not currently required.
- The boundary is still too wide. `src/index.ts` exports many low-level command,
  query, projection, runtime, and AI functions directly.
- Server routes import many engine internals and perform orchestration that
  belongs behind an engine application boundary.
- Error mapping is mostly string-based in routes. Engine errors should be typed
  so the transport layer does not inspect message text.

## Target Boundary

Expose one local engine facade from this package:

```ts
const engine = createChronaEngine({
  db,
  logger,
  runtimeRegistry,
  aiClients,
});
```

The facade is an in-process service object, not a separate HTTP service. It is
the only public application boundary used by `apps/server`, CLI adapters, and
future Bun workers.

Suggested shape:

```ts
engine.tasks.create(input)
engine.tasks.update(input)
engine.tasks.delete(input)
engine.tasks.getPage(input)
engine.tasks.list(input)

engine.tasks.schedule.apply(input)
engine.tasks.schedule.clear(input)
engine.tasks.schedule.propose(input)
engine.tasks.schedule.decideProposal(input)

engine.tasks.plan.getState(input)
engine.tasks.plan.patch(input)
engine.tasks.plan.accept(input)
engine.tasks.plan.generate(input)
engine.tasks.plan.stopGeneration(input)
engine.tasks.plan.materialize(input)

engine.tasks.execution.dispatch(input)

engine.tasks.lifecycle.complete(input)
engine.tasks.lifecycle.reopen(input)
engine.tasks.result.accept(input)

engine.pages.getSchedule(input)
engine.pages.getInbox(input)
engine.pages.getMemory(input)
engine.pages.getWork(input)

engine.workspaces.list(input)
engine.workspaces.getDefault(input)
engine.workspaces.getOverview(input)

engine.aiClients.list(input)
engine.aiClients.create(input)
engine.aiClients.update(input)
engine.aiClients.delete(input)
engine.aiClients.test(input)
engine.aiClients.updateBindings(input)
```

## Package Layout

Planned structure:

```text
packages/engine/src/
  engine.ts                # createChronaEngine() and facade assembly
  errors.ts                # EngineError and typed error codes
  ports.ts                 # DB, logger, runtime, AI client dependencies
  services/
    tasks.service.ts
    task-schedule.service.ts
    task-plan.service.ts
    task-execution.service.ts
    task-lifecycle.service.ts
    pages.service.ts
    workspaces.service.ts
    ai-clients.service.ts
  modules/                 # internal implementation details
  index.ts                 # narrow public exports only
```

`modules/*` should remain implementation detail. Server code should not import
from `modules/*` or directly from individual command/query files.

## Migration Rules

- No compatibility layer is required for old engine exports.
- No old database migration path is required. The local database can be deleted
  and regenerated when schemas change.
- Prefer direct refactors over deprecations, aliases, or dual-write paths.
- Keep public engine inputs explicit and typed. Avoid `Record<string, unknown>`
  except at true extension boundaries such as runtime-specific execution config.
- Keep HTTP concepts out of the engine. No Hono `Context`, HTTP status codes,
  route paths, request objects, or response helpers in `@chrona/engine`.
- Keep UI concepts out of the engine. Page read models are allowed, but React,
  loader, and component concerns are not.

## Migration Plan

1. Add the facade without changing behavior.
   - Create `src/engine.ts`, `src/ports.ts`, and `src/errors.ts`.
   - Wrap existing command/query functions behind service methods.
   - Keep existing modules as internal implementation.

2. Introduce typed engine errors.
   - Add `EngineError` with stable codes such as `TASK_NOT_FOUND`,
     `WORKSPACE_NOT_FOUND`, `INVALID_TASK_STATE`, `PLAN_GENERATION_IN_FLIGHT`,
     `VALIDATION_FAILED`, and `CONFLICT`.
   - Replace route-level `message.includes(...)` checks with code-based mapping.
   - Let the server own HTTP status mapping.

3. Pass the facade into server routes.
   - Build one engine instance during server startup.
   - Change route factories to receive `engine` instead of importing command and
     query functions directly.
   - Keep route files responsible only for validation, auth/workspace scoping,
     calling `engine.*`, and JSON responses.

4. Move orchestration out of routes.
   - Move plan generation, plan patching, schedule proposal decisions, execution
     dispatch, and AI client tests behind service methods.
   - Routes should not compose multiple low-level engine operations unless that
     composition is purely transport-related.

5. Narrow `src/index.ts`.
   - Export `createChronaEngine`, `ChronaEngine`, engine input/output types, and
     typed errors.
   - Stop exporting internal modules, commands, queries, projections, and runtime
     helpers from the public package root.

6. Make Bun runtime entry points explicit.
   - Add Bun-facing entry points for background schedulers, workers, or scripts
     if they need to run the engine without HTTP.
   - These entry points should instantiate the same facade and call service
     methods directly.

7. Clean up tests around the new boundary.
   - Add service-level tests for `engine.tasks.*`, `engine.pages.*`, and
     `engine.aiClients.*`.
   - Keep route tests focused on transport behavior.
   - Remove tests that rely on internal command/query exports unless they are
     true unit tests colocated with the internal module.

## Non-Goals

- Do not introduce a separate HTTP, RPC, or queue-based engine deployment unless
  there is a concrete runtime need.
- Do not preserve old public exports as deprecated aliases.
- Do not add DB migrations for removed legacy fields during this refactor.
- Do not make the server a workflow orchestrator again after the facade exists.
