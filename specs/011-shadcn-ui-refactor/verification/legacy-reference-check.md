# Legacy Reference Check

Command shape:

```bash
rg -n "from (?:'|\")(@/components/ui/(status-badge|surface-card)|.*components/ui/(status-badge|surface-card))|StatusBadge|SurfaceCard|inputClassName|textareaClassName|selectClassName|buttonVariants" apps/web/src
```

## Result

- No active source imports `@/components/ui/status-badge`.
- No active source imports `@/components/ui/surface-card`.
- No active source references `StatusBadge` or `SurfaceCard`.
- No active source references `inputClassName`, `textareaClassName`, or `selectClassName`.
- `buttonVariants` remains only inside generated `apps/web/src/components/ui/button.tsx` and guard tests that enforce no consumer usage.
- `@/components/ui/field` remains active because it is now the shadcn Field primitive, not the removed legacy class-helper implementation.
