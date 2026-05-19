# Data Model: Global AI Sidebar

## AI Sidebar Session

**Purpose**: Holds current client-side sidebar interaction state.

**Fields**:
- `id`: stable session id for current open lifecycle.
- `isOpen`: whether the sidebar panel is visible.
- `context`: current `PageContextSummary`.
- `messages`: ordered `ConversationMessage[]` for current session.
- `availableActions`: `QuickAction[]` derived from current context.
- `pendingProposal`: `AiProposalPreview | null`.
- `status`: `idle | loading | streaming | applying | success | error | unavailable`.
- `errorMessage`: localized display key or resolved message when status is `error`.

**Validation**:
- At most one `pendingProposal` per session.
- Mutating confirm controls disabled unless `pendingProposal.confirmability === "confirmable"`.
- Unsupported page contexts may only expose non-mutating actions.

## Page Context Summary

**Purpose**: Serializable summary of active page and relevant objects.

**Fields**:
- `type`: `task | schedule | unsupported`.
- `fingerprint`: stable hash/version from material context fields.
- `title`: short localized summary title.
- `primaryObjectLabel`: task title, selected date, or page label.
- `highlights`: concise key-value list shown in context summary card.
- `capabilities`: enabled capability ids.
- `unavailableReasons`: capability id to localized reason.

**Task fields**:
- `taskId`, `taskTitle`, `activeNodeId`, `activeNodeTitle`, `nodeState`, `blockReason`, `reviewState`, `primaryAction`.

**Schedule fields**:
- `workspaceId`, `selectedDate`, `unscheduledCount`, `freeMinutes`, `largestIdleWindowMinutes`, `conflictCount`, `activeView`, `primaryAction`.

**Validation**:
- `fingerprint` changes when task id, active node, blocker/review state, selected date, queue, free-time, conflict, or loaded proposal context materially changes.

## Quick Action

**Purpose**: Page-aware action button in the sidebar.

**Fields**:
- `id`: capability id.
- `label`: i18n key or localized label.
- `description`: i18n key or localized help.
- `kind`: `informational | mutating-preview`.
- `enabled`: boolean.
- `disabledReason`: optional localized reason.

**Validation**:
- Mutating actions must generate `AiProposalPreview` before any apply callback can run.
- Disabled actions must explain why.

## Conversation Message

**Purpose**: Visible conversation history for current sidebar session.

**Fields**:
- `id`, `role`, `createdAt`, `content`, `status`.
- `responseKind`: `informational | proposal | error`.
- `relatedProposalId`: optional proposal id.

**Validation**:
- Informational messages cannot expose confirm controls unless linked to a proposal.

## AI Proposal Preview

**Purpose**: Non-applied recommendation requiring explicit confirmation for mutations.

**Fields**:
- `id`, `contextFingerprint`, `createdAt`, `kind`.
- `summary`, `affectedAreas`, `riskLevel`, `explanation`.
- `confirmability`: `confirmable | stale | applying | applied | failed`.
- `taskPreview`: `TaskChangePreview | null`.
- `schedulePreview`: `ScheduleGhostBlockPreview | null`.

**Validation**:
- Exactly one of `taskPreview` or `schedulePreview` is present for mutating proposals.
- Confirmation fails closed when current context fingerprint differs from proposal fingerprint.
- Dismiss removes proposal without applying changes.

## Task Change Preview

**Purpose**: Shows proposed task changes before task data mutation.

**Fields**:
- `taskId`, `changeType` (`plan-modification | retry-node | add-step | blocker-resolution`).
- `affectedNodes`, `addedSteps`, `planDiffSummary`, `blockerChange`, `requiresReview`.

**Validation**:
- Node retry requires an existing affected node id.
- Added step previews require title and insertion target.

## Schedule Ghost Block Preview

**Purpose**: Shows tentative schedule changes as cards and ghost blocks.

**Fields**:
- `selectedDate`, `placements`, `unplacedItems`, `conflictsResolved`, `conflictsRemaining`.
- `placements[]`: `taskId`, `title`, `startAt`, `endAt`, `reason`, `confidence`.

**Validation**:
- Placements must have valid start/end ordering.
- Ghost blocks never enter persisted scheduled arrays before confirmation.
- Unplaced items include a reason.

## Confirmation Decision

**Purpose**: Captures explicit user action on pending proposal.

**Fields**:
- `proposalId`, `decision` (`confirm | dismiss | refine`), `decidedAt`, `resultStatus`, `resultMessage`.

**State Transitions**:
- `loading -> proposal(confirmable)` after AI produces mutating preview.
- `proposal(confirmable) -> applying -> applied` after successful confirmation.
- `proposal(confirmable) -> failed` if apply fails without data mutation.
- `proposal(confirmable) -> stale` when context fingerprint changes.
- `proposal(confirmable|stale|failed) -> null` on dismiss.
- `proposal(confirmable|stale) -> loading` on refine/regenerate.
