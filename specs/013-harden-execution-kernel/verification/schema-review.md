# Execution Schema Review

## Source Reviewed

- `prisma/schema.prisma`

## Existing Execution-Related Models

- `TaskPlanRun` stores `workspaceId`, `taskId`, `planId`, and `planRun` JSON with a unique `(taskId, planId)` key.
- `Run` stores provider/runtime run identity through `runtimeRunRef`, plus status and sync metadata.
- `Event` stores runtime/event audit records with `dedupeKey`, `nodeId`, and ingest ordering.
- `ExecutionSession` stores active execution session state with `status`, `currentNodeId`, `pauseReason`, and completed node IDs JSON.
- `WorkBlock` owns optional execution sessions for scheduled/manual execution windows.

## Gaps Against Spec 013

- No durable execution owner or lease token exists on `TaskPlanRun` or `ExecutionSession`.
- No execution epoch field exists for fencing state mutations.
- No normalized node-attempt table/model exists; attempts are currently embedded in plan-run JSON read models.
- No provider-run idempotency boundary exists at schema level for a task plan node attempt.

## Note

- `tasks.md` references `packages/db/prisma/schema.prisma`, but the actual schema path in this repository is `prisma/schema.prisma`.
