# Dashboard AI Surfaces Implementation Plan

## Goal

Dashboard AI UI is event-driven, cached, provider-selectable, and safe. Dashboard never blocks initial page load on generation. Data changes mark an AI surface dirty; opening Dashboard may lazily start regeneration when cached input fingerprint is stale.

## Boundaries

- Server truth owns task IDs, statuses, counts, timestamps, actions, links, permissions, and disabled reasons.
- AI interpretation owns brief text, highlights, grouping explanations, and recommended-action reasons.
- React shell owns layout, buttons, badges, links, accessibility, and responsive behavior.
- AI must not generate backend IDs, action hrefs, approval mutations, destructive actions, counts, raw provider payloads, secrets, run tokens, or raw task context.
- First implementation uses structured AI JSON converted by server builders into UI spec. Do not render arbitrary raw provider UI directly.

## Trigger model

Do not generate on every Dashboard load. Do not generate on timer.

Generation flow:

1. Task/output/event facts change.
2. Chrona marks `dashboard.brief` dirty or leaves fingerprint mismatch detectable.
3. User enters Dashboard.
4. Loader returns deterministic dashboard facts plus cached AI surface state.
5. Frontend renders deterministic page immediately.
6. If surface is dirty/stale, no generation is already running, provider exists, and retry cooldown passed, frontend calls generate endpoint in background.
7. Server generates brief, validates result, saves generated spec with input fingerprint.
8. Dashboard revalidates and renders cached brief.

## Dirty/fingerprint rules

Fingerprint input includes only safe facts that can affect brief:

- needs-attention tasks: `taskRef`, title, status, attention kind, reason, latest output ref/title/type, updatedAt
- in-progress tasks: `taskRef`, title, status, latest run status, stage, latest output ref/title/type, updatedAt
- completed tasks: first 20 items with `taskRef`, title, completedAt, category, summary/output ref/title/type
- recent events: first 30 items with event ref/type/category/taskRef/timestamp/title
- totalAutoCompleted

Fingerprint excludes relative time labels, generatedAt, provider result text, and UI-only state.

Regenerate only when current fingerprint differs from saved `inputFingerprint`, manual regenerate is requested, or existing surface is missing.

Failure cooldown prevents repeated provider calls on every visit.

## Storage

Prefer reusable table:

```prisma
model WorkspaceAiSurface {
  id               String   @id @default(cuid())
  workspaceId      String
  surface          String
  status           String   @default("dirty") // dirty | generating | ready | failed
  inputFingerprint String?
  generatedSpec    Json?
  summaryText      String?
  providerClientId String?
  dirtyAt          DateTime?
  generatedAt      DateTime?
  lastAttemptAt    DateTime?
  errorMessage     String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, surface])
  @@index([surface, status])
}
```

`surface` keys:

- `dashboard.brief`
- future: `schedule.brief`, `inbox.brief`, `task.summary`

## Provider model

Use explicit provider resolution, not one global default for everything.

Feature provider keys:

- `dashboard.brief`
- `task.plan`
- `task.execution`

Dashboard provider priority:

```text
AiFeatureBinding("dashboard.brief")
  -> global default AI client
  -> unconfigured
```

Task provider priority:

```text
task.aiClientId
  -> AiFeatureBinding("task.plan" or "task.execution")
  -> global default AI client
  -> unconfigured
```

First implementation adds one task-level `aiClientId`. Do not add node-level overrides yet.

Provider changes:

- Settings can bind `dashboard.brief`, `task.plan`, and `task.execution` to different clients.
- Task creation can optionally choose provider; default means feature/global fallback.
- Running task provider should not be silently switched mid-run.
- Disabled/missing provider should surface as unconfigured/fallback state, not hidden auto-swap.

## API shape

Dashboard loader returns:

```ts
aiBrief: {
  status: "ready" | "dirty" | "generating" | "failed" | "unconfigured";
  spec: ChronaUiSpec | null;
  generatedAt: string | null;
  providerClientId: string | null;
  canGenerate: boolean;
  errorMessage: string | null;
}
```

Generate endpoint:

```http
POST /api/pages/dashboard/ai-brief/generate
```

Input optional:

```ts
{ force?: boolean }
```

Response:

```ts
{ status, generatedAt, errorMessage }
```

No SSE in first version. Generate in background or short request; Dashboard revalidates after completion.

## AI result contract

Provider prompt asks for structured JSON only:

```ts
type DashboardAiBriefResult = {
  title: string;
  summary: string;
  highlights: Array<{
    tone: "success" | "warning" | "danger" | "info";
    label: string;
    detail: string;
    taskRef?: string;
  }>;
  suggestedNextActions: Array<{
    label: string;
    reason: string;
    taskRef?: string;
    actionKind: "open_task" | "review_approval" | "provide_input" | "inspect_failure";
  }>;
};
```

Server validates:

- max item counts
- max string lengths
- taskRef exists in provided safe input
- actionKind compatible with server-known task state

Server builds Chrona UI spec from validated result.

## Implementation phases

### Phase 1 — Provider resolution

- Add feature constants.
- Add `resolveAiClientForFeature(feature)`.
- Add `resolveAiClientForTask(taskId, purpose)`.
- Add task `aiClientId` persistence.
- Extend settings binding list to include Dashboard and task feature keys.

Acceptance:

- Dashboard and task can resolve different clients.
- Missing feature binding falls back to default client.
- Task-level provider wins over feature/global default.

### Phase 2 — Surface cache and fingerprint

- Add `WorkspaceAiSurface` schema/migration.
- Add repository/service helpers to read/upsert surface.
- Add dashboard fingerprint builder.
- Extend `getDashboard()` with `aiBrief` status.
- Mark dirty or detect stale on Dashboard load.

Acceptance:

- Same facts keep same fingerprint.
- New blocked/failed/completed/output/event facts make surface stale.
- Refreshing Dashboard does not regenerate without change.

### Phase 3 — Generation

- Add `generateDashboardBrief(workspaceId, force?)`.
- Use `resolveAiClientForFeature("dashboard.brief")`.
- Build safe prompt input from dashboard facts.
- Validate structured result.
- Build and save UI spec.
- Failed generation preserves previous spec when present.

Acceptance:

- No provider leaves Dashboard usable with `unconfigured` state.
- Provider failure leaves Dashboard usable with failed status.
- Invalid AI result is rejected and not rendered.
- Same fingerprint skips provider call.

### Phase 4 — UI

- Replace/reshape Digest area into `DashboardAiBriefCard`.
- Render cached AI spec if ready.
- Show dirty/generating/failed/unconfigured states.
- Add manual regenerate action.
- Do not block deterministic Dashboard render.

Acceptance:

- Initial Dashboard renders without waiting for provider.
- Brief updates after generation.
- Mobile has no horizontal scroll.
- Existing dashboard facts still visible without AI.

## Deferred

- Timed regeneration.
- SSE generation stream.
- Raw AI-authored layout control.
- Node-level provider overrides.
- Provider cost/model routing.
- Parallel multi-provider generation.
