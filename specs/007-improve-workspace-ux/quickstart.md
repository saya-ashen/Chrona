# Quickstart: Improve Workspace UX

## 1. Start Local App

Run from repo root:

```bash
bun run dev
```

Open:

```text
http://localhost:3100
```

Representative planning route:

```text
http://localhost:3100/en/workspaces/cmp72s4oy0007hgfu74srky2u/tasks/cmp72tzoq00008hfurndtr5q9
```

If local seed data changes, navigate from `Tasks` to any task workspace with visible task controls and plan/workspace regions, then document the route used.

## 2. Pre-Edit Browser Evidence

Capture with :

```bash
```

Pre-edit screenshots already captured during planning:

- `specs/007-improve-workspace-ux/pre-desktop-1440x900.png`
- `specs/007-improve-workspace-ux/pre-tablet-1024x768.png`
- `specs/007-improve-workspace-ux/pre-mobile-390x844.png`

## 3. Implement

Expected edit areas:

- `apps/web/src/components/tasks/workspace/page/`
- `apps/web/src/components/tasks/workspace/sections/`
- `apps/web/src/components/tasks/workspace/execution/`
- `apps/web/src/components/tasks/workspace/model/` only for presentation view-model additions
- `apps/web/src/components/tasks/plan/task-plan-graph/` for node state clarity
- `apps/web/src/i18n/messages/en.json`
- `apps/web/src/i18n/messages/zh.json`

Implementation rules:

- Preserve backend APIs and shared contracts.
- Do not change `packages/runtime/domain` for visual polish.
- Preserve task creation, plan generation, acceptance, execution, assistant interaction, schedule, and navigation behavior.
- Keep user-facing copy in i18n message files.
- Keep business rules out of React components.
- Use CSS/layout/component refactors before behavioral changes.

## 4. Automated Checks

Run before completion:

```bash
bun run typecheck
bun run lint
bun run test
```

Run when task navigation or workflow interactions are changed:

```bash
bun run test:e2e
```

## 5. Post-Edit Browser Verification

Repeat on the same representative route:

```bash
```

Also verify at `390x844`:

- No horizontal page scroll.
- Primary action remains easy to find.
- Long task/node/status text wraps or truncates safely.
- Blocked/review/completed states are visually distinguishable where representative data is available.

## 6. Completion Criteria

- Current task, task state, active node, and primary action are identifiable quickly on desktop, tablet, and mobile.
- Loading, empty, error, blocked, review-required, completed, running, and idle states have distinct labels/treatment/guidance.
- Existing task workflow behavior is preserved.
- Browser diagnostics show no new console errors or broken network requests.
- Required automated commands pass or documented exceptions are approved.
