# Quickstart: External Calendar Connections

## 1. Confirm Scope

Implement read-only external calendar subscription feeds only.

Out of scope for this feature:

- Google Calendar OAuth.
- Outlook Calendar OAuth.
- Editing external events from Chrona.
- Converting imported events into Chrona tasks by default.

## 2. Add Contracts First

Define shared schemas and types for:

- Calendar source create/validate/update responses.
- Calendar source summaries with redacted URL labels.
- Imported calendar event summaries.
- Sync status and stable error codes.

Add contract tests before wiring routes or UI.

## 3. Add Data Persistence

Extend the database model for:

- Workspace-owned calendar sources.
- Imported calendar events.
- Sync health/status metadata.

Validate that disabled or removed sources do not contribute events to date-range planning queries.

## 4. Build Import Logic Outside UI and Routes

Implement calendar feed handling in shared packages:

- Validate supported subscription links.
- Fetch through server-side integration code.
- Parse feed fixtures deterministically.
- Normalize all-day, recurring, cancelled, duplicate, and time-zone cases.
- Persist imported events with stable dedupe keys.

React components and Hono route handlers should orchestrate only.

## 5. Add API Routes

Implement routes documented in [contracts/external-calendar-contract.md](./contracts/external-calendar-contract.md):

- Validate source URL.
- Create source.
- List sources.
- Update source.
- Refresh source.
- Delete source.
- Query imported events by date range.

Use local fixtures/fakes for routine API tests.

Implemented route module:

- `apps/server/src/routes/calendar-sources.routes.ts`

Focused route tests:

- `apps/server/src/__tests__/api/external-calendar-sources.bun.test.ts`
- `apps/server/src/__tests__/api/external-calendar-events.bun.test.ts`
- `apps/server/src/__tests__/api/external-calendar-source-management.bun.test.ts`

## 6. Add UI and Schedule Integration

Before editing UI, capture screenshots.

Add source management UI using existing Chrona patterns and shadcn primitives.

Implemented UI components:

- `apps/web/src/components/schedule/calendar-source-setup.tsx`
- `apps/web/src/components/schedule/calendar-source-list.tsx`
- `apps/web/src/components/schedule/calendar-source-actions.tsx`
- `apps/web/src/components/schedule/external-calendar-event-block.tsx`

Schedule integration points:

- `apps/web/src/components/schedule/schedule-page.tsx`
- `apps/web/src/components/schedule/schedule-page-main-panel.tsx`
- `apps/web/src/components/schedule/timeline/schedule-page-timeline.tsx`

Focused UI and E2E tests:

- `apps/web/src/components/schedule/calendar-source-setup.test.tsx`
- `apps/web/src/components/schedule/calendar-source-list.test.tsx`
- `apps/web/src/components/schedule/external-calendar-events.test.tsx`
- `e2e/specs/external-calendar-source.spec.ts`
- `e2e/specs/external-calendar-schedule.spec.ts`
- `e2e/specs/external-calendar-management.spec.ts`

Add imported event display to schedule/planning contexts:

- Show title, time range, source name/color, and read-only marker.
- Keep events visually distinct from Chrona tasks.
- Preserve current task, active node, blocked/review, and primary action clarity.
- Keep mobile layouts free of horizontal scrolling.

## 7. Validate

Run focused tests during development, then full required validation:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run check:ui-foundation
bun run test:e2e:desktop
bun run test:e2e:tablet
bun run test:e2e:mobile
```

For database-backed focused Bun tests, initialize an isolated SQLite file first:

```bash
bun run scripts/init-sqlite-db.ts --reset .tmp/external-calendar.db
DATABASE_URL=file:/absolute/path/to/.tmp/external-calendar.db NODE_ENV=test bun test <files>
```

## 8. Browser Evidence

After editing UI, rerun for:

- Desktop: `1440x900`.
- Tablet: `1024x768`.
- Mobile: `390x844`.

Record evidence under `specs/015-external-calendar/verification/` during implementation.

## 9. Final Report

Final response must summarize:

- New/changed files.
- New contracts or schemas.
- New tests.
- Browser evidence.
- Commands run and results.
- Remaining risks, including deferred OAuth provider connections.
