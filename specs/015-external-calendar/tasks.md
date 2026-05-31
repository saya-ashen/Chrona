# Tasks: External Calendar Connections

**Input**: Design documents from `/specs/015-external-calendar/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/external-calendar-contract.md, quickstart.md

**Tests**: Required by spec and constitution. Include contract/schema tests, parser/normalizer unit tests, database tests, API tests, component tests, e2e viewport validation, and final `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:bun`, `bun run test:api`, `bun run check:ui-foundation`, `bun run test:e2e:desktop`, `bun run test:e2e:tablet`, `bun run test:e2e:mobile`.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks.
- **[Story]**: User-story label for story phase tasks only.
- Every task includes an exact file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare calendar-specific scaffolding, fixtures, and generated documentation folders.

- [X] T001 Create external calendar verification folder in specs/015-external-calendar/verification/.gitkeep
- [X] T002 [P] Add deterministic valid, empty, malformed, recurring, all-day, cancelled, timezone, duplicate, and oversized iCalendar fixtures under packages/integrations/src/calendar/fixtures/
- [X] T003 [P] Add external calendar fixture README documenting fixture intent in packages/integrations/src/calendar/fixtures/README.md
- [X] T004 Add selected pure TypeScript iCalendar parser dependency to package.json and bun.lock

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, persistence, import logic, and API plumbing required before user stories can be completed.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Align PATCH source contract with enable/disable requirements in specs/015-external-calendar/contracts/external-calendar-contract.md
- [X] T006 [P] Define calendar source, event, sync status, validation, and error-code Zod schemas in packages/contracts/src/external-calendar.ts
- [X] T007 Export external calendar contract types from packages/contracts/src/index.ts
- [X] T008 [P] Add contract/schema tests for valid source summaries, redacted responses, validation failures, and imported event summaries in packages/contracts/src/external-calendar.test.ts
- [X] T009 Add CalendarSource and ImportedCalendarEvent Prisma models with workspace relations and unique dedupe constraints in prisma/schema.prisma
- [X] T010 Add database query helpers for calendar source CRUD and event date-range reads in packages/db/src/external-calendar.ts
- [X] T011 [P] Add database tests for source lifecycle, disabled/removed filtering, and event dedupe in packages/db/src/external-calendar.bun.test.ts
- [X] T012 Implement URL validation, scheme normalization, and privacy-safe redaction helpers in packages/integrations/src/calendar/source-url.ts
- [X] T013 Implement feed fetch abstraction with injectable fixture/fake transport in packages/integrations/src/calendar/feed-client.ts
- [X] T014 Implement iCalendar parsing and occurrence expansion wrapper in packages/integrations/src/calendar/parse-feed.ts
- [X] T015 Implement event normalization for missing titles, all-day ranges, recurring instances, cancellations, timezone conversion, and duplicate keys in packages/domain/src/calendar/normalize-imported-events.ts
- [X] T016 [P] Add integration/domain tests for URL validation, redaction, parsing, recurrence, all-day, cancelled, malformed, timezone, duplicate, and oversized fixtures in packages/integrations/src/calendar/calendar-import.bun.test.ts
- [X] T017 Export calendar domain helpers from packages/domain/src/index.ts
- [X] T018 Implement calendar source service orchestration for validate, create, list, patch, refresh, delete, and date-range events in apps/server/src/services/external-calendar-service.ts
- [X] T019 Register calendar source and calendar event Hono routes in apps/server/src/routes/calendar-sources.routes.ts
- [X] T020 Mount external calendar routes under workspace API routing in apps/server/src/routes/api.ts
- [X] T021 Add shared web client functions for validation, source CRUD, refresh, and date-range events in apps/web/src/lib/external-calendar-client.ts
- [X] T022 Add external calendar i18n messages for setup, validation, source status, read-only labels, errors, and destructive confirmation in apps/web/src/lib/i18n/messages.ts

**Checkpoint**: Foundation ready. User story implementation can now begin in priority order or in parallel by separate implementers.

---

## Phase 3: User Story 1 - Add a Read-Only Calendar Source (Priority: P1) MVP

**Goal**: User can add a supported read-only subscription calendar link, see validation feedback, and confirm imported events exist with a source identity.

**Independent Test**: Add a valid fixture-backed public or private subscription link with a display name, confirm source is saved with redacted URL label and imported events, then try invalid/unsupported links and confirm actionable rejection without saving.

### Tests for User Story 1

- [X] T023 [P] [US1] Add API tests for validate/create success, invalid URL rejection, malformed feed rejection, empty calendar success, and URL redaction in apps/server/src/__tests__/api/external-calendar-sources.bun.test.ts
- [X] T024 [P] [US1] Add component tests for add-source form loading, empty, success, and error states in apps/web/src/components/schedule/calendar-source-setup.test.tsx
- [X] T025 [P] [US1] Add e2e test for adding a read-only calendar source and rejecting an invalid link in e2e/specs/external-calendar-source.spec.ts

### Implementation for User Story 1

- [X] T026 [US1] Capture pre-edit agent-browser schedule/settings observation for source setup at 1440x900, 1024x768, and 390x844 in specs/015-external-calendar/verification/us1-pre-ui.md
- [X] T027 [US1] Implement calendar source setup form with name, URL, color, validation result, read-only guidance, and submit states in apps/web/src/components/schedule/calendar-source-setup.tsx
- [X] T028 [US1] Integrate source setup form into the schedule/settings surface without changing unrelated task behavior in apps/web/src/components/schedule/schedule-view.tsx
- [X] T029 [US1] Wire add-source API state, optimistic-safe submit handling, and invalid-link error mapping in apps/web/src/lib/external-calendar-client.ts
- [X] T030 [US1] Show connected source empty state and initial imported-event count after create in apps/web/src/components/schedule/calendar-source-setup.tsx
- [X] T031 [US1] Capture post-edit agent-browser verification for valid source add, invalid source rejection, empty source state, and no mobile horizontal scroll in specs/015-external-calendar/verification/us1-post-ui.md
- [X] T032 [US1] Validate US1 performance budget for source validation/save under 2 seconds with fixture transport in specs/015-external-calendar/verification/us1-performance.md

**Checkpoint**: US1 is fully functional and independently testable as MVP.

---

## Phase 4: User Story 2 - See External Events in Planning Context (Priority: P2)

**Goal**: Imported external calendar events appear in schedule/planning contexts as read-only busy blocks, visually distinct from Chrona tasks and other sources.

**Independent Test**: With a known fixture calendar connected, open schedule/planning views and confirm external events show title, time range, source, color, read-only status, overlap visibility, and no Chrona task duplication.

### Tests for User Story 2

- [X] T033 [P] [US2] Add API tests for date-range calendar event query, enabled-source filtering, cancelled-event exclusion, and task non-creation in apps/server/src/__tests__/api/external-calendar-events.bun.test.ts
- [X] T034 [P] [US2] Add domain tests for planning busy block projection and overlap distinction in packages/domain/src/calendar/planning-busy-blocks.bun.test.ts
- [X] T035 [P] [US2] Add component tests for external event rendering, source label/color, read-only marker, overlap display, and responsive layout in apps/web/src/components/schedule/external-calendar-events.test.tsx
- [X] T036 [P] [US2] Add e2e test for schedule display of imported events on desktop, tablet, and mobile in e2e/specs/external-calendar-schedule.spec.ts

### Implementation for User Story 2

- [X] T037 [US2] Implement planning busy block projection helper for enabled non-cancelled imported events in packages/domain/src/calendar/planning-busy-blocks.ts
- [X] T038 [US2] Implement date-range event query route returning read-only imported events scoped by workspace/source/date in apps/server/src/routes/calendar-sources.routes.ts
- [X] T039 [US2] Fetch external events alongside existing schedule data without changing task scheduling contracts in apps/web/src/components/schedule/schedule-view.tsx
- [X] T040 [US2] Render external calendar event blocks with title, time range, source name/color, read-only marker, and overlap distinction in apps/web/src/components/schedule/external-calendar-event-block.tsx
- [X] T041 [US2] Preserve current task, active node, blocked/review state, and primary action clarity while external events are visible in apps/web/src/components/schedule/schedule-view.tsx
- [X] T042 [US2] Capture agent-browser verification for external event display, overlaps, desktop/tablet/mobile responsiveness, and no mobile horizontal scroll in specs/015-external-calendar/verification/us2-post-ui.md
- [X] T043 [US2] Validate schedule responsiveness with 5 sources and 500 visible imported events in specs/015-external-calendar/verification/us2-performance.md

**Checkpoint**: US2 is independently testable with fixture calendar data and does not create Chrona tasks.

---

## Phase 5: User Story 3 - Manage Calendar Sources and Sync Status (Priority: P3)

**Goal**: User can view source health, refresh, rename, recolor, disable, re-enable, and remove calendar sources with clear sync status and destructive confirmation.

**Independent Test**: Add multiple sources, rename/recolor one, refresh one, disable and re-enable one, remove one after confirmation, and confirm source list plus schedule visibility reflect each state.

### Tests for User Story 3

- [X] T044 [P] [US3] Add API tests for list, rename, recolor, disable, enable, refresh success, refresh partial failure, refresh failure preservation, and idempotent delete in apps/server/src/__tests__/api/external-calendar-source-management.bun.test.ts
- [X] T045 [P] [US3] Add database tests for refresh status metadata, stale error clearing, removed source exclusion, and disabled source event hiding in packages/db/src/external-calendar-management.bun.test.ts
- [X] T046 [P] [US3] Add component tests for source row health fields, refresh state, rename/recolor controls, enable/disable, remove confirmation, and latest error display in apps/web/src/components/schedule/calendar-source-list.test.tsx
- [X] T047 [P] [US3] Add e2e test for source management disable, re-enable, refresh, rename, and remove flows in e2e/specs/external-calendar-management.spec.ts

### Implementation for User Story 3

- [X] T048 [US3] Implement source list UI with enabled state, last successful refresh, next expected refresh, latest error, and redacted URL label in apps/web/src/components/schedule/calendar-source-list.tsx
- [X] T049 [US3] Implement rename, recolor, disable, enable, refresh, and remove actions with loading, success, partial-sync, failure, and destructive confirmation states in apps/web/src/components/schedule/calendar-source-actions.tsx
- [X] T050 [US3] Complete PATCH, refresh, and DELETE route behavior for source metadata, lifecycle state, sync status, and idempotent removal in apps/server/src/routes/calendar-sources.routes.ts
- [X] T051 [US3] Ensure disabled and removed source events disappear from schedule queries immediately while re-enabled sources avoid duplicates in apps/server/src/services/external-calendar-service.ts
- [X] T052 [US3] Capture agent-browser verification for source management states and desktop/tablet/mobile no-horizontal-scroll behavior in specs/015-external-calendar/verification/us3-post-ui.md

**Checkpoint**: US3 is independently testable and source state changes are reflected in source management and schedule views.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, privacy hardening, documentation, and regression checks across all stories.

- [X] T053 [P] Audit user-facing errors and logs for private URL/token leakage in apps/server/src/services/external-calendar-service.ts
- [X] T054 [P] Audit browser state and component props for private URL leakage in apps/web/src/components/schedule/calendar-source-list.tsx
- [X] T055 [P] Update implementation quickstart notes with final route/component/test names in specs/015-external-calendar/quickstart.md
- [X] T056 Run `bun run typecheck` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T057 Run `bun run lint` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T058 Run `bun run test` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T059 Run `bun run test:bun` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T060 Run `bun run test:api` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T061 Run `bun run check:ui-foundation` and record result in specs/015-external-calendar/verification/final-commands.md
- [X] T062 Run `bun run test:e2e:desktop`, `bun run test:e2e:tablet`, and `bun run test:e2e:mobile` and record results in specs/015-external-calendar/verification/final-commands.md
- [X] T063 Run quickstart validation and summarize changed files, new contracts/schemas, new tests, browser evidence, commands, and remaining OAuth/provider risks in specs/015-external-calendar/verification/final-report.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T002 and T003 can run in parallel.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational; MVP delivery slice.
- **US2 (Phase 4)**: Depends on Foundational and benefits from US1-created connected-source UI/data; can be tested with seeded fixture data if US1 UI is incomplete.
- **US3 (Phase 5)**: Depends on Foundational and can be developed against seeded sources; full user flow benefits from US1/US2.
- **Polish (Phase 6)**: Depends on desired story phases being complete.

### User Story Dependencies

- **US1 (P1)**: First delivery target; no other story dependency after foundation.
- **US2 (P2)**: Can start after foundation with seeded imported events; integrates naturally after US1.
- **US3 (P3)**: Can start after foundation with seeded sources; integrates naturally after US1 and US2.

### Within Each User Story

- Tests are written first and should fail before implementation.
- Services and routes rely on foundational contracts, persistence, and import logic.
- UI work requires pre-edit `agent-browser` evidence where specified and post-edit verification before story closure.
- Story is complete only when its independent test criteria, automated tests, browser evidence, and performance notes are satisfied.

## Parallel Opportunities

- T002 and T003 can run in parallel during setup.
- T006, T008, T011, T016 can run in parallel after T005 where they touch separate package test/source files.
- US1 tests T023, T024, and T025 can run in parallel before US1 implementation.
- US2 tests T033, T034, T035, and T036 can run in parallel before US2 implementation.
- US3 tests T044, T045, T046, and T047 can run in parallel before US3 implementation.
- Privacy/documentation audits T053, T054, and T055 can run in parallel during polish.

## Parallel Example: User Story 1

```bash
Task: "Add API tests for validate/create success, invalid URL rejection, malformed feed rejection, empty calendar success, and URL redaction in apps/server/src/__tests__/api/external-calendar-sources.bun.test.ts"
Task: "Add component tests for add-source form loading, empty, success, and error states in apps/web/src/components/schedule/calendar-source-setup.test.tsx"
Task: "Add e2e test for adding a read-only calendar source and rejecting an invalid link in e2e/specs/external-calendar-source.spec.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add API tests for date-range calendar event query, enabled-source filtering, cancelled-event exclusion, and task non-creation in apps/server/src/__tests__/api/external-calendar-events.bun.test.ts"
Task: "Add domain tests for planning busy block projection and overlap distinction in packages/domain/src/calendar/planning-busy-blocks.bun.test.ts"
Task: "Add component tests for external event rendering, source label/color, read-only marker, overlap display, and responsive layout in apps/web/src/components/schedule/external-calendar-events.test.tsx"
Task: "Add e2e test for schedule display of imported events on desktop, tablet, and mobile in e2e/specs/external-calendar-schedule.spec.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add API tests for list, rename, recolor, disable, enable, refresh success, refresh partial failure, refresh failure preservation, and idempotent delete in apps/server/src/__tests__/api/external-calendar-source-management.bun.test.ts"
Task: "Add database tests for refresh status metadata, stale error clearing, removed source exclusion, and disabled source event hiding in packages/db/src/external-calendar-management.bun.test.ts"
Task: "Add component tests for source row health fields, refresh state, rename/recolor controls, enable/disable, remove confirmation, and latest error display in apps/web/src/components/schedule/calendar-source-list.test.tsx"
Task: "Add e2e test for source management disable, re-enable, refresh, rename, and remove flows in e2e/specs/external-calendar-management.spec.ts"
```

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete US1 tests T023-T025 and confirm they fail before implementation.
3. Complete US1 implementation T026-T032.
4. Validate a user can add a valid read-only subscription source, see imported events/source identity, and receive actionable invalid-link feedback.

### Incremental Delivery

1. Deliver US1 to prove source add/import and privacy-safe redaction.
2. Deliver US2 to make imported events useful in schedule/planning context without task conversion.
3. Deliver US3 to build trust through refresh, disable, rename, remove, and health visibility.
4. Complete Phase 6 validation and final report.

### Team Parallelization

1. One implementer can own contracts/database/import foundation.
2. One implementer can own API service/routes/tests after foundational schemas stabilize.
3. One implementer can own UI/component/e2e work per user story after API contracts are available.
