# API Architecture Assessment

## Scope

This note captures the remaining API issues discovered during the `apps/server/src/routes` review after removing endpoints that were unused by the web app. It is intentionally a brownfield assessment, not a redesign spec.

## Recommended Sequence

1. Refactor plan-related functionality first.
2. After the plan refactor settles, address the broader API and route-architecture cleanup below.

That order matters because several of the current API problems are tightly coupled to the existing plan generation, plan mutation, and plan execution flows.

## Remaining Issues

### 1. Route-layer boundary leaks

Several route files still perform direct database access or provider wiring instead of delegating through the intended runtime and db boundaries.

- `apps/server/src/routes/tasks.routes.ts`
- `apps/server/src/routes/plans.routes.ts`
- `apps/server/src/routes/execution.routes.ts`
- `apps/server/src/routes/ai.routes.ts`
- `apps/server/src/routes/helpers.ts`

This conflicts with the repo boundary rules that keep route handlers thin and move business logic into runtime/domain/db layers.

### 2. Execution contracts mix two models

The execution surface still blends:

- accepted-plan orchestration
- legacy raw runtime run handling

That means endpoints like `POST /tasks/:taskId/run`, `POST /tasks/:taskId/retry`, `POST /tasks/:taskId/input`, and `POST /tasks/:taskId/message` can change behavior based on hidden task state instead of a clearly separated contract.

### 3. Plan APIs are still too graph-internal

The current plan surfaces expose internal graph mutation details directly:

- `POST /api/ai/batch-apply-plan`
- `POST /api/tasks/:taskId/plan`

These are useful for the current product, but they are not yet a stable public contract. They combine multiple responsibilities and expose low-level mutation semantics that are likely to change during the plan refactor.

### 4. Route namespaces remain mixed

Current route organization still crosses concerns:

- `plans.routes.ts` exposes `/ai/*` plan endpoints
- `execution.routes.ts` also owns assistant-message and scheduling-adjacent behavior
- `ai.routes.ts` still contains task-mutating and scheduling-related logic alongside AI client management

This makes ownership and future contract evolution harder to reason about.

### 5. Workspace validation is inconsistent

Workspace scoping is still not enforced consistently across surviving task routes. Some handlers validate through upstream commands or route-specific checks, while others rely on optional query parameters or direct task lookup.

The result is an uneven authorization and data-isolation story even before formal auth is considered.

## Follow-up Direction After Plan Refactor

Once the plan refactor is complete, the next cleanup pass should focus on:

1. Moving route logic behind runtime-facing commands and queries.
2. Separating plan-execution contracts from provider-run contracts.
3. Replacing graph-operation endpoints with clearer, versioned plan commands.
4. Reorganizing routes so URL namespaces and file ownership align.
5. Making workspace scoping explicit and uniform across task-facing endpoints.
