# Quickstart: Shadcn UI Refactor

## 1. Confirm Feature Context

- Read `specs/011-shadcn-ui-refactor/spec.md`.
- Read `specs/011-shadcn-ui-refactor/plan.md`.
- Read `specs/011-shadcn-ui-refactor/contracts/ui-component-governance.md`.
- Confirm branch is `011-shadcn-ui-refactor`.

## 2. Capture Pre-Edit Browser Evidence

Use before editing UI.

Required viewports:

- Desktop `1440x900`
- Tablet `1024x768`
- Mobile `390x844`

Capture affected screens that currently use custom primitives, especially schedule, settings, task/work, inbox, memory, and assistant surfaces if their imports are touched.

Record light and dark mode evidence when dark mode is available.

## 3. Build UI Inventory

Inventory should identify removed legacy foundation surfaces from migration evidence and confirm active source uses shadcn primitives:

- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/field.tsx`
- Active imports of shadcn `Button`, `Badge`, `Card`, `Field`, `Input`, `Textarea`, `Select`, and `Label`
- Zero active consumers of removed legacy status/surface imports, consumer `buttonVariants`, and field class helpers
- Any page-local generic button, badge, card, field, input, textarea, select, dialog, dropdown, tabs, tooltip, separator, skeleton, or alert implementation

Classify each item as:

- `shared-foundation`
- `chrona-wrapper`
- `page-composition`
- `remove`

## 4. Replace Duplicate Primitives

- Introduce or generate missing standard shadcn primitives needed for button, badge, card, input, textarea, select, label, and field/form composition.
- Replace page imports with shared primitives or approved domain wrappers.
- Convert Chrona-specific status/surface wrappers to thin compositions only when domain meaning remains.
- Delete duplicate legacy files, exports, and compatibility aliases.
- Keep backend APIs unchanged.

## 5. Add Guardrails

- Update AI/contributor guidance to make shadcn primitives the default foundation.
- Add a repeatable check or documented review step that flags new duplicate foundational primitives.
- Ensure the check covers button, badge, card, and field/input/select/textarea patterns.

## 6. Verify

Run required commands:

```bash
bun run typecheck
bun run lint
bun run test
```

Run when task, schedule, or navigation flows are affected:

```bash
bun run test:e2e
```

Use after edits for:

- Desktop `1440x900`
- Tablet `1024x768`
- Mobile `390x844`
- No mobile horizontal scrolling
- Current task, active node, blocked/review state, and primary action visibility where applicable
- Loading, empty, success, and error states touched by the migration

## 7. Acceptance Checklist

- Removed duplicate primitives have zero active imports.
- Remaining wrappers have documented Chrona product purpose.
- Dark mode has no contrast, border, focus-ring, or muted-background regressions.
- Existing flows require no additional user steps.
- Automated checks pass or exceptions are explicitly documented and approved.
