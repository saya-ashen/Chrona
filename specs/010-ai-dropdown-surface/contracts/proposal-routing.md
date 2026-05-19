# Contract: Proposal Routing

## Purpose

Defines how AI-generated mutations leave the dropdown and enter page-owned preview modes.

## Proposal Result Shape

```ts
type AssistantActionResult =
  | {
      kind: "informational";
      message: string;
    }
  | {
      kind: "proposal";
      proposal: AssistantProposal;
      route: ProposalRoute;
    }
  | {
      kind: "error";
      message: string;
      retryable: boolean;
    };
```

## Proposal Shape

```ts
type AssistantProposal = {
  id: string;
  sourceActionId?: string;
  summary: string;
  createdAt: string;
  contextFingerprint: string;
  riskLevel: "low" | "medium" | "high";
  previewSurface: "schedule.timeline" | "task.config" | "task.graph" | "workbench.result";
  status: "draft" | "ready_for_review" | "accepted" | "rejected" | "stale" | "applying" | "applied" | "failed";
  payload: unknown;
};
```

## Route Shape

```ts
type ProposalRoute = {
  surface: AssistantProposal["previewSurface"];
  pageHref: string;
  proposalId: string;
  focusTarget?: string;
  returnHref?: string;
};
```

## Preview Surface Routing

| Preview Surface | Required Preview Ownership |
|-----------------|----------------------------|
| `schedule.timeline` | Schedule timeline previews task moves, conflict resolution, and auto-scheduling |
| `task.config` | Task configuration previews field-level task configuration changes |
| `task.graph` | Task graph previews plan node and dependency changes |
| `workbench.result` | Workbench result view previews accept, retry, and follow-up outcomes |

## Required Behavior

- Dropdown may display proposal summary and route entry only.
- Dropdown must not render complex diffs.
- Dropdown must not confirm or apply proposal mutations.
- Owning preview surface must perform explicit user confirmation before command handler mutation.
- Rejected, dismissed, or closed proposals must not mutate task, plan, schedule, or execution state.

## Implementation Routing Notes

- The dropdown creates brief proposal route entries only; it does not render old confirm, dismiss, or refine controls.
- Initial route query parameters use `assistantProposal` and `surface` so owning pages can opt into focused preview handling without applying commands from dropdown code.
- Schedule ghost preview remains page-owned through the Schedule page render path.
- Task config/graph and Workbench result routes are represented by `AssistantProposalRoute.surface` and can be consumed by the owning page surfaces.
