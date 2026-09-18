# Work records and meeting follow-through

Status: implemented, locally validated, and deployed to the explicitly authorized Chino instance on 2026-09-17. This is a separate slice after B1–B3 result integration. Writes still default off for other installations. Chino enables them explicitly; Pi uses a new least-privilege `chrona-work` connection and installed work-record skill. Existing credentials and connections remain unchanged; open Pi sessions require `/reload`.

## Product boundary

A work record extends one existing `Task`; it is not another task, result, or execution system. New capture creates manual, non-automatic work without a Provider, Plan, Run, execution session, notification, or external side effect. Existing open manual tasks can opt in without changing their ID, schedule, or results. Managed, automatic, recurring, and closed tasks cannot be converted through this API.

Participation, email reply, calendar handling, and whether a meeting happened are independent **attributed reports**, not verified external facts. Meeting cancellation, result acceptance, and task completion remain separate. An email timeout stays unknown until an external tool reconciles its outcome; Chrona never sends or retries the email.

The Web workbench provides a prominent next step, individual signal cards, linked sources, progress/receipt history, reviewable meeting changes, and the existing result/attachment UI. `/work` lists records; Action Center also shows work needing follow-up without replacing execution approvals. Manual tasks with records open the workbench by default; `?view=execution` retains the original task workspace. An existing eligible manual task can enable recording explicitly.

## Authority and discovery

Read `chrona_context_read.capabilities.workRecords` on the intended MCP connection:

- `contractVersion: 1`, `manualCaptureOnly: true`, `externalSideEffects: false`, `notifications: false`.
- `work-read`: `tasks:read` + `work:read`.
- `work-record`: the above plus `work:write`.
- Writes also require operator-enabled `CHRONA_WORK_WRITES_ENABLED=true`.
- MCP `canResolve` is always false. Contributors can propose changes, not confirm them, complete tasks, publish/review results, or execute work through these scopes.
- Existing presets, including legacy `full`, do not inherit these scopes. New explicit enrollment is required. The authorized deployment created `pi-nikki-work-record` with only `tasks:read`, `work:read`, and `work:write`; it did not expand any existing credential.

Owner HTTP retains the existing owner/API-key and trusted-Origin boundary. Owner authority is **not proof of a human action**; a network-trusted owner endpoint is not a sandbox for scoped MCP clients. Never bypass missing MCP authority through owner HTTP. Actor identity comes from authentication, not supplied fields or text saying “the user approved.”

## API

| MCP tool | Owner HTTP | Purpose |
| --- | --- | --- |
| `chrona_work_search` | `POST /api/work-records/search` | Bounded query, attention filter, or exact source lookup |
| `chrona_work_read` | `POST /api/work-records/read` | Context, independent signals, schedule snapshot, sources, pending changes, history, capabilities |
| `chrona_work_capture` | `POST /api/work-records/capture` | Register new manual work or enroll an eligible existing Task |
| `chrona_work_update` | `POST /api/work-records/update` | Associate source, report progress, propose change; owner-only resolve |

`GET /api/work-records/capabilities` discovers owner-side capability. This path is intentionally separate from legacy `/api/work/*` execution commands. JSON POST bodies use the strict schemas in `packages/contracts/src/work/index.ts`; responses are `no-store`.

### Capture and source identity

Capture accepts `requestId`, `title`, optional `description`, `context`, `sources`, and `nextAction`; optional `taskId` selects an existing task. Meeting context requires `window: { startsAt, endsAt, timezone }` with offset timestamps, an IANA timezone, and positive duration. Other context fields are `organizer`, `participants`, `joinUrl`, and `agenda`. General work may omit a window. Display links are HTTPS without credentials and are never fetched by this service.

Each source contains `kind: email|calendar|reference`, `system`, `account`, `externalId`, `label`, and optional `url`. Identity is workspace + kind + system + account + external ID, not title or URL. Callers should use stable canonical system/account identifiers and occurrence-aware IDs. Repeated capture returns `outcome: existing` without updating metadata or adding other supplied sources. Conflicting source associations require reconciliation, never an automatic merge.

A known `calendarEventId` uses the existing imported-event identity and must already belong to the same workspace/task. Enrollment reuses native calendar associations; it does not create a second event or reparent one. Existing task title and time window must match. General enrollment without a window retains the current schedule. Native subscription-owned time blocks remain protected and must be reconciled through the existing source workflow, not this API. Automatic/AI calendar tasks and recurring series are not silently converted.

### Updates and changes

Read before updating. Supply `expectedRevision: work-v1:<taskId>:<revision>` and a fresh request UUID for each intent:

- `source`: associate one source; an already-linked identity is a no-op.
- `report`: append `summary`, optionally one `signal`, `receiptRef`, associated `sourceId`, `reportedAt`, `nextAction`, and `needsAttention`.
- `propose`: store a `reschedule` window or `cancel` reason. No immediate schedule change.
- `resolve`: owner-only `entryId`, `decision: apply|dismiss`, and `reason`.

Signal dimensions/values:

| Dimension | Values |
| --- | --- |
| participation | unknown, accepted, declined, tentative |
| reply | unknown, pending, sent, failed |
| calendar | unknown, pending, accepted, declined, failed |
| meeting | unknown, upcoming, happened |

Unknown/failed/pending reports and unresolved changes keep the record in follow-up even if a caller requests clearing attention. Closed tasks remain readable but leave the attention-only list and reject new record writes. Receipt references are evidence pointers, not verified delivery receipts or permission grants.

A proposal becomes stale after any later record update. Applying also checks the current Chrona schedule, rejecting external changes or source-owned blocks. Dismiss and repropose against current context; do not blindly replace revisions. Applied rescheduling updates only Chrona-owned placement; cancellation clears that placement and sets the record's cancelled flag. Neither changes Task lifecycle, external calendars, participants, results, or deadline.

### Retry, bounds, and errors

Writes commit record/history and a durable actor-scoped `WorkCommand` receipt atomically. Identical retries return the original receipt after rechecking current authorization and the write flag. Reusing a UUID with different normalized arguments conflicts. Receipts state `executionStarted: false` and `taskStatusChanged: false`; reread for current state. Store exact request UUID/arguments across Agent sessions. The Web mutation retry retains them only within the current page session.

- Request: 32 KiB; response: 128 KiB.
- Context: 12 KiB; sources: 12, each at most 3 KiB.
- Pending changes: 8; history: 2000 entries/record.
- Workspace: 2000 records and 10000 command receipts.
- Search/history: `offset`, `limit` 1–20; follow returned `nextOffset` because byte-budget clipping may shorten a page.
- Errors: unauthorized/forbidden 401/403, not found 404, validation 400 (HTTP body limit 413), revision/idempotency conflict 409, precondition/quota 412, sanitized storage failure 500.

## Persistence and validation

`WorkRecord`, `WorkSource`, `WorkEntry`, and `WorkCommand` extend Task/Workspace with source uniqueness, scope guards, append-only history and immutable receipts. Existing Task deletion remains the domain deletion path. The current mutable release line includes a checksum-keyed amendment for deployed B3 schema; released migration SQL bytes remain unchanged. Fresh installation, previous-release upgrade, and B3-to-work-record upgrade are tested. The authorized live migration followed online/stopped backups and an exact-schema rehearsal; all old data remained intact. Downgrade is not a binary-only operation; retain data and use a separately reviewed compatible recovery path.

Local validation: full `bun run test`, typecheck, UI foundation, boundaries, release consistency, Linux build and packaged upgrade/backup/restore smoke passed. Meeting workbench and existing results E2E each passed 12 tests at desktop/tablet/mobile sizes. Full lint still reports two untouched baseline ratchet blockers; new modules lint clean. Details and scope exclusions: [Chinese delivery record](../zh/work-records-meetings.md).

The repository-owned [work-records Agent skill](../../packages/skills/chrona-work-records/SKILL.md) is installed in the authorized Pi integration and verified by the actual loader inside/outside the project. A frontmatter quoting error found during installation was corrected in the source/installed skill after the application snapshot was frozen; this independent skill fix is recorded separately and does not change the deployed server archive.

Live transport verification enrolled the existing technical-validation Task (no new Task or schedule), preserved its published result/attachment, verified source dedupe and exact-request retries, kept an explicitly simulated reply status unknown, and rejected contributor resolution. Web observation confirmed next action, provenance/history, and the original result's human-review controls. No review was submitted on the user's behalf. Goal asset reuse, legacy Run result unification, native calendar live-state convergence, mailbox/calendar writes, notifications, and external-Agent scheduling remain outside this slice.
