# Quickstart: Task Workspace UI Functionality

## Goal

Validate that the task workspace contains only useful controls and that every visible retained interactive component performs a real action, explains why it is unavailable, or has been removed.

## Setup

1. Install dependencies if needed: `bun install`
2. Generate Prisma client if needed: `bun run db:generate`
3. Seed local data if needed: `bun run db:seed`
4. Start the app for manual verification: `bun run dev`

## Implementation Verification Checklist

- Open a seeded or representative task workspace.
- Build an inventory of every visible button, tab, menu item, link-like region, graph control, panel control, and action affordance.
- Confirm every inventory item has a final decision: keep working, wire to behavior, disable with reason, convert to informational content, or remove.
- Activate every retained enabled control and confirm it produces a visible outcome.
- Trigger or simulate every retained failure path and confirm current workspace context is preserved.
- Confirm unavailable actions explain the relevant task, data, permission, or in-progress condition.
- Confirm removed controls no longer appear as clickable or keyboard-focusable elements.
- Confirm empty task, no-node, no-artifact, loading, stale, and error states do not show misleading controls.
- Confirm repeated clicks or submissions cannot create duplicate conflicting actions.
- Confirm desktop and narrow viewport layouts keep all retained actions reachable without layout gaps from removed components.

## Automated Proof Commands

Run before considering implementation complete:

```bash
bun run typecheck
bun run lint
bun run test
```

## Targeted Test Coverage

Add or update tests for:

- Workspace action inventory coverage for the task workspace page and supporting task workspace components.
- Retained task-level actions: success, failure, loading, disabled, and duplicate-submission states.
- Flow controls and node selection behavior.
- Node detail tabs and actions, including empty result/evidence/action/configuration states.
- Overview actions for latest result, attention item, artifacts, activity, and refresh where retained.
- Removed placeholder or redundant controls not rendering as interactive elements.
- Permission-limited controls showing correct hidden or disabled behavior.
- Responsive reachability of retained controls when feasible through component or browser tests.
- Contract/server behavior for any newly added backend action.

## Backend Change Rule

Add or modify backend API behavior only after auditing current contracts and confirming a retained UI action cannot be implemented with existing task workspace data or actions. Any backend change must include shared validation, permission handling, failure mapping, and tests.

## No Dead UI Rule

Do not leave TODO controls, placeholder menu items, empty buttons, inactive tabs, clickable decorative cards, or future-only affordances in the task workspace. Remove them unless they can be connected to a current workflow or represented as clear non-interactive information.
