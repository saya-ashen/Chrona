# Current State Inventory: Task Orchestrator

## Scheduler Removal Targets

- `packages/engine/src/modules/scheduling/auto-start-runner.ts` owns the existing interval scheduler, environment flags, in-process `inFlight` guard, and startup singleton.
- `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.ts` owns due scheduled work lookup, eligibility checks, work block activation, direct plan execution start, and skipped-start event emission.
- `packages/engine/src/services/runtime.service.ts` exposes `startAutoStartScheduler()` through the engine runtime service.
- `apps/server/src/bootstrap-runtime.ts` starts the existing scheduler during server bootstrap with a process-local `schedulerStarted` flag.

## Replacement Boundaries

- The new orchestrator module owns lifecycle, leases, due starts, active run synchronization, graph advancement, degraded retry, reconciliation, mutation processing, and scheduler event recording.
- Existing scheduling code should either delegate to orchestrator-owned flows or be removed after the orchestrator provides equivalent behavior.
- Runtime service and server bootstrap should start the orchestrator lifecycle instead of the old auto-start runner.
- No compatibility adapter is required for old scheduler state or saved execution projections.
