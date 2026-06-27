# ai-clients

## Entry points
- Runtime registry: runtime/client-registry.ts
- Management service: model/ai-client-management.ts
- Model commands: model/create-ai-client.ts, model/update-ai-client.ts, model/delete-ai-client.ts, model/list-ai-clients.ts, model/update-ai-client-bindings.ts
- UI dialog: ui/ai-clients-dialog.tsx
- UI manager: ui/ai-clients-manager.tsx
- Tests: tests/

## State source
- AI clients and feature bindings persist through engine db access in model/.
- Runtime provider instances are built from contract records in runtime/client-registry.ts.
- Settings UI state is local to ui/ai-clients-manager.tsx and server RPC responses.

## Commands
- bun run test:feature ai-clients

## Public exports
- index.ts

## Legacy mappings
- packages/engine/src/modules/ai/providers.ts owns provider protocol dispatch shared with runtime features.
