# Feature Specification: External Calendar Connections

**Feature Branch**: `015-external-calendar`  
**Created**: 2026-05-30  
**Status**: Draft  
**Input**: User description: "帮我规划一下应该怎么向Chrona中添加连接外部日历的功能"

## Clarifications

### Session 2026-05-30

- Q: How much external calendar event history and future range should Chrona retain for planning? → A: Retain past 30 days and next 90 days
- Q: What observability should external calendar sync provide without exposing private calendar data? → A: Log source ID, sync state, event counts, duration, and error category only

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a Read-Only Calendar Source (Priority: P1)

As a Chrona user, I want to add an external calendar subscription link so Chrona can show my existing commitments alongside my tasks without requiring me to manually re-enter events.

**Why this priority**: This is the smallest useful slice of external calendar integration and validates the core value before adding provider-specific account connections.

**Independent Test**: Can be fully tested by adding a valid public or private subscription calendar link and confirming imported events appear in Chrona with their source clearly identified.

**Acceptance Scenarios**:

1. **Given** a user has a valid external calendar subscription link, **When** they add it to Chrona with a display name, **Then** Chrona saves the calendar source and shows upcoming events from that source.
2. **Given** a user enters an unsupported or invalid calendar link, **When** they try to save it, **Then** Chrona prevents the source from being added and explains what needs to be corrected.
3. **Given** an added calendar source contains no upcoming events, **When** the user views the connected calendar, **Then** Chrona shows an empty state that confirms the source is connected.

---

### User Story 2 - See External Events in Planning Context (Priority: P2)

As a Chrona user, I want imported external calendar events to appear in my planning views so I can understand my unavailable time before scheduling tasks.

**Why this priority**: External calendars are valuable only if they inform Chrona planning decisions, not merely exist as isolated imported data.

**Independent Test**: Can be tested by adding a calendar with known events and confirming those events are visible in the relevant schedule or planning view without creating duplicate Chrona tasks.

**Acceptance Scenarios**:

1. **Given** an external calendar source has upcoming events, **When** the user opens a planning or schedule view, **Then** the imported events are visible with title, time range, calendar source, and read-only status.
2. **Given** imported events overlap with Chrona tasks or other imported events, **When** the user reviews the schedule, **Then** the overlapping commitments remain visible and distinguishable.
3. **Given** a user views Chrona on desktop, tablet, or mobile, **When** external events are displayed, **Then** the view remains usable without horizontal scrolling.

---

### User Story 3 - Manage Calendar Sources and Sync Status (Priority: P3)

As a Chrona user, I want to manage connected calendar sources so I can disable, refresh, rename, or remove calendars when my needs change.

**Why this priority**: Source management prevents stale or unwanted calendar data from reducing trust in Chrona.

**Independent Test**: Can be tested by adding multiple sources, changing their settings, triggering refresh, and confirming each source's state is reflected in the calendar views.

**Acceptance Scenarios**:

1. **Given** a user has multiple connected calendar sources, **When** they open calendar source settings, **Then** each source shows name, enabled state, last successful refresh, next expected refresh, and latest error if any.
2. **Given** a user disables a calendar source, **When** they return to planning views, **Then** events from that source no longer influence the visible schedule until re-enabled.
3. **Given** a user removes a calendar source, **When** they confirm removal, **Then** Chrona removes the source and its imported events from future views.

---

### Edge Cases

- Calendar link is reachable but contains malformed calendar data.
- Calendar link requires authentication or expires after being added.
- Calendar events include missing titles, all-day ranges, recurring rules, cancelled occurrences, or time zones different from the user's local time zone.
- Multiple calendar sources contain the same event.
- Refresh is delayed, fails repeatedly, or returns fewer events than before.
- Very large calendars include more events than Chrona should show in a normal planning window.
- User removes a source while its events are visible in another open view.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to add a read-only external calendar source using a supported subscription link format.
- **FR-002**: The system MUST validate calendar links before saving them and provide a user-readable reason when validation fails.
- **FR-003**: Users MUST be able to provide or edit a display name and visual identifier for each calendar source.
- **FR-004**: The system MUST import upcoming events from enabled calendar sources and preserve their title, time range, all-day status, source, and read-only nature.
- **FR-005**: The system MUST display imported events in Chrona planning or schedule contexts without converting them into Chrona tasks by default.
- **FR-006**: Imported events MUST be visually distinguishable from Chrona-created tasks and from events belonging to other external sources.
- **FR-007**: Users MUST be able to view each source's connection health, last successful refresh, next expected refresh, and latest actionable error.
- **FR-008**: Users MUST be able to refresh, disable, re-enable, rename, and remove calendar sources.
- **FR-009**: The system MUST prevent disabled or removed calendar sources from affecting the user's visible schedule.
- **FR-010**: The system MUST handle recurring events, all-day events, cancelled events, duplicate events, and time zone differences in a predictable user-facing way.
- **FR-011**: The system MUST communicate that first-release external calendar sources are read-only and that edits must be made in the original calendar.
- **FR-012**: The system MUST protect private calendar links from unnecessary exposure in user-facing screens after initial entry.
- **FR-013**: The system MUST provide loading, empty, success, partial-sync, and failure states for calendar source setup and refresh.
- **FR-014**: The system MUST make imported events available for planning awareness so users can identify busy time before scheduling work.
- **FR-015**: The system MUST keep authenticated provider connections such as Google Calendar or Outlook Calendar outside the first-release scope unless added by a later specification.

### Quality & Experience Requirements *(mandatory)*

- The feature MUST preserve existing Chrona task, schedule, and planning behavior unless the external calendar source is explicitly enabled by the user.
- The feature MUST keep calendar-source management, imported event display, and planning-awareness behavior independently testable.
- The feature MUST include automated coverage for successful import, invalid source handling, source disable/removal behavior, time zone display, recurring event handling, and duplicate protection.
- If navigation, schedule, or task planning flows are changed, end-to-end coverage MUST verify the affected primary flows.
- User-facing text MUST follow existing Chrona terminology and localization practices.
- Calendar setup and management screens MUST include clear loading, empty, success, error, and destructive-confirmation states.
- Frontend visual or interaction changes MUST include pre-edit browser observation and post-edit verification evidence at desktop 1440x900, tablet 1024x768, and mobile 390x844.
- Mobile views MUST avoid horizontal scrolling while keeping event time, source, and primary actions visible.
- Current task, active node, blocked/review state, and primary action visibility MUST remain at least as clear as before on affected planning screens.
- Backend API behavior SHOULD remain scoped to external calendar data and MUST NOT change unrelated task or execution contracts for visual polish alone.
- The feature MUST keep normal planning and schedule views responsive for users with several connected calendars and a typical month of events.
- Calendar sync observability MUST record source ID, sync state, event counts, sync duration, and error category without logging private calendar links, event titles, descriptions, locations, attendees, or raw calendar payloads.

### Key Entities *(include if feature involves data)*

- **Calendar Source**: A user-added external calendar connection, including display name, visual identifier, enabled state, privacy-safe connection reference, refresh status, and lifecycle state.
- **Imported Calendar Event**: A read-only event originating from a calendar source, including title, time range, all-day status, recurrence-derived occurrence details, cancellation state, source relationship, and deduplication identity.
- **Calendar Sync Status**: The observable health state for a source, including last successful refresh, next expected refresh, current progress, and latest user-actionable error.
- **Planning Busy Block**: A schedule commitment derived from an imported event that helps Chrona show unavailable time without becoming a task.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can add a valid external calendar subscription and see upcoming events in Chrona in under 2 minutes.
- **SC-002**: At least 95% of valid calendar subscription links tested during acceptance import their next 30 days of events without manual correction.
- **SC-003**: Users can identify which external calendar produced an event with 100% accuracy in usability review tasks.
- **SC-004**: Users can disable or remove a calendar source and confirm its events no longer appear in planning views within 30 seconds.
- **SC-005**: Calendar setup, refresh, and planning views remain usable on desktop, tablet, and mobile with no horizontal scrolling.
- **SC-006**: Failed or unsupported calendar sources produce actionable error guidance in 100% of tested failure scenarios.
- **SC-007**: Imported external events do not create duplicate Chrona tasks unless a user explicitly chooses a future task-conversion action.
- **SC-008**: Planning views remain responsive for a user with 5 connected calendars and 500 imported events in the visible planning range.

## Assumptions

- First release focuses on read-only calendar subscription links such as webcal-style or downloadable calendar feeds.
- Google Calendar and Outlook Calendar account authorization are future extensions, not part of this first-release scope.
- Users are already authenticated in Chrona before managing calendar sources.
- Imported events are used for awareness and planning constraints, not for editing or sending updates back to external calendars.
- Chrona retains imported events from the past 30 days through the next 90 days for each enabled calendar source, avoiding unbounded calendar storage.
- Private calendar links are sensitive because possession of the link may grant access to calendar contents.
