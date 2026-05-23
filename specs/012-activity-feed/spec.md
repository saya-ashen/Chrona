# Feature Specification: Workspace Activity Feed

**Feature Branch**: `012-activity-feed`  
**Created**: 2026-05-23  
**Status**: Draft  
**Input**: User description: "根据上面的讨论信息，制定specify，注意不要只局限于第一版，要分阶段修改到最优版本，并且最终不要保留任何旧代码和数据兼容"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand Task Progress From Command Center (Priority: P1)

As a task operator, I want the Command Center to show the complete latest task activity with meaningful event details, so I can understand what the task is doing and what has already happened without opening any external provider interface.

**Why this priority**: This is the primary user value. The current activity view is too coarse and hides provider tool calls, assistant output, reasoning, and run status details that users need during execution.

**Independent Test**: Can be tested by opening a running or completed task with provider events and verifying the Command Center activity feed communicates task-wide progress, recent tool calls, assistant output, failures, approvals, and node context.

**Acceptance Scenarios**:

1. **Given** a task with recent provider tool activity, **When** the user opens Command Center Activity, **Then** each tool start and completion appears as a distinct activity entry with the tool name, status, useful preview, and timing or error details when available.
2. **Given** a task with assistant text and reasoning activity, **When** the user opens Command Center Activity, **Then** assistant output and reasoning appear as readable feed entries instead of opaque raw events.
3. **Given** a task with activity from multiple nodes, **When** the user views task-wide activity, **Then** each node-related activity shows enough node identity for the user to understand where it occurred.
4. **Given** a task has more activity than fits on screen, **When** the user opens the feed, **Then** the newest important activity is immediately visible and older activity remains reachable through a clear progressive browsing experience.

---

### User Story 2 - Inspect Node-Specific Activity From Node Drawer (Priority: P1)

As a task operator, I want the node drawer to show Activity instead of Evidence, so I can inspect the latest activity specifically related to the selected node.

**Why this priority**: The node drawer is the natural place to answer “what happened in this node?” Evidence is less accurate as the main label once provider events become the source of operational understanding.

**Independent Test**: Can be tested by selecting a node that produced provider events and verifying the drawer has an Activity tab, no Evidence tab, and shows only activity associated with that node.

**Acceptance Scenarios**:

1. **Given** a user selects a node, **When** the drawer opens, **Then** the drawer shows an `Activity` tab and does not show an `Evidence` tab.
2. **Given** the selected node has related activity, **When** the user opens the Activity tab, **Then** the feed contains only that node’s recent activity and omits activity from other nodes.
3. **Given** the selected node has no recorded activity, **When** the user opens the Activity tab, **Then** the drawer displays a clear empty state explaining that no activity has been recorded for the node yet.
4. **Given** a task is actively running and the selected node receives new activity, **When** the feed updates, **Then** the new node activity appears without forcing the user to leave the drawer.

---

### User Story 3 - Read Provider Tool Activity Without External UI (Priority: P2)

As a task operator, I want provider tool calls to expose useful details in the activity feed, so I can see what the provider attempted, what input or preview was used, whether it succeeded, and what error occurred if it failed.

**Why this priority**: Tool-call transparency is the main difference between a coarse activity summary and an operationally useful feed similar to a provider TUI.

**Independent Test**: Can be tested with a task that includes started, completed, and failed tool calls and verifying each state has distinct visual treatment and useful details.

**Acceptance Scenarios**:

1. **Given** a tool call has a preview or input summary, **When** it appears in Activity, **Then** the user can inspect the preview or input without opening another interface.
2. **Given** a tool call fails, **When** it appears in Activity, **Then** the failure is visually distinct and includes the available error message.
3. **Given** a tool call completes successfully, **When** it appears in Activity, **Then** the user can identify the tool and see completion timing when available.
4. **Given** a tool detail is long or sensitive to screen space, **When** it appears in Activity, **Then** it is summarized first and can be expanded without disrupting the feed.

---

### User Story 4 - Reach the Final Activity Model in Phases (Priority: P3)

As a product owner, I want the activity experience to evolve through safe phases toward the best final model, so the first release can improve visibility quickly while the final release removes legacy labels, compatibility paths, and coarse summaries.

**Why this priority**: The desired outcome is not just a first version. The feature must define a staged path to a clean final state.

**Independent Test**: Can be tested by reviewing each release phase against its exit criteria and confirming the final phase has no Evidence tab, no legacy coarse activity model, and no fallback behavior for pre-migration event shapes.

**Acceptance Scenarios**:

1. **Given** Phase 1 is complete, **When** users inspect task and node activity, **Then** they receive improved structured activity using newly recorded node-aware provider events.
2. **Given** Phase 2 is complete, **When** users browse larger task histories, **Then** they can access more activity than the initial page without losing node filtering or event details.
3. **Given** the final phase is complete, **When** the product is audited, **Then** all user-facing Evidence tab behavior, old coarse activity-only presentation, and old-data compatibility fallbacks have been removed.

### Edge Cases

- A selected node has no activity because it has not started, has not emitted events, or was created before the final event model.
- A task has thousands of activity events and the user must still see the latest activity quickly.
- Activity arrives live while the user has the node drawer open.
- Provider events are missing optional details such as preview, input, duration, or error text.
- Consecutive assistant or reasoning fragments belong to different nodes or runs and must not be merged together.
- Tool details are long enough to affect readability or mobile layout.
- Activity includes failed provider runs, interrupted runs, approval waits, external result syncs, artifact creation, and schedule proposals.
- Existing historical activity created before the final event model cannot be accurately associated with a node.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST use `Activity` as the singular label for the node drawer feed and MUST remove the user-facing `Evidence` tab from the final experience.
- **FR-002**: System MUST provide a task-wide Activity feed in Command Center that includes the latest activity across the entire task.
- **FR-003**: System MUST provide a node-scoped Activity feed in the node drawer that includes only activity associated with the selected node.
- **FR-004**: System MUST represent activity using structured event categories, including assistant message, reasoning, tool started, tool completed, provider run status, approval, node lifecycle, task lifecycle, artifact, schedule, and raw or unknown activity.
- **FR-005**: System MUST show provider tool calls with distinct started, completed, and failed states.
- **FR-006**: System MUST show useful available tool details, including tool name, label, preview, input summary, duration, and error message when those details exist.
- **FR-007**: System MUST merge consecutive assistant text fragments only when they belong to the same task scope, node, run, provider, and activity type.
- **FR-008**: System MUST avoid merging reasoning and assistant output into the same visible entry.
- **FR-009**: System MUST preserve node identity on node-related activity so task-wide Activity can show where the event occurred and node-scoped Activity can filter accurately.
- **FR-010**: System MUST merge live activity and persisted activity into one coherent feed without duplicate entries.
- **FR-011**: System MUST show newest relevant activity first while preserving enough ordering context for the user to understand the sequence of events.
- **FR-012**: System MUST provide empty states for task-wide and node-scoped feeds when no activity is available.
- **FR-013**: System MUST provide a clear visual difference between normal progress, pending approval, completed work, and failed work.
- **FR-014**: System MUST allow long activity details to be summarized and expanded so the feed remains scannable.
- **FR-015**: System MUST keep the active task, selected or active node, blocked or review state, and primary action visually obvious while Activity is open.
- **FR-016**: System MUST support desktop, tablet, and mobile layouts without horizontal scrolling.
- **FR-017**: Phase 1 MUST deliver the shared Activity experience for Command Center and node drawer using newly recorded node-aware activity.
- **FR-018**: Phase 2 MUST expand browsing of larger activity histories and preserve task-wide and node-scoped filtering for longer-running tasks.
- **FR-019**: Phase 3 MUST make the structured Activity model the only supported model and remove old code paths, old user-facing labels, and old data compatibility behavior.
- **FR-020**: Final state MUST NOT infer node activity from unreliable time windows or preserve compatibility behavior for events that lack required node context.
- **FR-021**: Final state MUST NOT expose separate Evidence terminology for this drawer workflow; operational history must be expressed through Activity.
- **FR-022**: System MUST handle unknown activity categories gracefully in the feed without breaking the user’s ability to inspect surrounding activity.

### Quality & Experience Requirements *(mandatory)*

- The feature MUST preserve existing task execution behavior; changes are limited to how activity is captured, shaped, filtered, and presented to users.
- The activity model MUST have one product-level meaning across task-wide and node-scoped views so the same event type is interpreted consistently everywhere.
- User-facing strings MUST follow existing product terminology and localization practices.
- The feed MUST prioritize readability over raw completeness by showing concise summaries first and exposing details progressively.
- The user MUST be able to understand current work, recent completed work, blocked or review states, and primary next action without leaving the workspace.
- Frontend visual and interaction changes MUST be validated before and after implementation on desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
- Automated coverage MUST include activity shaping, deduplication, node filtering, tool detail rendering, tab label replacement, empty states, and final removal of legacy Evidence behavior.
- End-to-end validation MUST be included when task navigation, drawer behavior, or live execution flows are changed.
- The feed MUST remain responsive for long-running tasks with thousands of events by limiting initial visible work and providing a progressive path to older events.
- Backend behavior changes are allowed because the visual requirement depends on structured, node-aware activity details that are not available in the coarse current presentation.

### Key Entities *(include if feature involves data)*

- **Activity Item**: A user-facing record of something meaningful that occurred during task execution. Key attributes include category, title, summary, timestamp, severity or tone, node identity, provider identity, run identity, and optional structured details.
- **Tool Activity**: An activity item representing a provider tool call. Key attributes include tool name, label, start or completion state, preview, input summary, duration, and error message.
- **Assistant Activity**: An activity item representing assistant text or reasoning. Key attributes include text content, reasoning content, provider identity, run identity, and node identity.
- **Node Activity Scope**: The subset of task activity associated with one task node. It depends on recorded node identity and must not be guessed from timing alone.
- **Task Activity Scope**: The complete activity history visible from Command Center across all nodes and task-level events.
- **Activity Phase**: A rollout stage with explicit exit criteria, moving from first useful structured activity to final removal of old compatibility paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability validation, at least 90% of tested users can identify the currently active tool call or latest completed provider action from Command Center Activity within 10 seconds.
- **SC-002**: In usability validation, at least 90% of tested users can identify what happened inside a selected node within 10 seconds of opening the node drawer.
- **SC-003**: For tasks with node-aware provider activity, 100% of node drawer Activity entries belong to the selected node.
- **SC-004**: For tasks with tool calls, at least 95% of tool started, completed, and failed events appear with the correct state and tool identity in Activity.
- **SC-005**: For tasks with consecutive assistant or reasoning fragments, 100% of merges preserve node and run boundaries.
- **SC-006**: Users can inspect latest activity for a task with at least 3,000 recorded events without waiting more than 2 seconds for the initial visible feed on standard development hardware.
- **SC-007**: Mobile validation at 390px width shows no horizontal scrolling in Command Center Activity or node drawer Activity.
- **SC-008**: Final phase audit finds zero user-facing Evidence drawer labels, zero old coarse-only activity renderers, and zero old-data compatibility fallbacks for missing node context.
- **SC-009**: Automated regression coverage passes for task-wide activity, node-scoped activity, provider tool details, empty states, and final legacy removal.

## Phased Delivery

### Phase 1 - Unified Structured Activity

- Replace the node drawer Evidence tab with Activity.
- Show task-wide Activity in Command Center and node-scoped Activity in the node drawer using one consistent product model.
- Display structured provider tool calls, assistant output, reasoning, provider run status, approvals, and node lifecycle events.
- Merge live and persisted activity into one feed and deduplicate repeated entries.
- Support new node-aware activity and make historical activity without node identity absent from node-scoped views rather than guessed.
- Exit criteria: core task and node Activity flows are usable, tested, and validated on required screen sizes.

### Phase 2 - Deep History and Operational Detail

- Add a progressive way to browse older task and node activity beyond the initial visible feed.
- Improve expansion of long tool inputs, previews, errors, and assistant output.
- Ensure long-running tasks keep the newest activity fast and older activity discoverable.
- Strengthen visual grouping for provider runs and node context so users can follow multi-step execution without external provider tools.
- Exit criteria: long-running tasks with thousands of events remain responsive, and users can inspect older activity without losing filters or context.

### Phase 3 - Final Model and Legacy Removal

- Make structured node-aware Activity the only supported operational history model for the workspace.
- Remove remaining user-facing Evidence terminology from the node drawer workflow.
- Remove old coarse activity-only rendering paths and any fallback behavior for old provider events that lack required node context.
- Remove unreliable time-window inference or compatibility assumptions for historical events.
- Exit criteria: final audit confirms no old UI labels, old data compatibility paths, or duplicate activity models remain.

## Assumptions

- The primary users are task operators and developers inspecting automated task execution in the workspace.
- `Activity` is the correct singular label because it names a collective event feed and matches the Command Center terminology.
- Historical provider events created before node-aware activity cannot be accurately assigned to nodes and will not be guessed in the final model.
- The final product may require a cutover or migration period where older tasks have incomplete node-scoped activity.
- The first phase may focus on latest activity, while later phases expand deep history browsing.
- Provider tool details may be absent for some events; the feed should show available details without inventing missing data.
- Security and privacy rules for provider inputs and outputs remain governed by existing workspace policies; this feature changes visibility inside the existing authorized workspace, not external sharing.
