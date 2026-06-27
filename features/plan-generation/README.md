# plan-generation

## Entry points
- Contract: contract.ts
- Compiler model: model/plan-blueprint-compiler.ts
- Read-model bridge: index.ts
- Tests: tests/

## State source
- Blueprint contracts live in packages/contracts/src/ai-plan-blueprint.ts and are re-exported here.
- Runtime generation events/state remain in @chrona/contracts/ai plan-runtime.
- Persistence/materialization and execution semantics remain in packages/engine.

## Commands
- bun run test:feature plan-generation

## Public exports
- index.ts

## Legacy mappings
- API, engine materialization, web generation session, and workspace refresh tests stay mapped in scripts/test-feature.ts.
