# external-calendar

## Entry points
- Contract: contract.ts
- Routes: routes.ts
- Service: service.ts
- Repository: repository.ts
- UI setup: ui/calendar-source-setup.tsx
- UI list/actions: ui/calendar-source-list.tsx, ui/calendar-source-actions.tsx
- UI event block: ui/external-calendar-event-block.tsx
- Client API: ui/client.ts
- Tests: tests/

## State source
- Calendar source state comes from repository rows mapped in service.ts.
- UI state is local to ui/calendar-source-setup.tsx and ui/calendar-source-list.tsx.

## Commands
- bun run test:feature external-calendar

## Public exports
- index.ts

## Legacy mappings
- packages/integrations/src/calendar owns provider protocol helpers and fixtures reused by this feature.
