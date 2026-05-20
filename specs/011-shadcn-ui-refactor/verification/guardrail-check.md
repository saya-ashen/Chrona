# UI Foundation Guardrail Check

Command:

```bash
bun run check:ui-foundation
```

Result will be updated by final validation. Expected pass condition: no active consumers of removed imports, generic status/surface wrappers, consumer `buttonVariants`, or reusable field class helpers.
