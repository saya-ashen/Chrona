# Contract: Assistant Surface State

## Purpose

Defines the page-aware state consumed by the single global Chrona AI dropdown.

## Surface State Shape

```ts
type AssistantSurfaceState = {
  page: "schedule" | "task" | "workbench" | "unsupported";
  contextFingerprint: string;
  title: string;
  icon: string;
  summaries: PageStatusSummary[];
  topPriorityState: PageStatusSummary | null;
  quickActions: AssistantQuickAction[];
  recentProposals: RecentProposalEntry[];
  input: {
    enabled: boolean;
    placeholder: string;
    disabledReason?: string;
  };
  availability: "ready" | "loading" | "unavailable" | "stale" | "error";
  disabledReason?: string;
};
```

## Status Summary Shape

```ts
type PageStatusSummary = {
  id: string;
  page: AssistantSurfaceState["page"];
  label: string;
  severity: "error" | "blocked" | "conflict" | "warning" | "active" | "pending" | "success" | "info";
  count?: number;
  progress?: { current: number; total: number };
  priority: number;
  icon: string;
};
```

## Quick Action Shape

```ts
type AssistantQuickAction = {
  id: string;
  label: string;
  description: string;
  intent: string;
  severity: PageStatusSummary["severity"];
  requiresPreview: boolean;
  previewSurface: "schedule.timeline" | "task.config" | "task.graph" | "workbench.result" | "none";
  disabledReason?: string;
};
```

## Mapping Contract

Quick actions are derived from mapping records equivalent to:

```ts
type AssistantActionMapping = Record<
  AssistantSurfaceState["page"],
  Partial<Record<PageStatusSummary["severity"], AssistantQuickAction[]>>
>;
```

## Required Behavior

- The frontend dropdown renders quick actions from `AssistantSurfaceState.quickActions` only.
- Error, blocked, and conflict summaries take precedence over all other summary severities.
- Mutating actions must set `requiresPreview: true` and must not use `previewSurface: "none"`.
- Unsupported or failed state must not expose enabled mutating actions.
- `disabledReason` must be shown when present.

## Migration Mapping

- `AiSidebarPageContextSummary.type` maps to `AssistantSurfaceState.pageType`.
- `AiSidebarPageContextSummary.fingerprint` maps to `AssistantSurfaceState.fingerprint`.
- `AiSidebarHighlight[]` maps to sorted `AssistantStatusSummary[]`; critical and warning tones rank above info/success/neutral.
- `AiSidebarQuickAction.kind: "mutating-preview"` maps to `AssistantQuickAction.kind: "proposal"` with `previewRequired: true`.
- `smart-schedule` and `handle-conflict` route to `schedule.timeline`.
- `modify-plan` routes to `task.config`.
- `retry-node` and `add-step` route to `task.graph`.
- `review-result` routes to `workbench.result`.
