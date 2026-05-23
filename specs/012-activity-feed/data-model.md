# Data Model: Workspace Activity Feed

## ActivityItem

Represents one user-facing activity entry in a task or node feed.

**Fields**:
- `id`: Stable activity identifier used for rendering and deduplication.
- `kind`: Activity category. Allowed values: `assistant_message`, `reasoning`, `tool_started`, `tool_completed`, `provider_run`, `approval`, `node`, `task`, `artifact`, `schedule`, `raw`.
- `title`: Short user-facing title.
- `summary`: Concise user-facing description.
- `timestamp`: Event time used for ordering.
- `tone`: Visual severity or state. Allowed values: `neutral`, `info`, `success`, `warning`, `danger`.
- `sourceNodeId`: Node identifier when activity belongs to a node.
- `sourceNodeTitle`: Node title when activity belongs to a node.
- `provider`: Provider name when activity came from an AI/runtime provider.
- `runtimeName`: Runtime display name when available.
- `runId`: Logical provider run identifier when available.
- `nativeRunId`: Provider-native run identifier when available.
- `sequence`: Monotonic event order when available.
- `rawEventType`: Raw source event type for diagnostics and unknown activity display.
- `tool`: ToolActivityDetails when `kind` is tool-related.
- `assistant`: AssistantActivityDetails when `kind` is assistant or reasoning.
- `raw`: Bounded raw details for unknown or diagnostic display.

**Validation rules**:
- `id`, `kind`, `title`, `summary`, and `timestamp` are required.
- Node-scoped feeds may include only items whose `sourceNodeId` matches the selected node.
- Tool activity must include at least a tool name or label.
- Assistant and reasoning activity must not be merged together.
- Text fragments may merge only when task scope, node, run, provider, runtime, and kind match.
- Final state must not synthesize `sourceNodeId` from time-window inference.

## ToolActivityDetails

Represents details for provider tool activity.

**Fields**:
- `name`: Tool identifier.
- `label`: User-facing tool label.
- `preview`: Short description of the operation when available.
- `inputSummary`: Bounded summary of tool input when available.
- `durationMs`: Completion duration when available.
- `error`: Error message when the tool failed.
- `state`: `started`, `completed`, or `failed`.

**Validation rules**:
- Failed tool activity must use `state: failed` and `tone: danger` when an error is present.
- Successful completion should use `state: completed` and `tone: success`.
- Long preview/input/error values must be summarized first and expandable in the feed.

## AssistantActivityDetails

Represents assistant output or reasoning content.

**Fields**:
- `text`: Assistant-visible text or reasoning text.
- `isReasoning`: Whether the content is reasoning rather than assistant output.
- `isPartial`: Whether the entry represents an in-progress live segment.

**Validation rules**:
- Reasoning defaults to a less prominent or collapsed presentation.
- Assistant output and reasoning use separate `kind` values and separate merge groups.

## ActivityScope

Represents the feed scope requested by the user.

**Fields**:
- `type`: `task` or `node`.
- `taskId`: Owning task identifier.
- `nodeId`: Selected node identifier when `type` is `node`.
- `limit`: Maximum number of initially visible items.
- `cursor`: Optional position for older history browsing.

**Validation rules**:
- `nodeId` is required for node scope.
- Task scope includes task-level and all node-level activity.
- Node scope excludes activity without matching node identity.

## ActivityFeedState

Represents the frontend view state for a feed.

**Fields**:
- `items`: Ordered ActivityItem collection.
- `scope`: ActivityScope.
- `isLoading`: Whether more activity is loading.
- `hasMore`: Whether older activity can be loaded.
- `emptyMessage`: User-facing empty state copy.
- `expandedItemIds`: Activity entries expanded by the user.

**Validation rules**:
- Newest relevant activity is visible first.
- Live and persisted events are deduplicated before rendering.
- Expansion state must not affect event ordering or filtering.

## ActivityPage

Represents a page of persisted activity used for initial load or older-history browsing.

**Fields**:
- `items`: ActivityItem collection.
- `nextCursor`: Cursor for older activity, if more exists.
- `scope`: ActivityScope used to produce the page.

**Validation rules**:
- Items must match the requested scope.
- Page boundaries must preserve ordering without duplicate activity across pages.
- Initial page must support the performance budget for tasks with at least 3,000 events.

## ActivityPhase

Represents delivery stage and exit criteria.

**Fields**:
- `phase`: `phase_1`, `phase_2`, or `phase_3`.
- `name`: Phase name.
- `exitCriteria`: Verifiable completion criteria.
- `legacyPolicy`: What old labels, renderers, or compatibility paths remain or are removed in that phase.

**State transitions**:
- `phase_1` → `phase_2`: Core task-wide and node-scoped Activity feeds are usable and validated.
- `phase_2` → `phase_3`: Deep history browsing and operational details are complete and performant.
- `phase_3` → final: Legacy Evidence drawer behavior, coarse-only renderers, compatibility fallbacks, and unreliable inference are removed.
