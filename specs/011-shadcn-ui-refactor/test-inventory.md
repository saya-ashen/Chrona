# Test Inventory: Shadcn UI Refactor

## Mock Updates

| Test Area | Files | Result |
|---|---|---|
| Shell, inbox, memory | `control-plane-shell.test.tsx`, `inbox-list.test.tsx`, `memory-console.test.tsx` | No mocks import removed `status-badge`, `surface-card`, or field class helpers. Existing assertions cover navigation simplification, inbox action risk/task/run details, and memory source/status/task links. |
| Schedule | `conflict-card.test.tsx`, `preparation-checklist.test.tsx`, `schedule-action-rail.test.tsx`, `schedule-editor-form.test.tsx`, `schedule-task-list.test.tsx`, `selected-block-sheet.test.tsx`, `schedule-mini-calendar.test.tsx` | Mocks target shadcn `Badge`, `Card`, `Button`, and form primitives. Schedule assertions cover conflict severity variants, tab behavior, task filters/counts, selected block layout, labels, and calendar behavior. |
| Work | `task-plan-side-panel.test.tsx`, `work-inspector.test.tsx` | Tests assert graph-native current node, waiting/checkpoint/child-task groupings, and active plan tab content without legacy UI mocks. |

## Added Coverage

- `apps/web/src/components/ui/__tests__/shadcn-primitives.test.tsx` verifies `Button`, `Badge`, `Card`, `Input`, `Textarea`, `Select`, `Label`, and `Field` exports render expected shadcn slots.
- `apps/web/src/test/ui-foundation-guard.test.ts` verifies duplicate primitive guard patterns reject removed imports/symbols and allow official internal `buttonVariants` only in generated button source.

## Removed Legacy Names

- Active tests do not import `@/components/ui/status-badge`.
- Active tests do not import `@/components/ui/surface-card`.
- Active tests do not import legacy `inputClassName`, `textareaClassName`, or `selectClassName` helpers.
