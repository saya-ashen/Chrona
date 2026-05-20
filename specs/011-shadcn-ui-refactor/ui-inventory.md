# UI Inventory: Shadcn UI Refactor

## Scope

- Branch: `011-shadcn-ui-refactor`
- Frontend only: `apps/web/`
- Backend APIs unchanged.
- Target foundation: shadcn/ui primitives under `apps/web/src/components/ui`.

## Canonical Primitive Targets

| UI Need | Canonical Target | Notes |
|---|---|---|
| Button/action | `Button` from `@/components/ui/button` | Official shadcn source retains internal `buttonVariants`; consumers must not import or call it. |
| Status/chip | `Badge` from `@/components/ui/badge` | Replaces generic `StatusBadge`. Product-specific status mapping stays local to feature components. |
| Surface/card | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` from `@/components/ui/card` | Replaces generic `SurfaceCard` wrappers. |
| Text input | `Input` from `@/components/ui/input` | Replaces reusable input class helpers. |
| Multiline input | `Textarea` from `@/components/ui/textarea` | Replaces reusable textarea class helpers. |
| Select | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem` from `@/components/ui/select` | Items stay inside `SelectGroup`. |
| Label | `Label` from `@/components/ui/label` | Used directly or by field composition. |
| Field composition | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet` from `@/components/ui/field` | This file is the generated shadcn field primitive, not the removed legacy class-helper file. |

## Legacy Inventory And Classification

| Item | Prior Role | Classification | Replacement |
|---|---|---|---|
| `buttonVariants` consumer imports | Shared button styling helper | `remove` | Consumers render `Button`; only generated `button.tsx` may contain internal `buttonVariants`. |
| `StatusBadge` | Generic status badge wrapper | `remove` | `Badge` plus local status-to-variant mapping. |
| `SurfaceCard` and related exports | Generic card/surface wrapper | `remove` | shadcn `Card` composition or page-local markup where product layout is unique. |
| `inputClassName` | Reusable input class helper | `remove` | `Input` component. |
| `textareaClassName` | Reusable textarea class helper | `remove` | `Textarea` component. |
| `selectClassName` | Reusable select class helper | `remove` | `Select` composition. |
| `Field`, `FieldLabel`, `FieldDescription` | Legacy file name also used for forms | `shared-foundation` | Replaced with shadcn Field primitive exports; no class helper compatibility aliases retained. |

## Migrated Consumer Areas

| Area | Classification | Replacement Result |
|---|---|---|
| Shell/access-key/locale/inbox/memory | `page-composition` | Imports use `Button`, `Badge`, `Card`, and direct composition. |
| Schedule dialogs/forms/panels/timeline/page | `page-composition` | Form controls use shadcn input/select/textarea/field primitives; status chips use `Badge`. |
| Tasks AI/panels/graph/workspace/list | `page-composition` | Work surfaces use shadcn primitives and local semantic status mapping. |
| Work page/inspector/result | `page-composition` | Result and inspector surfaces use `Badge`, `Button`, `Card`, and field primitives. |

## Remaining Chrona-Specific Wrappers

- No generic reusable `StatusBadge`, `SurfaceCard`, or field class helper remains.
- Remaining product-specific components are feature components, not UI foundation wrappers. Examples: schedule conflict cards, task workspace node detail panels, work inspector sections. They encode Chrona domain meaning such as current node state, blocked/review status, schedule conflict severity, and task execution evidence.
- Wrapper decision order for future work: use generated shadcn primitive, compose it in the feature component, then create a product-named wrapper only when it carries Chrona domain meaning.
