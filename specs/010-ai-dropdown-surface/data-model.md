# Data Model: AI Dropdown Surface

## AssistantSurfaceState

Represents the assistant status for the active page.

**Fields**:

- `page`: Page identifier: `schedule`, `task`, `workbench`, or `unsupported`.
- `contextFingerprint`: Stable fingerprint for the page data/projection snapshot used to derive state.
- `title`: Short page-level assistant title.
- `icon`: Emoji status icon token for the current top-priority state.
- `summaries`: Ordered list of `PageStatusSummary` values.
- `topPriorityState`: Highest-priority `PageStatusSummary` after severity ordering.
- `quickActions`: Ordered list of `AssistantQuickAction` values.
- `recentProposals`: Brief list of `RecentProposalEntry` values.
- `input`: Availability and placeholder metadata for the short current-page request input.
- `availability`: `ready`, `loading`, `unavailable`, `stale`, or `error`.
- `disabledReason`: Human-readable reason when the surface cannot offer actions.

**Relationships**:

- Has many page status summaries.
- Has many quick actions.
- Has many recent proposal entries.
- Derived from `PageContextSnapshot`, page projections, and event-derived state.

**Validation Rules**:

- Must not be the authoritative source for schedules, tasks, plans, or execution state.
- Must include a safe unavailable state when page data cannot be resolved.
- Must sort error, blocked, and conflict summaries before lower-severity summaries.
- Must not include quick actions hardcoded by front-end presentation components.

## PageContextSnapshot

Represents the current page context used to derive assistant state.

**Fields**:

- `page`: Page identifier.
- `workspaceId`: Workspace scope when relevant.
- `taskId`: Task scope when relevant.
- `selectedDate`: Schedule scope when relevant.
- `activeView`: Current page view or tab.
- `activeNodeId`: Active task graph/execution node when relevant.
- `stateSignals`: Normalized page signals such as conflict count, blocked state, waiting input, failed execution, queued items, or review count.
- `fingerprint`: Version/fingerprint of source state.

**Relationships**:

- Produces one AssistantSurfaceState.
- Supplies mapping inputs for quick actions.

**Validation Rules**:

- Must be built from existing page data, projections, and event-derived state.
- Must not persist as independent mutable truth.

## PageStatusSummary

Short state summary suitable for trigger rotation and dropdown details.

**Fields**:

- `id`: Stable summary id.
- `page`: Owning page.
- `label`: User-facing text.
- `severity`: `error`, `blocked`, `conflict`, `warning`, `active`, `pending`, `success`, or `info`.
- `count`: Optional count.
- `progress`: Optional current/total progress.
- `priority`: Numeric ordering hint after severity.
- `icon`: Emoji status icon token.

**Validation Rules**:

- Error, blocked, and conflict severities outrank other severities.
- Trigger text must remain short enough for top-bar display.
- Multiple summaries may rotate, but critical summaries must not be hidden behind lower-priority summaries.

## AssistantQuickAction

Server-derived action available in the dropdown.

**Fields**:

- `id`: Stable action identifier.
- `label`: Short button/menu label.
- `description`: User-facing explanation.
- `intent`: Action intent used to request AI work.
- `severity`: Severity associated with the action.
- `requiresPreview`: Whether the result must route to a preview before confirmation.
- `previewSurface`: `schedule.timeline`, `task.config`, `task.graph`, `workbench.result`, or `none`.
- `disabledReason`: Optional human-readable reason when unavailable.

**Relationships**:

- Belongs to one AssistantSurfaceState.
- May produce one AssistantProposal when triggered.

**Validation Rules**:

- Must be derived from page/state/severity mapping.
- Mutating actions must set `requiresPreview` to true and specify a non-`none` preview surface.
- Disabled actions must not execute and must explain why.

## AssistantProposal

AI-generated suggested change that requires page review.

**Fields**:

- `id`: Stable proposal id.
- `sourceActionId`: Quick action or short-input request that created it.
- `summary`: Brief proposal summary for dropdown/recent entry.
- `createdAt`: Creation time.
- `contextFingerprint`: Source page state fingerprint.
- `riskLevel`: `low`, `medium`, or `high`.
- `previewSurface`: Owning review surface.
- `route`: `ProposalRoute` to the preview surface.
- `status`: `draft`, `ready_for_review`, `accepted`, `rejected`, `stale`, `applying`, `applied`, or `failed`.
- `payload`: Surface-specific proposal details.

**Relationships**:

- Belongs to one preview surface.
- May be summarized by a recent proposal entry.
- Can be applied only by owning page command handler after user confirmation.

**Validation Rules**:

- Must not mutate data at creation time.
- Must become stale if the page context fingerprint no longer matches and safe reconciliation is not available.
- Must require explicit confirmation on the owning page before apply.

## ProposalRoute

Navigation/review target for an assistant proposal.

**Fields**:

- `surface`: Preview surface identifier.
- `pageHref`: Destination route or page location.
- `proposalId`: Proposal to open or highlight.
- `focusTarget`: Optional UI region to focus, such as active timeline block, task config section, graph node, or result panel.
- `returnHref`: Optional return location.

**Validation Rules**:

- Must route to the owning page, not to the dropdown.
- Must preserve enough context for the page to render preview mode.

## RecentProposalEntry

Brief dropdown entry for recent proposals.

**Fields**:

- `proposalId`: Proposal id.
- `summary`: Short display text.
- `previewSurface`: Owning preview surface.
- `status`: Current proposal status.
- `route`: Proposal route.

**Validation Rules**:

- Must not contain complex diff content.
- Must route to full review on the owning page.

## State Transitions

1. Page data/projections/events update -> `PageContextSnapshot` changes.
2. Snapshot plus page/state/severity mapping -> `AssistantSurfaceState` changes.
3. User opens dropdown -> surface state displays summaries and actions.
4. User triggers quick action or short input -> AI returns informational response or `AssistantProposal`.
5. Proposal appears as recent entry and routes to owning preview surface.
6. User reviews on owning page -> confirms or rejects.
7. Confirmed proposal invokes owning command handler -> mutation applies and projections update.
8. Updated projections produce new assistant surface state.
