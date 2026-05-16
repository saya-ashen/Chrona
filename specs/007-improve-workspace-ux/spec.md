# Feature Specification: Improve Workspace UX

**Feature Branch**: `007-improve-workspace-ux`  
**Created**: 2026-05-16  
**Status**: Draft  
**Input**: User description: "Improve Chrona task workspace UX. The current task workspace mostly works functionally, but the interaction design is unclear and visually rough. Scope: Improve the task workspace page only. Improve visual hierarchy, spacing, responsive layout, active task/node visibility, blocked/review state visibility, and primary action clarity. Preserve existing task creation, plan generation, plan acceptance, task execution, assistant interaction, schedule, and navigation behavior. Do not change backend APIs unless the plan proves it is necessary. Use agent-browser to observe the current UI before planning and implementation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand Current Workspace State (Priority: P1)

As a user opening a task workspace, I can immediately identify the current task, its overall state, the active plan node, and the most important next action without reading every panel.

**Why this priority**: The workspace cannot guide users effectively if current context and next action are visually ambiguous.

**Independent Test**: Open a workspace with an in-progress task and plan. A user can name the current task, state, active node, and primary next action within 5 seconds on desktop, tablet, and mobile.

**Acceptance Scenarios**:

1. **Given** an active task with an in-progress plan node, **When** the user opens the workspace, **Then** the task title, task state, active node, and primary action are visually prominent above secondary details.
2. **Given** a task with multiple plan nodes, **When** the user scans the plan, **Then** the active node is clearly distinguishable from queued, completed, blocked, and review-required nodes.
3. **Given** a task has a primary next action available, **When** the workspace loads, **Then** that action is visible without excessive scrolling.

---

### User Story 2 - Distinguish Workflow States (Priority: P2)

As a user, I can distinguish loading, empty, error, blocked, review-required, and completed states and understand what I can do next in each state.

**Why this priority**: Clear state communication prevents users from mistaking paused, broken, waiting, or completed workflows for one another.

**Independent Test**: Review representative workspace states. Each state presents distinct visual treatment, explanatory copy, and an appropriate action or next-step cue.

**Acceptance Scenarios**:

1. **Given** workspace data is loading, **When** the user enters the page, **Then** the loading state communicates that content is pending without implying an error.
2. **Given** no task or no plan content is available, **When** the workspace renders, **Then** the empty state explains what is missing and how to proceed.
3. **Given** a task is blocked or requires review, **When** the workspace renders, **Then** that state is visually urgent enough to notice and includes the relevant next action.
4. **Given** the task is completed, **When** the workspace renders, **Then** completion is clear and primary execution controls no longer appear as the next step.

---

### User Story 3 - Use Workspace on Mobile (Priority: P3)

As a user on a 390px-wide mobile viewport, I can operate the main task workflow without horizontal scrolling or losing access to the primary action.

**Why this priority**: The workspace must remain usable on narrow screens where dense plan and interaction panels can otherwise overflow.

**Independent Test**: Open the workspace at 390x844 and complete the main visible workflow steps with no horizontal page scroll, clipped controls, or inaccessible primary action.

**Acceptance Scenarios**:

1. **Given** a mobile viewport of 390x844, **When** the workspace loads, **Then** all panels, text, and controls fit within the viewport width.
2. **Given** a mobile user needs the next workflow action, **When** they scan the initial workspace view, **Then** the primary action remains easy to find and use.
3. **Given** long task names, node names, or status messages, **When** displayed on mobile, **Then** content wraps or truncates safely without causing horizontal scroll.

---

### User Story 4 - Preserve Existing Workflow Behavior (Priority: P4)

As a current Chrona user, I can continue creating tasks, generating plans, accepting plans, executing tasks, interacting with the assistant, using schedule information, and navigating the workspace as before.

**Why this priority**: UX polish must not regress working task behavior.

**Independent Test**: Run the existing main task workflow before and after the change. The same user-visible actions remain available and complete successfully.

**Acceptance Scenarios**:

1. **Given** a user creates or opens a task, **When** they generate and accept a plan, **Then** the existing flow still succeeds.
2. **Given** a user interacts with execution, assistant, schedule, or navigation controls, **When** they use those controls after the redesign, **Then** behavior remains consistent with the current product.
3. **Given** the workspace is exercised in a browser, **When** the main task workflow is used, **Then** no console errors or broken network requests appear.

---

### Edge Cases

- Workspace opened before task details finish loading.
- Workspace opened when no task is selected or the selected task cannot be found.
- Plan exists but has no active node.
- Multiple nodes have different states, including blocked, review-required, completed, queued, and running.
- Task, node, assistant, or schedule text is unusually long.
- Workspace data fails to load or a workflow request fails.
- Mobile viewport contains dense panels, long labels, or action rows that previously risked horizontal overflow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workspace MUST present the current task identity and overall state as the dominant context on the page.
- **FR-002**: The workspace MUST make the active plan node visually distinct from other nodes.
- **FR-003**: The workspace MUST make the primary next action visually clearer than secondary actions.
- **FR-004**: The workspace MUST distinguish loading, empty, error, blocked, review-required, completed, running, and idle states using visible labels, hierarchy, and explanatory cues.
- **FR-005**: The workspace MUST preserve existing user-visible task creation, plan generation, plan acceptance, task execution, assistant interaction, schedule, and navigation behavior.
- **FR-006**: The workspace MUST remain usable at desktop 1440x900, tablet 1024x768, and mobile 390x844 viewport sizes.
- **FR-007**: The mobile workspace MUST avoid horizontal page scrolling at 390px width.
- **FR-008**: Long task names, node names, status labels, assistant content, and schedule content MUST not break layout or hide essential controls.
- **FR-009**: The page MUST provide clear recovery or next-step guidance when workspace content cannot load or expected content is absent.
- **FR-010**: Browser evidence MUST be captured before and after the UX change at desktop, tablet, and mobile sizes, including a structural snapshot.
- **FR-011**: Main workspace operation MUST complete without user-visible console errors or broken network requests.
- **FR-012**: Backend behavior and contracts MUST remain unchanged unless planning evidence shows the UX cannot be corrected without a backend change.

### Quality & Experience Requirements *(mandatory)*

- The change MUST be limited to the task workspace user experience unless a directly required dependency is identified during planning.
- The implementation MUST preserve existing ownership boundaries and keep business workflow decisions outside purely visual page elements.
- User-facing copy introduced for states, labels, or actions MUST follow existing Chrona terminology and localization practices.
- Existing loading, empty, success, error, blocked, review-required, and completed meanings MUST remain consistent while becoming more visually distinct.
- Pre-edit browser observation MUST include a snapshot and screenshots at 1440x900, 1024x768, and 390x844.
- Post-edit browser verification MUST include a snapshot and screenshots at 1440x900, 1024x768, and 390x844.
- Verification MUST confirm no horizontal scrolling at 390px width.
- Verification MUST include automated type, lint, and test checks.
- End-to-end workflow checks MUST run if task navigation or task interactions are changed.
- The feature MUST not introduce material performance risk; the workspace should remain responsive during initial display and common interactions.

### Key Entities *(include if feature involves data)*

- **Task**: The current unit of work shown in the workspace, including identity, status, workflow progress, and available actions.
- **Plan Node**: A step within the task plan, including its label, active/completed/blocked/review state, and relationship to the user's next action.
- **Workspace State**: The page-level condition shown to the user, such as loading, empty, error, running, blocked, review-required, or completed.
- **Primary Action**: The most important next user action for the current task and active node.
- **Browser Evidence**: Before-and-after screenshots and snapshots used to verify responsive layout and workflow usability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability review, a user can identify the current task, task state, active node, and primary next action within 5 seconds on desktop, tablet, and mobile.
- **SC-002**: At 390px viewport width, the workspace has zero horizontal page scroll in the verified task states.
- **SC-003**: Loading, empty, error, blocked, review-required, and completed states are each distinguishable by label, visual treatment, and next-step guidance in review.
- **SC-004**: Before-and-after evidence exists for desktop 1440x900, tablet 1024x768, and mobile 390x844, including screenshots and browser snapshots.
- **SC-005**: The primary task workflow can be operated in browser verification with no console errors and no broken network requests.
- **SC-006**: Existing task creation, plan generation, plan acceptance, task execution, assistant interaction, schedule, and navigation behaviors remain available after the UX change.
- **SC-007**: Automated quality checks for typing, linting, and tests complete successfully before the feature is considered ready.

## Assumptions

- The target users are existing Chrona users who already have access to the task workspace.
- This feature focuses on one page: the task workspace. Broader navigation, global shell, onboarding, and unrelated task lists are out of scope unless directly needed to reach or validate the workspace.
- Existing backend data is sufficient for the UX improvements unless planning discovers a specific missing state or action needed to satisfy the requirements.
- Existing product terminology and workflow semantics remain authoritative.
- Browser evidence can be captured in a local development environment with representative workspace data.
