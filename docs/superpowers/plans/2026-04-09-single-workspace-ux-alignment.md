# Single-Workspace UX Alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the MVP into a single-workspace-feeling product without removing the existing `Workspace` domain model, so the primary user experience stays focused on `Schedule / Tasks / Inbox / Memory / Settings` rather than workspace selection.

**Architecture:** Keep `Workspace` as the internal ownership boundary in Prisma, queries, commands, and projections, but introduce a default-workspace resolution path for top-level routes. Primary routes should resolve against that default workspace automatically, while explicit `/workspaces` surfaces move out of the main navigation and into a deeper advanced/settings path.

**Tech Stack:** `Next.js` App Router, `React 19`, `TypeScript`, `Bun`, `Prisma`, `SQLite`, `shadcn/ui`, `bun:test`, `Vitest`, `Testing Library`

---

## Scope Notes

- This plan follows the schedule-first MVP alignment and should be implemented on top of the current repository state rather than as a rewrite.
- Preserve the route-B hard constraint: the product must stay task-centric and control-plane-first, not admin-first and not chat-first.
- Do not remove `Workspace` from the schema or command/query boundaries in this iteration.
- The main UX target is `single-workspace by default`, not true single-tenancy. Multi-workspace support remains available as an advanced/internal capability.
- Top-level navigation should change from `Workspaces / Schedule / Tasks / Inbox / Memory / Settings` to `Schedule / Tasks / Inbox / Memory / Settings`.
- `Schedule`, `Tasks`, `Inbox`, and `Memory` should bind to the resolved default workspace instead of asking the user to choose a workspace first.
- `/workspaces` should remain implemented, but be demoted from the primary navigation and repositioned as an advanced/settings entry.
- If no workspace exists, the app should create or initialize a default workspace through a single controlled path rather than exposing a blank workspace-selection screen.

## File Structure

### Existing Files To Modify

- `src/modules/ui/navigation.ts`: remove `Workspaces` from the primary nav items.
- `src/app/page.tsx`: redirect the app entrypoint to the default top-level product surface instead of `/workspaces`.
- `src/app/schedule/page.tsx`: resolve and use the default workspace automatically.
- `src/app/tasks/page.tsx`: resolve and use the default workspace automatically.
- `src/app/inbox/page.tsx`: resolve and use the default workspace automatically.
- `src/app/memory/page.tsx`: resolve and use the default workspace automatically.
- `src/app/settings/page.tsx`: add an advanced/settings path or section that exposes workspace management entry points.
- `src/app/workspaces/page.tsx`: demote this page from primary entry status and update copy for advanced/internal management.
- `src/components/control-plane-shell.tsx`: keep shell behavior aligned with the simplified nav.
- `src/components/__tests__/control-plane-shell.test.tsx`: update nav assertions.
- `src/modules/queries/get-workspaces.ts`: support advanced/settings usage if data-shape tweaks are needed.
- `README.md`: update navigation and entry-flow docs if current copy still implies workspace-first entry.

### New Files To Create

- `src/modules/workspaces/get-default-workspace.ts`: resolve the default workspace for primary product routes and initialize one if necessary.
- `src/modules/workspaces/__tests__/get-default-workspace.bun.test.ts`: verify default resolution and first-workspace initialization behavior.
- `src/app/settings/advanced/page.tsx`: advanced settings surface for workspace management and deeper operational controls.

## Task 1: Define The Single-Workspace Entry Contract

**Files:**
- Create: `src/modules/workspaces/get-default-workspace.ts`
- Create: `src/modules/workspaces/__tests__/get-default-workspace.bun.test.ts`

- [ ] **Step 1: Write the failing default-workspace tests**

Create `src/modules/workspaces/__tests__/get-default-workspace.bun.test.ts` to lock these rules:
- when exactly one workspace exists, it is returned as the default workspace
- when multiple workspaces exist, a deterministic default is still returned
- when no workspace exists, a default workspace is created through the helper instead of returning `null`
- initialization failures surface a typed or explicit error rather than silently returning invalid state

- [ ] **Step 2: Implement deterministic default-workspace resolution**

Create `src/modules/workspaces/get-default-workspace.ts` with a server-safe helper that:
- loads the current workspace set
- returns the existing default candidate when data already exists
- creates a first workspace when the database is empty
- returns a compact object shaped for route-level loading

- [ ] **Step 3: Keep the helper conservative**

Expected implementation properties:
- no new user-facing workspace selection UI
- no schema rewrite just to support this UX change
- no hidden fallback to random workspace choice without deterministic ordering
- explicit failure path if default initialization cannot complete

## Task 2: Rewire Primary Navigation And App Entry

**Files:**
- Modify: `src/modules/ui/navigation.ts`
- Modify: `src/components/control-plane-shell.tsx`
- Modify: `src/components/__tests__/control-plane-shell.test.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Remove `Workspaces` from the top nav**

Update the primary navigation so it renders only:
- `Schedule`
- `Tasks`
- `Inbox`
- `Memory`
- `Settings`

- [ ] **Step 2: Move the root entrypoint away from `/workspaces`**

Update `src/app/page.tsx` so `/` redirects to the primary product surface for the default workspace flow.

Expected behavior:
- users land directly in the product, not on workspace selection
- the root route does not expose internal multi-workspace concepts

- [ ] **Step 3: Update navigation tests**

Adjust shell assertions so tests verify:
- `Workspaces` is absent from the main nav
- the five primary product destinations remain visible
- shell rendering still works across desktop/mobile navigation states if applicable

## Task 3: Bind Top-Level Product Pages To The Default Workspace

**Files:**
- Modify: `src/app/schedule/page.tsx`
- Modify: `src/app/tasks/page.tsx`
- Modify: `src/app/inbox/page.tsx`
- Modify: `src/app/memory/page.tsx`
- Modify: any directly dependent query loaders used by those routes

- [ ] **Step 1: Load the default workspace in each top-level route**

For each of the top-level product routes, call the new default-workspace helper before loading route data.

Expected behavior:
- `/schedule` shows the default workspace schedule
- `/tasks` shows the default workspace task center
- `/inbox` shows the default workspace interruptions
- `/memory` shows the default workspace memory console

- [ ] **Step 2: Preserve existing deeper workspace routes**

Keep routes such as `/workspaces/[workspaceId]/...` intact so the internal model and deep links continue to work.

- [ ] **Step 3: Make failure handling explicit**

If default-workspace resolution fails:
- show a clear product error state or throw a route-level error
- do not fall back to an empty page that looks like valid zero-state data

## Task 4: Demote Workspace Management Into Advanced Settings

**Files:**
- Create: `src/app/settings/advanced/page.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/workspaces/page.tsx`
- Modify: `src/modules/queries/get-workspaces.ts` if needed

- [ ] **Step 1: Add an advanced settings entrypoint**

Extend `Settings` so it remains the runtime/settings page for most users, but also includes a clear deeper entry to `Advanced` for operational controls.

- [ ] **Step 2: Expose workspace management from advanced settings**

Create `src/app/settings/advanced/page.tsx` with copy and links that make `Workspace management` available without promoting it to a primary workflow.

Expected content:
- workspace list or management entry link
- explanation that workspaces are an advanced/internal control, not the main daily workflow
- room for future advanced controls without crowding the main settings page

- [ ] **Step 3: Reposition the `/workspaces` page as advanced/internal**

Update `src/app/workspaces/page.tsx` copy so it no longer reads like the main app landing page.

Expected behavior:
- page remains useful for advanced operations
- primary UX no longer depends on visiting it first

## Task 5: Refresh Docs And Verification Coverage

**Files:**
- Modify: `README.md`
- Modify: any route/component tests affected by nav or default-workspace behavior

- [ ] **Step 1: Add test coverage for the new default flow**

Add or update tests so the suite covers:
- default-workspace resolution
- main-nav removal of `Workspaces`
- top-level route behavior when a default workspace exists
- first-run behavior when the database starts with no workspace

- [ ] **Step 2: Update product docs**

Refresh `README.md` to reflect:
- the new default app entry flow
- the single-workspace UX posture
- the fact that workspace management still exists under advanced/settings

- [ ] **Step 3: Run focused verification**

Run the smallest meaningful verification set covering this change, expected to include:

```bash
bun test src/modules/workspaces/__tests__/get-default-workspace.bun.test.ts && bun run test -- src/components/__tests__/control-plane-shell.test.tsx
```

Then expand to any page-level tests touched by the route changes.

Expected:
- new workspace helper tests pass
- navigation tests pass
- affected page tests pass after top-level route rewiring

## Completion Criteria

- Main navigation no longer exposes `Workspaces`.
- `/` opens the product directly instead of routing users to workspace selection.
- `Schedule / Tasks / Inbox / Memory` all resolve a default workspace automatically.
- The workspace data model and deep routes remain intact.
- Workspace management is still accessible, but only through `Settings -> Advanced` or equivalent deep entry.
- Tests and docs reflect the new single-workspace UX contract.
