# GitNexus Impact

Pre-edit upstream impact checks were run for the UI primitive symbols named in the task plan.

| Symbol | File | Direction | Risk | Direct Callers | Affected Processes | Notes |
|---|---|---|---|---:|---:|---|
| `buttonVariants` | `apps/web/src/components/ui/button.tsx` | upstream | LOW | 0 | 0 | Consumers should not import this internal shadcn helper. |
| `StatusBadge` | `apps/web/src/components/ui/status-badge.tsx` | upstream | LOW | 0 | 0 | Legacy file removed after consumer migration. |
| `SurfaceCard` | `apps/web/src/components/ui/surface-card.tsx` | upstream | LOW | 0 | 0 | Legacy file removed after consumer migration. |
| `Field` | `apps/web/src/components/ui/field.tsx` | upstream | LOW | 0 | 0 | Retained as shadcn Field primitive, not legacy class-helper surface. |

No HIGH or CRITICAL risk reported.
