# Feature Specification: AI Dropdown Surface

**Feature Branch**: `010-ai-dropdown-surface`  
**Created**: 2026-05-19  
**Status**: Draft  
**Input**: User description: "Refactor Chrona context-aware AI away from a standalone sidebar into a single top-bar AI dropdown that serves page operations, returns proposal-based changes, and routes all previews and confirmations through the corresponding page surfaces."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use One Page-Aware AI Entry (Priority: P1)

As a Chrona user working in a schedule, task, or workbench page, I want one visible AI entry in the global top bar so that I can understand the current page's assistant status and start page-relevant actions without opening a separate chat sidebar.

**Why this priority**: This establishes the core product direction: Chrona remains a schedule and task execution app, with AI serving the current page rather than becoming a parallel conversation workspace.

**Independent Test**: Can be tested by visiting every AI-supported page and confirming there is exactly one top-bar AI trigger, no context-aware AI sidebar opens, and the trigger reflects the active page's assistant status.

**Acceptance Scenarios**:

1. **Given** a user is on Schedule with two unresolved conflicts, **When** the global top bar is visible, **Then** the AI trigger shows an attention state and includes a summary equivalent to "handle conflicts · 2".
2. **Given** a user is on a Task page with one item awaiting confirmation, **When** the user scans the top bar, **Then** the AI trigger summarizes the confirmation need without moving focus away from the task page.
3. **Given** a user clicks the AI trigger, **When** the surface opens, **Then** a dropdown menu appears rather than a side panel or full chat view.

---

### User Story 2 - Choose Server-Provided Quick Actions (Priority: P2)

As a user, I want the dropdown to show relevant quick actions supplied from the current page state so that I can start useful AI work without choosing from hardcoded or generic commands.

**Why this priority**: Quick actions make the dropdown operationally useful while preserving page ownership of state and avoiding duplicated decision logic in the client experience.

**Independent Test**: Can be tested by changing page state severity and confirming quick actions, disabled reasons, and top-priority status change according to the assistant surface state returned for that page.

**Acceptance Scenarios**:

1. **Given** a page has a blocked or error state, **When** the dropdown opens, **Then** the highest-priority status is shown before normal or informational summaries.
2. **Given** the current page state provides quick actions, **When** the dropdown opens, **Then** each action displays its label, description, severity, preview expectation, and disabled reason when applicable.
3. **Given** no quick action is currently valid, **When** the dropdown opens, **Then** the user sees an understandable empty or disabled state and can still enter a short page-related request if allowed.

---

### User Story 3 - Review AI Proposals On Owning Pages (Priority: P3)

As a user, I want any AI-produced data modification to appear as a proposal in the owning page's preview mode so that I can inspect and confirm changes before schedules, tasks, plans, or execution state are modified.

**Why this priority**: This protects Chrona's suggest-confirm workflow and prevents the global dropdown from silently changing important operational data.

**Independent Test**: Can be tested by triggering representative AI actions from the dropdown and verifying each produces a proposal entry and navigates or highlights the correct page preview surface before any mutation is applied.

**Acceptance Scenarios**:

1. **Given** a Schedule quick action proposes resolving conflicts, **When** the user triggers it, **Then** task moves, conflict resolutions, or auto-scheduling changes are previewed on the schedule timeline before confirmation.
2. **Given** a Task configuration action proposes field changes, **When** the user triggers it, **Then** the task configuration surface previews the changed fields before confirmation.
3. **Given** a Workbench action proposes accepting, retrying, or following up on a result, **When** the user triggers it, **Then** the workbench result surface previews the outcome before confirmation.
4. **Given** the user declines or closes a proposal preview, **When** returning to the page, **Then** no task, plan, schedule, or execution state has been modified.

---

### Edge Cases

- The current page has multiple summaries at different severities; error, blocked, and conflict summaries must be selected before lower-priority summaries in the trigger and dropdown.
- The current page has more summaries than can fit in the trigger; summaries rotate or cycle without hiding critical states.
- The assistant surface state is unavailable, stale, or fails to load; the dropdown must show a safe fallback that does not offer mutation actions.
- A quick action is returned but disabled; the dropdown must explain why and prevent execution.
- A user submits a short request that would modify data; the result must still become a proposal routed to the owning preview surface.
- A proposal refers to a page different from the current page; the user must receive a clear route or entry point to review it on the correct page.
- A user opens the dropdown on a page without page-specific assistant support; the entry must communicate that no page action is available instead of falling back to generic chat.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST replace the current context-aware AI sidebar with a single global AI dropdown trigger in the top bar.
- **FR-002**: The product MUST ensure the global top-bar trigger is the only visible AI or natural-language entry point for page operations.
- **FR-003**: The AI trigger MUST display an emoji status icon that can later be replaced by a richer animated character without changing the interaction model.
- **FR-004**: The AI trigger MUST display a page-level status summary for the active page, such as conflict handling counts, task confirmations, execution progress, waiting-for-input state, or failure state.
- **FR-005**: The AI trigger MUST support multiple summaries and prioritize error, blocked, and conflict states ahead of normal, pending, or informational states.
- **FR-006**: Clicking the AI trigger MUST open a dropdown menu and MUST NOT open a sidebar, modal chat workspace, or complex preview surface.
- **FR-007**: The dropdown MUST include the page summary, the current highest-priority state, server-provided quick actions, a short input for current-page AI requests, and a brief entry to recent proposals when available.
- **FR-008**: The dropdown MUST NOT display complex diffs, multi-step previews, or detailed modification reviews.
- **FR-009**: Quick actions MUST come from the assistant surface state for the active page and MUST NOT be hardcoded in the front-end presentation layer.
- **FR-010**: Quick actions MUST be derived from a page and state/severity mapping, where each action includes id, label, description, intent, severity, whether preview is required, preview surface, and disabled reason.
- **FR-011**: The system MUST generate assistant surface state from existing page data, projections, and event-derived state rather than introducing a new ordinary global mutable store as the source of truth.
- **FR-012**: The short input MUST interpret user requests in the context of the active page and current page state.
- **FR-013**: Any AI output that would modify tasks, plans, schedules, or execution state MUST be returned as a proposal before any mutation occurs.
- **FR-014**: Proposals affecting schedule timeline behavior MUST be previewed on the schedule timeline surface, including task moves, conflict resolution, and automatic scheduling changes.
- **FR-015**: Proposals affecting task configuration MUST be previewed on the task configuration surface, including field-level changes.
- **FR-016**: Proposals affecting task graph structure MUST be previewed on the task graph surface, including plan node and dependency changes.
- **FR-017**: Proposals affecting workbench results MUST be previewed on the workbench result surface, including accept, retry, and follow-up outcomes.
- **FR-018**: The product MUST require explicit user confirmation on the owning preview surface before any command applies a proposal.
- **FR-019**: The dropdown MUST NOT silently modify task, plan, schedule, or execution state.
- **FR-020**: Recent proposal entries in the dropdown MUST be brief and MUST route the user to the appropriate preview or review location rather than duplicating that preview in the dropdown.
- **FR-021**: Disabled quick actions MUST remain visible when useful for understanding state and MUST include a human-readable disabled reason.
- **FR-022**: Page-specific copy MUST be understandable to users as task and schedule operations, not as open-ended chat prompts.

### Quality & Experience Requirements *(mandatory)*

- The feature MUST preserve Chrona's product model as a schedule and task execution application where AI assists current-page operations.
- The feature MUST preserve the suggest-confirm mechanism: AI may suggest changes, users review proposals on the owning page, and only explicit confirmation applies mutations.
- The feature MUST preserve existing page behavior outside the replaced AI sidebar and top-bar AI entry.
- The feature MUST keep business decisions and mutation ownership with existing page data, event, projection, and command flows rather than creating a competing source of truth.
- The feature MUST use existing Chrona terminology and localization practices for all user-facing strings.
- The feature MUST provide clear loading, unavailable, empty, disabled, success, and error states for the trigger and dropdown.
- The feature MUST make current page state, blocked or review state, and primary action visually obvious in the dropdown.
- The feature MUST avoid horizontal scrolling on mobile and remain usable at desktop, tablet, and mobile viewport sizes.
- The feature MUST include automated coverage for trigger visibility, summary priority, quick action rendering, proposal routing, and no-mutation-before-confirm behavior.
- The feature MUST include end-to-end coverage when task, schedule, workbench, or navigation flows are affected.
- The feature MUST include pre-change visual observation and post-change visual verification for desktop 1440x900, tablet 1024x768, and mobile 390x844.
- Backend behavior may change only to supply the assistant surface state and proposal-oriented action results required by this feature; visual polish alone MUST NOT require unrelated backend behavior changes.
- The dropdown MUST remain lightweight enough that opening it feels immediate to users under normal application conditions.

### Key Entities *(include if feature involves data)*

- **Assistant Surface State**: Page-aware assistant status provided for the current page; includes summaries, highest-priority state, quick actions, recent proposals, and availability information.
- **Page Status Summary**: Short user-facing status item shown in the trigger or dropdown; includes page context, severity, display text, count or progress when applicable, and priority.
- **Quick Action**: Action offered by the assistant surface state; includes id, label, description, intent, severity, preview requirement, target preview surface, and disabled reason.
- **Proposal**: AI-generated suggested change that requires user review and confirmation before any mutation is applied.
- **Preview Surface**: Owning page location where a proposal is reviewed, such as schedule timeline, task configuration, task graph, or workbench result.
- **Page Context**: Active product area and state used to derive relevant summaries, actions, and proposal routing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of AI-supported pages expose AI access through the single global top-bar dropdown trigger and no longer open the replaced AI sidebar.
- **SC-002**: 95% of users in usability testing can identify the current highest-priority assistant status from the trigger or opened dropdown within 5 seconds.
- **SC-003**: 100% of AI actions that can modify schedules, tasks, plans, or execution state create a proposal before any mutation is applied.
- **SC-004**: 100% of proposal-producing actions route users to the correct owning preview surface for review and confirmation.
- **SC-005**: 0 confirmed test cases allow task, plan, schedule, or execution state to change directly from the dropdown without page-level preview and confirmation.
- **SC-006**: 90% of representative quick-action scenarios show a relevant action or disabled reason that matches the active page state.
- **SC-007**: Users can open the dropdown and submit a short current-page request in under 10 seconds during normal use.
- **SC-008**: The trigger and dropdown pass desktop, tablet, and mobile verification with no horizontal scrolling and no loss of critical status information.

## Assumptions

- Existing Chrona users already understand schedule, task, graph, and workbench page concepts.
- Existing page data, projections, event-derived state, and command confirmation flows are available to produce assistant status and apply confirmed proposals.
- The initial version supports Schedule, Task, and Workbench pages named in the feature description; other pages may show an unavailable or no-actions state until they provide assistant surface state.
- Recent proposals can be summarized briefly in the dropdown while full review remains owned by page-specific preview surfaces.
- The short input is intentionally scoped to current-page operations and does not need to support general open-ended chat.
- Localization and accessibility expectations follow the existing Chrona product standards.
