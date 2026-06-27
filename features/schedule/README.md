# Schedule

Owns Chrona schedule page, task/work-block schedule routes, schedule API schemas, and schedule UI tests.

Entry points:
- `features/schedule/index.ts` public feature surface
- `features/schedule/contract.ts` schedule schema re-exports
- `features/schedule/routes/page.routes.ts` GET /api/schedule route
- `features/schedule/routes/task.routes.ts` task/work-block schedule mutation routes
- `features/schedule/ui/schedule-page.tsx` schedule page
- `features/schedule/ui/schedule-page-actions.ts` schedule page client actions

Feature test command:

```bash
bun run test:feature schedule
```

Keep external calendar blocks imported from `features/external-calendar`.
