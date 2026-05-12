# Feature Specification: Task Workspace Component Parity

**Feature Branch**: `003-task-workspace-components`  
**Created**: 2026-05-12  
**Status**: Draft  
**Input**: User description: "参照 @docs/assets/设计参考.png  这个图片，修改Chrona的task workspace页面的设计，看还有哪些差距，例如顶栏设计，侧栏设计等，先不用关注css的风格，主要在于功能组件的差距。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand task execution at a glance (Priority: P1)

As a task operator, I want the task workspace to show the task title, execution status, step progress, primary controls, and a visual execution flow so I can understand where the task is and what I can do next without opening separate pages.

**Why this priority**: This is the core value of the referenced workspace. Without top-level execution context and flow visibility, users cannot reliably monitor or continue task execution.

**Independent Test**: Can be tested by opening a running task workspace and confirming the header, progress, execution controls, and flow map together communicate current state and next available actions.

**Acceptance Scenarios**:

1. **Given** a task has multiple execution nodes, **When** the user opens the workspace, **Then** they see the task name, editable title affordance, current status, completed-step count, percentage progress, and primary execution actions in the top workspace area.
2. **Given** a task contains completed, running, waiting, blocked, and approval-needed nodes, **When** the user views the execution flow, **Then** each node state is distinguishable by label, status, step number, timing, artifact presence, and connection order.
3. **Given** the execution flow is larger than the visible area, **When** the user uses map controls, **Then** they can zoom, reset/center, and expand the flow view without losing the selected node context.

---

### User Story 2 - Act on the current node (Priority: P2)

As a task reviewer, I want a dedicated current-node panel with results, evidence, actions, configuration, auto-refresh, and decision buttons so I can review outputs and progress or intervene from the same workspace.

**Why this priority**: The reference design treats node-level review as the main operational surface below the flow map. This reduces context switching and makes human-in-the-loop tasks actionable.

**Independent Test**: Can be tested by selecting a node with results and verifying the lower details panel exposes summary content, supporting evidence, operational tabs, refresh state, and decision actions.

**Acceptance Scenarios**:

1. **Given** a node is selected, **When** the user opens the node details area, **Then** they see the node name, status, step position, tabbed sections for result, evidence, actions, and configuration, plus auto-refresh status.
2. **Given** a node has generated outputs and supporting files, **When** the user reviews the result tab, **Then** they can read the result summary, copy the result, inspect key evidence, and open a broader evidence list.
3. **Given** a selected node requires a decision or recovery action, **When** the user reviews the action area, **Then** they can approve/accept results, retry the node, block the node, or perform the required review action based on the node state.

---

### User Story 3 - Monitor outcomes and workspace context (Priority: P3)

As a project member, I want a persistent side summary with latest results, required attention, artifacts, and execution activity, plus workspace navigation and account context, so I can monitor task outcomes and move through Chrona consistently.

**Why this priority**: These components complete the workspace experience beyond the main flow and help users recognize important outputs, pending reviews, and navigation context.

**Independent Test**: Can be tested by opening the workspace and confirming the sidebar navigation, top account/notification area, and right-side execution overview expose the same categories of information shown in the reference.

**Acceptance Scenarios**:

1. **Given** the user is in the task workspace, **When** they view global navigation, **Then** they see Chrona branding, primary sections, active task section, notifications, settings, member identity, and notification counts where available.
2. **Given** a task has recent results, pending handling, artifacts, and activity history, **When** the user reviews the side overview, **Then** they see latest result summary, attention-needed card with next actions, artifact list with metadata, and chronological execution activity.
3. **Given** the side overview content is stale or incomplete, **When** the user refreshes or opens "view all" affordances, **Then** the workspace updates or routes to the complete result, artifact, or activity view while preserving task context.

### Edge Cases

- If a task has no execution nodes, the workspace shows an empty flow state with task-level actions and guidance for starting or generating execution steps.
- If a node has no artifacts, the node and details panel explicitly show that no artifacts are available rather than leaving empty space.
- If execution status is delayed or unavailable, the workspace shows the last known update time and a refresh/retry option.
- If a user lacks permission for a task action, the action remains visible when useful for discoverability but is disabled with a clear reason.
- If the flow contains more nodes than fit comfortably, the map remains navigable through zoom, center, and expand controls.
- If required handling exists on any node, the workspace exposes it both on the node and in the side overview attention area.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workspace MUST include a persistent left navigation area with Chrona identity, primary sections, active task indication, notification entry with unread count, and settings entry.
- **FR-002**: The workspace MUST include a top task context area with breadcrumb, task title, title edit affordance, current execution status, completed-step count, progress indicator, and progress percentage.
- **FR-003**: The workspace MUST expose task-level actions for continuing execution, pausing execution, exporting a report, and opening additional task options when those actions are relevant to the current task state.
- **FR-004**: The workspace MUST show user or project-member context in the top area, including notification state and active member identity.
- **FR-005**: The workspace MUST present an execution flow map that displays task nodes, ordered connections, branch or dependency links, and a legend for all visible node states.
- **FR-006**: Each flow node MUST communicate step number, title, state, last meaningful time or update, whether artifacts exist, and whether human handling is required.
- **FR-007**: The flow map MUST provide controls for zooming, centering, and expanding or fitting the map view.
- **FR-008**: Selecting a node MUST update a node details area without requiring navigation away from the workspace.
- **FR-009**: The node details area MUST show selected node title, status, step position, auto-refresh state, and tabs for result, evidence, action, and configuration information.
- **FR-010**: The result view MUST show a readable result summary, support copying the result, and distinguish primary conclusions from supporting details.
- **FR-011**: The evidence view MUST show supporting artifacts or references related to the selected node, including names and enough metadata for users to identify the source.
- **FR-012**: The action area MUST provide state-appropriate controls such as accept result, retry node, block node, view approval, or supplement information.
- **FR-013**: The workspace MUST include a right-side execution overview with latest result summary, required-attention card, artifacts summary, and execution activity timeline.
- **FR-014**: The latest result summary MUST include update time and a path to view the complete result when a result exists.
- **FR-015**: The required-attention card MUST identify the blocking or approval node, describe the needed action, and expose the next available resolution actions.
- **FR-016**: The artifact summary MUST list recent artifacts with name, type, size or comparable metadata, update time, and access to the full artifact list.
- **FR-017**: The execution activity timeline MUST show chronological task events with time, node name where applicable, status, and concise description.
- **FR-018**: The workspace MUST preserve task context when users switch between flow nodes, detail tabs, right-side overview links, and global navigation affordances.
- **FR-019**: The workspace MUST define visible empty, loading, stale, permission-denied, and error states for the flow map, node details, result overview, artifacts, and activity sections.
- **FR-020**: The redesigned workspace MUST focus on functional component parity with the reference image; visual styling refinements are secondary and MUST NOT block functional acceptance.

### Quality & Experience Requirements *(mandatory)*

- The feature MUST preserve existing task execution behavior and only change workspace presentation or user-accessible controls unless a later plan explicitly identifies required behavior changes.
- The feature MUST keep task, node, artifact, result, and activity terminology consistent across header, flow, details, and overview regions.
- The feature MUST include automated coverage for the new or changed workspace states, including running task, waiting task, approval-needed task, empty task, and artifact-present task.
- The feature MUST remain usable on desktop and mobile widths, with all core monitoring and action components reachable without data loss.
- The feature MUST avoid adding duplicate sources of truth for execution state; all displayed status, progress, artifacts, and activity must reconcile to the same task data.
- The feature MUST keep normal workspace loading and node switching responsive enough that users perceive context changes within 1 second for typical task sizes.

### Key Entities *(include if feature involves data)*

- **Task Workspace**: The user-facing operational page for one task, combining task status, controls, execution flow, node details, and side summaries.
- **Task**: The overall execution unit with title, status, progress, owner/member context, and available task-level actions.
- **Execution Node**: A step in the task flow with number, title, state, timing, artifacts, dependencies, and possible human action requirements.
- **Result Summary**: The latest or selected-node output that communicates conclusions, recommendations, and completion state.
- **Evidence Item**: A supporting file, reference, or artifact used to justify a result or node output.
- **Artifact**: A generated or uploaded deliverable associated with the task or node, with identifiable metadata and access path.
- **Activity Event**: A chronological record of task start, node progress, completion, waiting, approval, retry, or blocking events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of evaluators can identify current task status, progress, active node, and next available action within 10 seconds of opening the workspace.
- **SC-002**: 90% of evaluators can locate the latest result, required attention item, artifacts, and execution activity without leaving the task workspace.
- **SC-003**: Users can switch from a flow node to its result/evidence/action details in under 3 interactions.
- **SC-004**: All execution node states visible in the reference workflow are represented in the workspace with distinct labels and affordances.
- **SC-005**: For a typical task with up to 20 nodes and 20 artifacts, users perceive flow navigation, node selection, and tab switching within 1 second.
- **SC-006**: Functional parity review identifies no missing top-level component category from the reference image: global navigation, task header, execution controls, flow map, node details, result summary, attention card, artifact list, and activity timeline.

## Assumptions

- The primary scope is the existing Chrona task workspace page, not unrelated pages such as plan library, knowledge base, tools, or integrations.
- The reference image is treated as a functional component benchmark, not a pixel-perfect visual design requirement.
- Existing task execution, artifact, result, and activity data should be reused where available.
- If some reference components require data not currently available, the planning phase should identify the smallest data additions or fallback states needed for functional parity.
- Users reviewing this workspace are project members with permission to view task execution details; action permissions may vary by role.
