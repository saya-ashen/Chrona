# Quickstart: Task Workspace Component Parity

## Goal

Validate that the task workspace matches the reference image at functional component level while preserving Chrona's local stack, execution behavior, and engineering constraints.

## Setup

1. Install dependencies if needed: `bun install`
2. Generate Prisma client if needed: `bun run db:generate`
3. Seed local data if needed: `bun run db:seed`
4. Start the app for manual verification: `bun run dev`

## Implementation Verification Checklist

- Open a seeded or representative task workspace.
- Confirm global navigation shows Chrona identity, active task section, notifications, and settings.
- Confirm task header shows breadcrumb, title edit affordance, status, completed/total steps, percentage progress, and task-level actions.
- Confirm execution flow map shows nodes, connections, all relevant statuses, artifact indicators, attention indicators, legend, zoom, center/fit, and expand controls.
- Select multiple nodes and confirm node detail updates without leaving the page.
- Confirm node detail has result, evidence, action, and configuration tabs with appropriate empty states.
- Confirm right overview shows latest result, attention-needed card, artifact summary, and activity timeline.
- Confirm task with no nodes shows an empty flow state and still exposes task-level context.
- Confirm a node with no artifacts clearly shows no artifacts.
- Confirm blocked or approval-needed node appears in both the flow and attention overview.
- Confirm narrow viewport keeps all core regions reachable.

## Automated Proof Commands

Run before considering implementation complete:

```bash
bun run typecheck
bun run lint
bun run test
```

## Targeted Test Coverage

Add or update tests for:

- Task workspace view-model mapping from existing task/plan data.
- Header progress, status, and action visibility.
- Flow map state mapping for completed, running, waiting, approval-needed, and blocked nodes.
- Node selection updating the detail panel.
- Result/evidence/action/configuration tabs and empty states.
- Right-side latest result, attention, artifact, and activity sections.
- No-node, no-artifact, stale/error, and permission-limited states.
- Responsive reachability of key regions when feasible through component or browser tests.

## Dependency Rule

Use existing dependencies first. If adding a dependency, document the reason in implementation notes and verify that it materially improves the design versus current React, `@xyflow/react`, and existing utility dependencies.

## Implementation Notes

- No new dependency is required for the execution-console component parity work. The current React 19, Testing Library, Vitest, and `@xyflow/react` stack covers the shared view-model, graph state, node selection, and responsive component tests.
- The lower node detail panel now reuses the existing graph inspector detail and execution-action primitives instead of duplicating action dispatch logic in a second implementation path.
- Focused verification now covers navigation/member context, overview stale and empty states, lower detail tabs, and region reachability through `task-workspace-page`, `task-workspace-query`, `task-workspace-node-detail-panel`, and `task-workspace-execution-overview` tests.

## Manual Verification Notes

- Desktop: confirm the left navigation, header, flow graph, lower node detail panel, and right overview are visible in one workspace console layout.
- Narrow viewport: confirm navigation, flow, node detail, and overview remain reachable as stacked regions without losing node selection context.
- Use an approval-needed fixture or seeded task to confirm overview actions jump back into the selected node context and the lower panel stays in-page.

## No Legacy Compatibility Rule

Do not keep old task workspace layout code in parallel with the new component hierarchy unless a concrete persisted-data, shipped-behavior, or external-consumer need is identified. Remove or replace obsolete local UI/data-shaping paths as part of implementation tasks.
