# Feature Specification: Global AI Sidebar

**Feature Branch**: `009-global-ai-sidebar`  
**Created**: 2026-05-18  
**Status**: Draft  
**Input**: User description: "设计一个 Chrona 的全局 AI Sidebar。它不是右下角聊天气泡，而是固定在应用右侧的上下文侧栏，通过顶部的 “Ask Chrona / ⌘K” 全局入口打开。Sidebar 会根据当前页面自动切换能力：在任务页中理解当前任务、节点状态、阻塞原因，并提供解释阻塞、修改计划、重试节点、添加步骤等操作；在日程页中理解日期、待安排队列、空闲时间和冲突，并提供智能排程、找空档、解释未排入原因、处理冲突等操作。界面包含页面上下文摘要、快捷操作按钮、对话区域、AI 方案预览卡片和确认按钮。所有 AI 改动都必须先以预览形式展示，例如任务变更预览或日程 ghost blocks，用户确认后才真正应用。整体视觉应与 Chrona 现有风格一致：轻量、圆角卡片、蓝色强调、清晰分区、像原生生产力工具的一部分，而不是外置客服聊天窗。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open Contextual AI Sidebar From Anywhere (Priority: P1)

As a Chrona user, I want a global "Ask Chrona" entry that opens a fixed right-side AI sidebar, so I can get context-aware help without leaving the page or using an external-looking chat widget.

**Why this priority**: This establishes the global access pattern, visual placement, and product-native experience that every other AI capability depends on.

**Independent Test**: Can be tested by opening the global entry from supported pages and confirming the sidebar appears on the right, summarizes the current page context, preserves the user's place, and closes without changing data.

**Acceptance Scenarios**:

1. **Given** the user is on a supported Chrona page, **When** they activate "Ask Chrona" or the keyboard shortcut, **Then** a fixed right-side AI sidebar opens with a page context summary and the main page remains usable.
2. **Given** the sidebar is open, **When** the user navigates between supported task and schedule pages, **Then** the sidebar updates its context summary and available actions to match the new page.
3. **Given** the sidebar is closed, **When** the user activates the global entry again, **Then** it reopens without creating a floating chat bubble or obscuring the primary page action.

---

### User Story 2 - Get Task-Aware Assistance With Previewed Changes (Priority: P1)

As a user working on a task, I want the sidebar to understand the current task, node state, blockers, and review status, so I can ask for explanations and propose task changes that are previewed before being applied.

**Why this priority**: Task execution and blocked-node recovery are core Chrona workflows; AI must help users act safely without applying hidden changes.

**Independent Test**: Can be tested by opening the sidebar on a task page with active, blocked, and review nodes, using task quick actions, and confirming every proposed task change is shown as a preview requiring explicit confirmation.

**Acceptance Scenarios**:

1. **Given** a task page has a blocked node, **When** the user chooses "Explain blocker", **Then** the sidebar explains the blocking reason using the visible task and node context.
2. **Given** the user requests a plan modification, retry, or added step, **When** Chrona proposes an AI action, **Then** the sidebar displays a task change preview before any task data changes.
3. **Given** a task change preview is visible, **When** the user confirms it, **Then** the change is applied and the sidebar reports the outcome.
4. **Given** a task change preview is visible, **When** the user dismisses it, **Then** no task data changes.

---

### User Story 3 - Get Schedule-Aware Assistance With Ghost Blocks (Priority: P1)

As a user planning a schedule, I want the sidebar to understand the selected date, unscheduled queue, free time, and conflicts, so I can preview scheduling proposals before committing them.

**Why this priority**: Scheduling is another primary Chrona workflow, and AI-generated schedule changes must be visually inspectable before they alter the calendar.

**Independent Test**: Can be tested by opening the sidebar on a schedule page, requesting smart scheduling or conflict handling, and confirming proposed changes appear as preview cards and schedule ghost blocks until the user confirms.

**Acceptance Scenarios**:

1. **Given** the user is viewing a schedule date with an unscheduled queue, **When** they choose "Smart schedule", **Then** the sidebar proposes placements and the schedule displays them as ghost blocks only.
2. **Given** a schedule proposal cannot place every item, **When** the user asks why, **Then** the sidebar explains the unplaced reasons using available time, conflicts, and item constraints.
3. **Given** conflicts exist, **When** the user chooses a conflict resolution action, **Then** the sidebar shows a conflict handling preview before any schedule changes are applied.
4. **Given** ghost blocks are visible, **When** the user confirms the proposal, **Then** the schedule applies the selected changes and removes the preview state.

---

### User Story 4 - Continue a Contextual Conversation Around Proposed Plans (Priority: P2)

As a user, I want to ask follow-up questions in the sidebar and refine AI proposals, so I can understand tradeoffs before confirming changes.

**Why this priority**: Conversation and refinement make the sidebar useful beyond one-click actions, but the preview and confirmation safety model remains the higher-priority requirement.

**Independent Test**: Can be tested by asking a follow-up question after a task or schedule proposal and verifying the sidebar keeps relevant conversation context while replacing or updating the preview.

**Acceptance Scenarios**:

1. **Given** the sidebar has shown an AI proposal, **When** the user asks for an alternative, **Then** the sidebar presents a revised preview without applying the previous one.
2. **Given** the user asks an explanatory question, **When** Chrona responds, **Then** the response appears in the conversation area and does not create an actionable change unless a preview is explicitly shown.

### Edge Cases

- If the current page has no supported AI capabilities, the sidebar shows a general context summary and explains that task or schedule actions are unavailable on this page.
- If page context changes while a preview is pending, the sidebar marks the preview as stale and requires the user to regenerate or discard it before confirmation.
- If required context is missing, loading, or unavailable, quick actions that depend on that context are disabled with a clear reason.
- If an AI proposal fails to apply after confirmation, the sidebar keeps the original data unchanged, reports the failure, and offers safe retry or dismissal options.
- If the available viewport is narrow, the sidebar must remain usable without causing horizontal scrolling or hiding the primary confirmation controls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a global "Ask Chrona" entry with a visible keyboard shortcut hint that opens the AI sidebar from supported application pages.
- **FR-002**: The AI sidebar MUST appear as a fixed right-side contextual panel rather than a floating bottom chat bubble.
- **FR-003**: The sidebar MUST show a page context summary that identifies the current supported page type and the key objects relevant to that page.
- **FR-004**: The sidebar MUST automatically switch available capabilities when the user moves between task and schedule contexts.
- **FR-005**: On task pages, the sidebar MUST represent the current task, active node, node state, blocked or review status, and blocking reason when available.
- **FR-006**: On task pages, users MUST be able to request blocker explanations, plan modifications, node retries, and added task steps from the sidebar.
- **FR-007**: On schedule pages, the sidebar MUST represent the selected date, unscheduled queue, free time, and schedule conflicts when available.
- **FR-008**: On schedule pages, users MUST be able to request smart scheduling, free-slot discovery, unplaced-item explanations, and conflict handling from the sidebar.
- **FR-009**: The sidebar MUST include distinct sections for context summary, quick actions, conversation, AI proposal preview, and confirmation controls.
- **FR-010**: Any AI action that would change task or schedule data MUST first be shown as a preview and MUST NOT apply until the user explicitly confirms it.
- **FR-011**: Task-related previews MUST clearly show proposed task changes, including affected task areas and whether nodes, steps, blockers, or plan content would change.
- **FR-012**: Schedule-related previews MUST clearly show proposed schedule changes, including visual ghost blocks for tentative time placements.
- **FR-013**: Users MUST be able to confirm, dismiss, or refine an AI proposal from the sidebar.
- **FR-014**: Explanatory AI responses MUST be visually distinct from actionable previews so users can tell when a response is informational only.
- **FR-015**: The system MUST prevent stale previews from being applied after the underlying task or schedule context changes materially.
- **FR-016**: The sidebar MUST provide clear success, failure, loading, empty, and unavailable states for AI actions.
- **FR-017**: The sidebar MUST preserve Chrona's existing task and schedule behavior unless the user confirms a previewed AI change.

### Quality & Experience Requirements *(mandatory)*

- The feature MUST preserve Chrona's existing product language, page hierarchy, and interaction patterns; it must feel like a native productivity sidebar rather than an external support chat.
- The visual design MUST use lightweight rounded cards, blue emphasis for primary affordances, clear section separation, and restrained density consistent with Chrona's current style.
- User-facing text MUST follow the product's localization and terminology rules for all visible labels, states, and action descriptions.
- Current task, active node, blocked or review state, schedule conflicts, and the primary confirm action MUST be visually obvious whenever they are relevant to the current page.
- The sidebar MUST work at desktop 1440x900, tablet 1024x768, and mobile 390x844 viewports, and mobile layouts MUST avoid horizontal scrolling.
- Frontend visual and interaction changes MUST include pre-edit product observation and post-edit verification evidence at the required desktop, tablet, and mobile viewport sizes.
- Changed behavior MUST ship with automated coverage for contextual capability switching, preview-before-confirm safety, task proposal flows, schedule ghost-block proposal flows, stale preview protection, and confirm or dismiss outcomes.
- End-to-end coverage MUST be included because this feature affects task, schedule, and navigation flows.
- The feature MUST keep business decision logic outside presentation-only UI and preserve existing ownership boundaries between page state, AI proposal state, and confirmed data changes.
- Backend-facing behavior MUST remain unchanged unless planning identifies a necessary capability gap; any data contract change must be justified by the preview and confirmation safety model.
- Opening, closing, and switching the sidebar context MUST feel immediate to users; AI response generation may show progress, but it must not block normal page navigation.

### Key Entities *(include if feature involves data)*

- **AI Sidebar Session**: The current sidebar interaction state, including open or closed state, current page context, conversation messages, available actions, pending proposal, and loading or error state.
- **Page Context Summary**: A concise representation of the active page, including task-specific or schedule-specific details needed to explain AI recommendations.
- **Quick Action**: A page-aware AI action surfaced as a button, such as explaining a blocker, retrying a node, smart scheduling, finding a free slot, or resolving a conflict.
- **AI Proposal Preview**: A non-applied AI recommendation that describes intended changes, affected records, risks, and required user confirmation.
- **Task Change Preview**: A task-focused proposal preview covering plan edits, node retry intent, added steps, or blocker-related changes.
- **Schedule Ghost Block**: A temporary visual representation of a proposed schedule placement that is visible before confirmation and removed if dismissed or regenerated.
- **Confirmation Decision**: The user's explicit choice to apply, dismiss, or refine a pending proposal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of users in usability testing can find and open the global AI sidebar from a supported page within 10 seconds.
- **SC-002**: 90% of users can correctly identify whether an AI response is informational or a pending change preview before taking action.
- **SC-003**: 100% of AI-generated task or schedule changes require explicit user confirmation before any data changes are applied.
- **SC-004**: 90% of task-page test participants can use the sidebar to understand a blocked node and choose an appropriate next action within 2 minutes.
- **SC-005**: 90% of schedule-page test participants can preview a scheduling proposal and either confirm or dismiss it within 2 minutes.
- **SC-006**: No validated mobile viewport shows horizontal scrolling while the sidebar is open.
- **SC-007**: At least 80% of beta users rate the sidebar as feeling integrated with Chrona rather than like an external chat or support widget.
- **SC-008**: Users can continue using the underlying page while the sidebar is open, with no loss of current task or schedule context during normal navigation between supported pages.

## Assumptions

- The initial release focuses on task and schedule pages because those contexts are explicitly described and represent the primary AI sidebar capabilities.
- The global entry appears in the application's top-level navigation or command area where users already expect global actions.
- Unsupported pages may still open the sidebar, but only general context and non-mutating conversation are available until page-specific capabilities are defined.
- AI proposals are generated from the current visible or loaded Chrona context and must not silently infer hidden changes that are absent from the preview.
- Existing task and schedule permission rules continue to govern whether a user can confirm a proposed change.
- Conversation history is scoped to the current sidebar session unless a later product decision defines persistent AI history.
