# plan-generation

## Entry point

- `index.ts` is the only public entry point for consumers.
- `contract.ts` re-exports the feature-owned blueprint contract.
- `model/plan-blueprint-compiler.ts` contains pure graph validation and compilation orchestration.
- `tests/` defends the public feature contract.

## Ownership

- Blueprint schemas live in `packages/contracts` and are re-exported by this feature.
- Blueprint validation and compilation enter through `compilePlanBlueprint`.
- Persistence, materialization, read models, and execution semantics remain private to `packages/engine`.
- Consumers must import from `@features/plan-generation`, never this feature's internal files.

## Commands
- bun run test:feature plan-generation

## Reference-slice rules

- Add layers only when this capability needs them; no empty route, service, repository, or UI layer.
- Tests exercise the public `index.ts` entry point.
- Legacy API, materialization, generation-session, and workspace-refresh tests remain mapped in `scripts/test-feature.ts` until those callers migrate.
