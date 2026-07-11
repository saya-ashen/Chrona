# external-calendar

## Structure

- `index.ts`: the only public entry point for apps and sibling features.
- `contract.ts`: request, response, and validation contracts.
- `routes.ts`: Hono adapter mounted by `apps/server`.
- `service.ts`: calendar-source use cases and synchronization orchestration.
- `repository.ts`: private Prisma persistence implementation.
- `ui/`: calendar setup, source management, schedule event composition, and client adapter.
- `tests/`: feature behavior tests; HTTP adapter integration belongs under `apps/server`.

## Ownership

- Calendar source lifecycle, synchronization, and imported-event projection belong to this feature.
- Calendar feed protocol parsing and transport belong to `packages/integrations`.
- Repository and service implementations stay private; consumers use the route factory or exported UI composition through `index.ts`.
- Layers exist because this feature has HTTP, persistence, and UI capabilities; do not add secondary public barrels or pass-through wrappers.

## Commands
- bun run test:feature external-calendar

## Public exports

- Contracts needed by consumers.
- `createCalendarSourceRoutes` and `CalendarSourceRouteOptions` for the server adapter.
- `CalendarSourceSetup`, `ExternalCalendarEventBlock`, and `listExternalCalendarEvents` for schedule composition.
- `ui.ts`, repository functions, service construction, and internal UI components are private.

## Dependency note

- `packages/integrations/src/calendar` owns provider protocol helpers and fixtures reused by this feature.
