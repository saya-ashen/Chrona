# Lint

Command: `bun run lint`

Result: failed on existing repository lint debt.

Summary:

```text
715 problems (1 error, 714 warnings)
```

Blocking error:

```text
packages/contracts/src/ai-feature-types.ts
52:18  error  An empty interface declaration allows any non-nullish value, including literals like `0` and `""`.
```

The error is outside the activity-feed implementation files. Warnings are broad pre-existing complexity/max-lines/style findings across the repository.
