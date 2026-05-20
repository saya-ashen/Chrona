# Feature Specification: Shadcn UI Refactor

**Feature Branch**: `011-shadcn-ui-refactor`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "请重构 Chrona 前端的 UI 组件体系。当前项目虽然接入了 shadcn/ui，但页面大量使用自定义的 buttonVariants、StatusBadge、SurfaceCard 等组件，重复实现了 shadcn 已有的 Button、Badge、Card 等能力。请扫描 UI 组件和页面引用，找出重复基础组件，优先引入或生成标准 shadcn 组件，将页面替换为 shadcn 组件或基于 shadcn 的轻量封装，保留必要品牌样式但不要重复造基础组件，确保类型、样式、暗色模式和现有测试正常。目标是减少自定义 UI 维护成本，让项目真正以 shadcn/ui 作为基础组件体系。完全替换，不保留旧兼容或者旧代码，并确保 AI 后续不会再犯相同错误。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consolidate Duplicate Foundation Components (Priority: P1)

Chrona maintainers need the product UI to rely on one shared foundation for common controls so routine changes to buttons, badges, cards, and similar primitives do not require updating multiple competing implementations.

**Why this priority**: Duplicate foundational components are the core maintenance problem and create inconsistent behavior, styling, and dark-mode support across screens.

**Independent Test**: Can be tested by inventorying all common UI controls and verifying that every duplicate foundational implementation has either been removed or converted into a minimal brand wrapper around the shared foundation.

**Acceptance Scenarios**:

1. **Given** the existing UI component inventory, **When** maintainers review components that duplicate button, badge, card, dialog, input, select, dropdown, tabs, separator, skeleton, tooltip, or alert behavior, **Then** each duplicate is replaced by the shared foundation or a documented brand wrapper.
2. **Given** a page that previously imported a custom foundational component, **When** the page is reviewed after the refactor, **Then** it imports the shared foundation or an approved lightweight brand wrapper instead of the removed custom primitive.
3. **Given** removed legacy components, **When** the codebase is searched for their names and import paths, **Then** no page or active component continues to reference them.

---

### User Story 2 - Preserve Chrona Visual Identity and Product Behavior (Priority: P2)

Chrona users need affected screens to look and behave like the same product after the consolidation, including existing brand tone, state visibility, responsive behavior, and dark-mode quality.

**Why this priority**: Reducing maintenance cost must not regress the product experience or make active work states harder to understand.

**Independent Test**: Can be tested by comparing affected screens before and after the refactor across desktop, tablet, and mobile viewports and confirming that primary actions, current task, active node, blocked/review state, and empty/loading/error states remain clear.

**Acceptance Scenarios**:

1. **Given** a user opens an affected screen in light or dark mode, **When** they inspect primary actions and status information, **Then** visual hierarchy and state meaning remain at least as clear as before.
2. **Given** a user opens affected screens on desktop, tablet, and mobile widths, **When** they navigate and interact with the UI, **Then** no horizontal scrolling appears and layout remains usable.
3. **Given** existing product copy and terminology, **When** components are replaced, **Then** user-facing labels remain consistent with current Chrona language.

---

### User Story 3 - Prevent Reintroduction of Duplicate Primitives (Priority: P3)

Future contributors and AI agents need clear guardrails so new UI work does not recreate foundational components that already exist in the shared component system.

**Why this priority**: The refactor only reduces long-term maintenance if future work follows the same component ownership model.

**Independent Test**: Can be tested by reviewing repository guidance and automated checks to confirm they identify or block new custom foundational component implementations.

**Acceptance Scenarios**:

1. **Given** a contributor starts new UI work, **When** they read project guidance, **Then** it clearly states that foundational UI controls must use the shared foundation first and custom primitives are not allowed without documented product-specific justification.
2. **Given** a new duplicate foundational component is introduced, **When** quality checks or review guidance run, **Then** the issue is surfaced before the change is accepted.

### Edge Cases

- Existing custom components that encode Chrona-specific domain meaning, such as task state or workflow-specific status displays, must not be removed solely because they render a badge or card; they may remain only as thin domain wrappers around shared foundation components.
- Components with accessibility behavior must preserve keyboard navigation, focus visibility, labels, disabled states, and screen-reader semantics after replacement.
- Dark-mode-only regressions, including low contrast, missing borders, invisible focus rings, and incorrect muted backgrounds, must be treated as blocking issues.
- Removed legacy components must not leave orphaned exports, stale documentation, or confusing duplicate names that make future imports ambiguous.
- Affected pages must remain stable when data is loading, empty, partially unavailable, or in error states.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST provide a complete inventory of active UI components and page-level imports that use foundational controls or custom wrappers for foundational controls.
- **FR-002**: The project MUST classify each custom UI component as one of: shared foundation component, allowed Chrona brand/domain wrapper, page-specific composition, or removal candidate.
- **FR-003**: The project MUST replace custom components that duplicate foundational controls with the shared foundation component system.
- **FR-004**: The project MUST keep only lightweight Chrona wrappers when they add brand styling, domain semantics, or repeated product-specific composition that cannot be represented by the shared foundation alone.
- **FR-005**: The project MUST remove old duplicate foundational component files, exports, variants, and references rather than keeping compatibility aliases or parallel legacy implementations.
- **FR-006**: The project MUST preserve all existing user-visible behavior on affected screens unless a behavior change is explicitly documented as part of the refactor.
- **FR-007**: The project MUST preserve dark-mode behavior, responsive behavior, accessible interactions, and existing product terminology on affected screens.
- **FR-008**: The project MUST update repository guidance so future UI work uses the shared foundation first and does not recreate basic controls already covered by the shared component system.
- **FR-009**: The project MUST include a repeatable check or review mechanism that surfaces new duplicate foundational components before acceptance.
- **FR-010**: The project MUST document any remaining Chrona-specific wrappers with their purpose and why they are not generic foundational controls.

### Quality & Experience Requirements *(mandatory)*

- The refactor MUST preserve layer boundaries: foundational controls belong in the shared UI component area, domain-specific wrappers belong near shared product components, and page components should compose rather than redefine foundational behavior.
- The refactor MUST favor the smallest correct component surface: no compatibility aliases, no duplicate variants with different names for the same behavior, and no new abstraction unless it removes repeated product-specific composition.
- Automated verification MUST include type checking, linting, and the existing test suite. End-to-end tests are required if task, schedule, or navigation flows are changed.
- Frontend visual verification MUST include pre-edit observation and post-edit verification evidence for desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
- Affected screens MUST keep current task, active node, blocked/review state, and primary action visually obvious where those concepts are currently present.
- Mobile layouts MUST not introduce horizontal scrolling.
- User-facing strings MUST remain in the established message system when strings change or move.
- Backend behavior and data contracts MUST remain unchanged; UI consolidation alone is not a valid reason to change backend APIs.
- Performance risk is expected to be low because this is a UI consolidation, but affected screens MUST not show user-visible delays or layout instability compared with the current experience.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of active page imports for removed duplicate foundational components are replaced by shared foundation components or approved lightweight Chrona wrappers.
- **SC-002**: The active custom foundational component count is reduced by at least 80% from the pre-refactor inventory, excluding documented domain wrappers.
- **SC-003**: All affected screens pass verification in light mode and dark mode across desktop, tablet, and mobile viewports with zero blocking visual regressions.
- **SC-004**: Existing automated quality checks pass with no new type, lint, or test failures.
- **SC-005**: No removed legacy component names or import paths remain in active source files after the refactor.
- **SC-006**: New contributor guidance and review checks identify the shared foundation as the default for basic controls and flag duplicate custom primitives.
- **SC-007**: Users can complete the same primary flows on affected screens after the refactor without additional steps or loss of visible state information.

## Assumptions

- The target users for this feature are Chrona maintainers, contributors, AI coding agents, and end users of affected screens.
- The shared foundation component system already provides or can provide standard equivalents for common controls such as buttons, badges, cards, dialogs, inputs, selects, dropdowns, tabs, separators, skeletons, tooltips, and alerts.
- Chrona brand styling remains valuable, but it should be expressed through theme tokens, variants, composition, or thin domain wrappers rather than duplicate generic primitives.
- No backend API changes are required for this refactor.
- Existing page behavior and product flows remain in scope for preservation, not redesign.
