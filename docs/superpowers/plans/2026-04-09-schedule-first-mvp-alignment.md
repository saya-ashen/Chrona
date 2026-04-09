# Schedule-First MVP Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing prototype into the approved schedule-first MVP by formalizing schedule state, adding the top-level `Schedule` surface, and tightening `Schedule / Task Page / Work Page` responsibilities without rewriting the current OpenClaw integration.

**Architecture:** Keep the existing `Next.js + Prisma + SQLite` application and current canonical object model, then extend it with schedule-specific state (`ScheduleStatus`, `ScheduleSource`, `ScheduleProposal`) that flows through the same command -> event -> projection path as the rest of the control plane. `Schedule` becomes the global planning surface, `Task Page` remains the single-task planning surface, and `Work Page` continues as the execution surface that reflects schedule risk rather than owning schedule writes.

**Tech Stack:** `Next.js` App Router, `React 19`, `TypeScript`, `Bun`, `Prisma`, `SQLite`, `shadcn/ui`, `bun:test`, `Vitest`, `Testing Library`, `Playwright`

---

## Scope Notes

- This plan supersedes `docs/superpowers/plans/2026-04-08-task-centric-ai-control-plane-mvp.md` for implementation sequencing.
- Do not rewrite the existing prototype from scratch. Extend the current repo state.
- Keep the route-B hard constraint intact: if the product starts collapsing into admin-first or chat-first behavior, stop and correct the implementation rather than continuing.
- Treat the existing OpenClaw feasibility probe as a gate that must still pass before any schedule work is considered valid.
- UI/reference sketches:
  - `docs/superpowers/sketches/2026-04-09-schedule-page-wireframe.md`
  - `docs/superpowers/sketches/2026-04-09-schedule-timeline-hybrid-wireframe.md`

## File Structure

### Existing Files To Modify

- `prisma/schema.prisma`: add schedule enums, proposal persistence, and projection fields.
- `prisma/seed.ts`: seed scheduled, unscheduled, overdue-risk, and AI-proposed tasks so the new page has realistic data.
- `src/modules/projections/rebuild-task-projection.ts`: derive and persist schedule state alongside block state.
- `src/modules/tasks/derive-task-state.ts`: keep execution/block semantics focused on run state; only touch if type alignment is needed.
- `src/app/actions/task-actions.ts`: expose schedule commands and revalidate `/schedule` plus affected task/work surfaces.
- `src/modules/ui/navigation.ts`: promote `Schedule` into top-level nav.
- `src/modules/queries/get-task-page.ts`: include schedule status/source/proposal context.
- `src/modules/queries/get-work-page.ts`: surface schedule state and timing context on the execution page.
- `src/modules/queries/get-task-center.ts`: add schedule-aware filters and columns.
- `src/modules/queries/get-workspace-overview.ts`: add schedule-risk slices to the workspace triage page.
- `src/app/tasks/page.tsx`: expose `Unscheduled` and `Overdue` filters.
- `src/app/workspaces/[workspaceId]/page.tsx`: update copy so overview clearly references schedule risk.
- `src/components/control-plane-shell.tsx`: render the new nav item.
- `src/components/tasks/task-page.tsx`: add schedule context, inline scheduling controls, and `Open Schedule` CTA.
- `src/components/work/work-page-client.tsx`: show schedule status and a planning CTA without letting the page own scheduling writes.
- `src/components/tasks/task-center-table.tsx`: display schedule state.
- `src/components/workspaces/workspace-overview.tsx`: render schedule-risk sections.
- `src/components/__tests__/control-plane-shell.test.tsx`: update nav assertions.
- `src/components/tasks/__tests__/task-page.test.tsx`: cover schedule controls and page semantics.
- `src/components/work/__tests__/work-page.test.tsx`: cover schedule context on the work surface.
- `src/components/workspaces/__tests__/workspace-overview.test.tsx`: cover schedule-risk cards.
- `src/modules/projections/__tests__/projection-read-model.bun.test.ts`: assert schedule status propagation.
- `src/modules/db/__tests__/schema-smoke.test.ts`: assert schedule proposal persistence.
- `README.md`: replace the stock Next.js template text with real product and workflow docs.
- `e2e/control-plane.spec.ts`: keep the existing task -> work journey aligned with the new nav and copy.

### New Files To Create

- `src/modules/tasks/derive-schedule-state.ts`: derive `Unscheduled / Scheduled / InProgress / AtRisk / Interrupted / Overdue / Completed` from task + run facts.
- `src/modules/tasks/__tests__/derive-schedule-state.test.ts`: lock schedule derivation rules.
- `src/modules/commands/apply-schedule.ts`: human-authored schedule writes.
- `src/modules/commands/clear-schedule.ts`: clear a task schedule and emit canonical events.
- `src/modules/commands/propose-schedule.ts`: create pending AI schedule proposals.
- `src/modules/commands/decide-schedule-proposal.ts`: accept or reject a proposal through the domain layer.
- `src/modules/commands/__tests__/schedule-commands.bun.test.ts`: verify command -> event -> projection behavior.
- `src/modules/queries/get-schedule-page.ts`: assemble the global planning read model.
- `src/modules/queries/__tests__/get-schedule-page.bun.test.ts`: verify schedule page grouping and proposal/risk buckets.
- `src/app/schedule/page.tsx`: top-level schedule route.
- `src/components/schedule/schedule-page.tsx`: render scheduled blocks, unscheduled queue, AI proposals, and conflicts.
- `src/components/schedule/schedule-editor-form.tsx`: shared server-form schedule editor used by Schedule and Task pages.
- `src/components/schedule/__tests__/schedule-page.test.tsx`: verify top-level schedule UI semantics.
- `e2e/schedule.spec.ts`: browser-level schedule workflow coverage.

### Generated Files

- `src/generated/prisma/**`: regenerated after schema changes. Do not hand-edit.

## Task 1: Refresh The OpenClaw Gate And Freeze A Baseline

**Files:**
- Modify: `docs/research/2026-04-08-openclaw-feasibility.md` (only if the probe output changes)

- [ ] **Step 1: Re-run the live OpenClaw feasibility probe**

Run:

```bash
OPENCLAW_MODE=live bun run probe:openclaw
```

Expected:
- process exits with code `0`
- `docs/research/2026-04-08-openclaw-feasibility.md` exists
- the report still includes all four checks

- [ ] **Step 2: Verify the gate report still passes all four mandatory checks**

Open `docs/research/2026-04-08-openclaw-feasibility.md` and verify it still contains these lines:

```md
# OpenClaw Feasibility Gate

Overall: PASS

- create_run: PASS
- query_status: PASS
- read_outputs: PASS
- resume_after_wait: PASS
```

If any line is `FAIL`, stop here and do not continue to Tasks 2-6.

- [ ] **Step 3: Run the current baseline tests before touching schedule code**

Run:

```bash
bun test src/modules/projections/__tests__/projection-read-model.bun.test.ts src/modules/commands/__tests__/command-chain.bun.test.ts && bun run test -- src/components/__tests__/control-plane-shell.test.tsx src/components/tasks/__tests__/task-page.test.tsx src/components/work/__tests__/work-page.test.tsx
```

Expected:
- bun test suite passes
- vitest component suite passes
- baseline failures are resolved before schedule work starts

- [ ] **Step 4: Commit the refreshed gate evidence if the report changed**

Run:

```bash
git diff --quiet -- docs/research/2026-04-08-openclaw-feasibility.md || (git add docs/research/2026-04-08-openclaw-feasibility.md && git commit -m "docs: refresh openclaw feasibility gate")
```

Expected:
- if the report changed, the evidence commit is created
- if `git diff` shows no changes, skip the commit and continue

## Task 2: Add Schedule State To The Schema And Projection Layer

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`
- Modify: `src/modules/projections/rebuild-task-projection.ts`
- Modify: `src/modules/projections/__tests__/projection-read-model.bun.test.ts`
- Modify: `src/modules/db/__tests__/schema-smoke.test.ts`
- Create: `src/modules/tasks/derive-schedule-state.ts`
- Create: `src/modules/tasks/__tests__/derive-schedule-state.test.ts`
- Regenerate: `src/generated/prisma/**`

- [ ] **Step 1: Write the failing schedule-derivation test**

Create `src/modules/tasks/__tests__/derive-schedule-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { deriveScheduleState } from "@/modules/tasks/derive-schedule-state";

const now = new Date("2026-04-09T12:00:00.000Z");

describe("deriveScheduleState", () => {
  it("marks tasks without any planning data as Unscheduled", () => {
    expect(
      deriveScheduleState({
        task: {
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          scheduleSource: null,
        },
        latestRun: null,
        now,
      }),
    ).toEqual({
      scheduleStatus: "Unscheduled",
      scheduleSummary: "Needs scheduling",
    });
  });

  it("marks blocked active work as AtRisk", () => {
    expect(
      deriveScheduleState({
        task: {
          dueAt: new Date("2026-04-10T18:00:00.000Z"),
          scheduledStartAt: new Date("2026-04-09T09:00:00.000Z"),
          scheduledEndAt: new Date("2026-04-09T15:00:00.000Z"),
          scheduleSource: "human",
        },
        latestRun: {
          status: "WaitingForApproval",
          startedAt: new Date("2026-04-09T09:30:00.000Z"),
          endedAt: null,
        },
        now,
      }),
    ).toEqual({
      scheduleStatus: "AtRisk",
      scheduleSummary: "Execution is blocked and threatens the plan",
    });
  });

  it("marks unfinished work as Overdue after the scheduled end", () => {
    expect(
      deriveScheduleState({
        task: {
          dueAt: new Date("2026-04-09T17:00:00.000Z"),
          scheduledStartAt: new Date("2026-04-09T08:00:00.000Z"),
          scheduledEndAt: new Date("2026-04-09T10:00:00.000Z"),
          scheduleSource: "ai",
        },
        latestRun: {
          status: "Running",
          startedAt: new Date("2026-04-09T08:15:00.000Z"),
          endedAt: null,
        },
        now,
      }),
    ).toEqual({
      scheduleStatus: "Overdue",
      scheduleSummary: "Execution has exceeded the planned window",
    });
  });
});
```

- [ ] **Step 2: Run the new test to confirm the missing module failure**

Run:

```bash
bun test src/modules/tasks/__tests__/derive-schedule-state.test.ts
```

Expected: fail with `Cannot find module '@/modules/tasks/derive-schedule-state'`

- [ ] **Step 3: Extend the Prisma schema for schedule state and AI proposals**

Update `prisma/schema.prisma` with these additions:

```prisma
enum ScheduleStatus {
  Unscheduled
  Scheduled
  InProgress
  AtRisk
  Interrupted
  Overdue
  Completed
}

enum ScheduleSource {
  human
  ai
  system
}

enum ScheduleProposalStatus {
  Pending
  Accepted
  Rejected
}

model Task {
  id               String          @id @default(cuid())
  workspaceId      String
  title            String
  description      String?
  status           TaskStatus
  priority         TaskPriority
  ownerType        OwnerType
  assigneeAgentId  String?
  sourceSessionId  String?
  parentTaskId     String?
  dueAt            DateTime?
  scheduledStartAt DateTime?
  scheduledEndAt   DateTime?
  scheduleStatus   ScheduleStatus  @default(Unscheduled)
  scheduleSource   ScheduleSource?
  budgetLimit      Int?
  blockReason      Json?
  latestRunId      String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  completedAt      DateTime?
  workspace        Workspace       @relation(fields: [workspaceId], references: [id])
  runs             Run[]
  approvals        Approval[]
  artifacts        Artifact[]
  memories         Memory[]
  events           Event[]
  projection       TaskProjection?
  dependencies     TaskDependency[] @relation("TaskDependencies")
  dependentTasks   TaskDependency[] @relation("TaskDependents")
  scheduleProposals ScheduleProposal[]

  @@index([workspaceId, scheduleStatus])
}

model TaskProjection {
  taskId               String    @id
  workspaceId          String
  persistedStatus      String
  displayState         String?
  blockType            String?
  blockScope           String?
  blockSince           DateTime?
  actionRequired       String?
  latestRunStatus      String?
  approvalPendingCount Int       @default(0)
  dueAt                DateTime?
  scheduledStartAt     DateTime?
  scheduledEndAt       DateTime?
  scheduleStatus       String?
  scheduleSource       String?
  scheduleProposalCount Int      @default(0)
  latestArtifactTitle  String?
  lastActivityAt       DateTime?
  updatedAt            DateTime  @updatedAt
  workspace            Workspace @relation(fields: [workspaceId], references: [id])
  task                 Task      @relation(fields: [taskId], references: [id])
}

model ScheduleProposal {
  id               String                 @id @default(cuid())
  workspaceId      String
  taskId           String
  source           ScheduleSource
  status           ScheduleProposalStatus @default(Pending)
  proposedBy       String
  summary          String
  dueAt            DateTime?
  scheduledStartAt DateTime?
  scheduledEndAt   DateTime?
  assigneeAgentId  String?
  createdAt        DateTime               @default(now())
  resolvedAt       DateTime?
  resolutionNote   String?
  workspace        Workspace              @relation(fields: [workspaceId], references: [id])
  task             Task                   @relation(fields: [taskId], references: [id])

  @@index([workspaceId, status])
  @@index([taskId, status])
}
```

- [ ] **Step 4: Implement schedule derivation and persist it into `TaskProjection`**

Create `src/modules/tasks/derive-schedule-state.ts`:

```ts
type DeriveScheduleStateInput = {
  task: {
    dueAt: Date | null;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    scheduleSource: string | null;
  };
  latestRun:
    | {
        status: string;
        startedAt: Date | null;
        endedAt: Date | null;
      }
    | null;
  now: Date;
};

type DeriveScheduleStateResult = {
  scheduleStatus:
    | "Unscheduled"
    | "Scheduled"
    | "InProgress"
    | "AtRisk"
    | "Interrupted"
    | "Overdue"
    | "Completed";
  scheduleSummary: string;
};

export function deriveScheduleState(
  input: DeriveScheduleStateInput,
): DeriveScheduleStateResult {
  const { dueAt, scheduledStartAt, scheduledEndAt } = input.task;
  const latestRun = input.latestRun;
  const hasAnySchedule = Boolean(dueAt || scheduledStartAt || scheduledEndAt);

  if (!hasAnySchedule) {
    return {
      scheduleStatus: "Unscheduled",
      scheduleSummary: "Needs scheduling",
    };
  }

  if (latestRun?.status === "Completed") {
    return {
      scheduleStatus: "Completed",
      scheduleSummary: "Execution finished",
    };
  }

  if ((scheduledEndAt && input.now > scheduledEndAt) || (dueAt && input.now > dueAt)) {
    if (latestRun?.status !== "Completed") {
      return {
        scheduleStatus: "Overdue",
        scheduleSummary: "Execution has exceeded the planned window",
      };
    }
  }

  if (latestRun?.status === "Failed") {
    return {
      scheduleStatus: "Interrupted",
      scheduleSummary: "Execution failed and requires recovery",
    };
  }

  if (
    latestRun?.status === "WaitingForApproval" ||
    latestRun?.status === "WaitingForInput"
  ) {
    return {
      scheduleStatus: "AtRisk",
      scheduleSummary: "Execution is blocked and threatens the plan",
    };
  }

  if (latestRun?.status === "Running" || latestRun?.status === "Pending") {
    return {
      scheduleStatus: "InProgress",
      scheduleSummary: "Execution is active against the current plan",
    };
  }

  return {
    scheduleStatus: "Scheduled",
    scheduleSummary: "Scheduled but not yet in progress",
  };
}
```

Update `src/modules/projections/rebuild-task-projection.ts` so it loads pending proposals and writes the derived schedule state:

```ts
import { deriveScheduleState } from "@/modules/tasks/derive-schedule-state";

const task = await db.task.findUniqueOrThrow({
  where: { id: taskId },
  include: {
    runs: { orderBy: { updatedAt: "desc" } },
    approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
    artifacts: { orderBy: { createdAt: "desc" }, take: 1 },
    scheduleProposals: { where: { status: "Pending" } },
  },
});

const latestRun = task.runs[0] ?? null;
const schedule = deriveScheduleState({
  task: {
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleSource: task.scheduleSource,
  },
  latestRun,
  now: new Date(),
});

await db.task.update({
  where: { id: task.id },
  data: {
    status: derived.persistedStatus as never,
    scheduleStatus: schedule.scheduleStatus as never,
    blockReason: derived.blockReason ? (derived.blockReason as Prisma.InputJsonValue) : Prisma.DbNull,
  },
});

return db.taskProjection.upsert({
  where: { taskId: task.id },
  update: {
    workspaceId: task.workspaceId,
    persistedStatus: derived.persistedStatus,
    displayState: derived.displayState,
    blockType: derived.blockReason?.blockType ?? null,
    blockScope: derived.blockReason?.scope ?? null,
    blockSince: derived.blockSince,
    actionRequired: derived.blockReason?.actionRequired ?? null,
    latestRunStatus: latestRun?.status ?? null,
    approvalPendingCount: task.approvals.length,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleStatus: schedule.scheduleStatus,
    scheduleSource: task.scheduleSource,
    scheduleProposalCount: task.scheduleProposals.length,
    latestArtifactTitle: task.artifacts[0]?.title ?? null,
    lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
  },
  create: {
    taskId: task.id,
    workspaceId: task.workspaceId,
    persistedStatus: derived.persistedStatus,
    displayState: derived.displayState,
    blockType: derived.blockReason?.blockType ?? null,
    blockScope: derived.blockReason?.scope ?? null,
    blockSince: derived.blockSince,
    actionRequired: derived.blockReason?.actionRequired ?? null,
    latestRunStatus: latestRun?.status ?? null,
    approvalPendingCount: task.approvals.length,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleStatus: schedule.scheduleStatus,
    scheduleSource: task.scheduleSource,
    scheduleProposalCount: task.scheduleProposals.length,
    latestArtifactTitle: task.artifacts[0]?.title ?? null,
    lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
  },
});
```

- [ ] **Step 5: Extend schema smoke and projection tests for schedule data**

Update `src/modules/db/__tests__/schema-smoke.test.ts` so the test stores schedule fields and a proposal:

```ts
const task = await prisma.task.create({
  data: {
    workspaceId: workspace.id,
    title: "Draft adapter sync",
    status: TaskStatus.Ready,
    priority: TaskPriority.High,
    ownerType: "human",
    dueAt: new Date("2026-04-10T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-10T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-10T11:00:00.000Z"),
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
  },
});

await prisma.scheduleProposal.create({
  data: {
    workspaceId: workspace.id,
    taskId: task.id,
    source: "ai",
    status: "Pending",
    proposedBy: "planner-agent",
    summary: "Move the task to tomorrow morning",
    dueAt: new Date("2026-04-10T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-10T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-10T11:00:00.000Z"),
  },
});
```

Update `src/modules/projections/__tests__/projection-read-model.bun.test.ts` with these assertions after `rebuildTaskProjection(task.id)`:

```ts
expect(storedTask?.scheduleStatus).toBe("AtRisk");
expect(storedTask?.projection?.scheduleStatus).toBe("AtRisk");
expect(storedTask?.projection?.scheduleProposalCount).toBe(1);
```

- [ ] **Step 6: Run the migration, regenerate Prisma, reseed, and execute the schedule-core tests**

Run:

```bash
bunx prisma migrate dev --name schedule-core
bunx prisma generate
bun run db:seed
bun test src/modules/tasks/__tests__/derive-schedule-state.test.ts src/modules/projections/__tests__/projection-read-model.bun.test.ts src/modules/db/__tests__/schema-smoke.test.ts
```

Expected:
- Prisma migration applies cleanly
- generated client updates under `src/generated/prisma/**`
- seed runs successfully
- all three tests pass

- [ ] **Step 7: Commit the schema and projection changes**

Run:

```bash
git add prisma/schema.prisma prisma/seed.ts src/modules/tasks/derive-schedule-state.ts src/modules/tasks/__tests__/derive-schedule-state.test.ts src/modules/projections/rebuild-task-projection.ts src/modules/projections/__tests__/projection-read-model.bun.test.ts src/modules/db/__tests__/schema-smoke.test.ts src/generated/prisma
git commit -m "feat: add schedule state to control plane projections"
```

Expected: schedule-core schema/projection commit created successfully

## Task 3: Add Domain Commands For Schedule Writes And Proposals

**Files:**
- Create: `src/modules/commands/apply-schedule.ts`
- Create: `src/modules/commands/clear-schedule.ts`
- Create: `src/modules/commands/propose-schedule.ts`
- Create: `src/modules/commands/decide-schedule-proposal.ts`
- Create: `src/modules/commands/__tests__/schedule-commands.bun.test.ts`
- Modify: `src/app/actions/task-actions.ts`

- [ ] **Step 1: Write the failing command-chain test for schedule changes**

Create `src/modules/commands/__tests__/schedule-commands.bun.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { applySchedule } from "@/modules/commands/apply-schedule";
import { decideScheduleProposal } from "@/modules/commands/decide-schedule-proposal";
import { proposeSchedule } from "@/modules/commands/propose-schedule";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("schedule commands", () => {
  beforeEach(resetDb);

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("applies human schedules and accepts AI schedule proposals through canonical events", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Schedule Commands", status: "Active", defaultRuntime: "openclaw" },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Plan the release",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    await applySchedule({
      taskId: task.id,
      dueAt: new Date("2026-04-12T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-12T11:00:00.000Z"),
      source: "human",
      actorId: "user:saya",
    });

    const proposal = await proposeSchedule({
      taskId: task.id,
      dueAt: new Date("2026-04-13T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-13T13:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-13T15:00:00.000Z"),
      source: "ai",
      proposedBy: "planner-agent",
      summary: "Move after dependency review",
    });

    await decideScheduleProposal({
      proposalId: proposal.proposalId,
      decision: "Accepted",
      actorId: "user:saya",
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true, scheduleProposals: true },
    });
    const events = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
    });

    expect(storedTask.scheduleStatus).toBe("Scheduled");
    expect(storedTask.scheduleSource).toBe("ai");
    expect(storedTask.projection?.scheduleStatus).toBe("Scheduled");
    expect(storedTask.scheduleProposals[0]?.status).toBe("Accepted");
    expect(events.map((event) => event.eventType)).toEqual([
      "task.schedule_changed",
      "task.schedule_proposed",
      "task.schedule_changed",
    ]);
  });
});
```

- [ ] **Step 2: Run the schedule-command test to confirm the missing exports fail first**

Run:

```bash
bun test src/modules/commands/__tests__/schedule-commands.bun.test.ts
```

Expected: fail because the new command modules do not exist yet

- [ ] **Step 3: Implement the schedule command files**

Create `src/modules/commands/apply-schedule.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function applySchedule(input: {
  taskId: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  source: "human" | "ai" | "system";
  actorId: string;
}) {
  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduleStatus: "Scheduled",
      scheduleSource: input.source,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.schedule_changed",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: input.source === "human" ? "user" : "agent",
    actorId: input.actorId,
    source: "ui",
    payload: {
      due_at: input.dueAt?.toISOString() ?? null,
      scheduled_start_at: input.scheduledStartAt?.toISOString() ?? null,
      scheduled_end_at: input.scheduledEndAt?.toISOString() ?? null,
      schedule_source: input.source,
    },
    dedupeKey: `task.schedule_changed:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return { taskId: task.id, workspaceId: task.workspaceId };
}
```

Create `src/modules/commands/clear-schedule.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function clearSchedule(input: { taskId: string; actorId: string }) {
  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.unscheduled",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: input.actorId,
    source: "ui",
    payload: {},
    dedupeKey: `task.unscheduled:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return { taskId: task.id, workspaceId: task.workspaceId };
}
```

Create `src/modules/commands/propose-schedule.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function proposeSchedule(input: {
  taskId: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  source: "ai" | "system";
  proposedBy: string;
  summary: string;
}) {
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });

  const proposal = await db.scheduleProposal.create({
    data: {
      workspaceId: task.workspaceId,
      taskId: task.id,
      source: input.source,
      proposedBy: input.proposedBy,
      summary: input.summary,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.schedule_proposed",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "agent",
    actorId: input.proposedBy,
    source: "domain",
    payload: {
      proposal_id: proposal.id,
      summary: proposal.summary,
      due_at: proposal.dueAt?.toISOString() ?? null,
      scheduled_start_at: proposal.scheduledStartAt?.toISOString() ?? null,
      scheduled_end_at: proposal.scheduledEndAt?.toISOString() ?? null,
    },
    dedupeKey: `task.schedule_proposed:${proposal.id}`,
  });

  await rebuildTaskProjection(task.id);

  return { proposalId: proposal.id, taskId: task.id, workspaceId: task.workspaceId };
}
```

Create `src/modules/commands/decide-schedule-proposal.ts`:

```ts
import { db } from "@/lib/db";
import { applySchedule } from "@/modules/commands/apply-schedule";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function decideScheduleProposal(input: {
  proposalId: string;
  decision: "Accepted" | "Rejected";
  actorId: string;
  resolutionNote?: string;
}) {
  const proposal = await db.scheduleProposal.update({
    where: { id: input.proposalId },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolutionNote: input.resolutionNote ?? null,
    },
  });

  if (input.decision === "Accepted") {
    return applySchedule({
      taskId: proposal.taskId,
      dueAt: proposal.dueAt,
      scheduledStartAt: proposal.scheduledStartAt,
      scheduledEndAt: proposal.scheduledEndAt,
      source: proposal.source,
      actorId: input.actorId,
    });
  }

  await rebuildTaskProjection(proposal.taskId);
  return { taskId: proposal.taskId, workspaceId: proposal.workspaceId };
}
```

- [ ] **Step 4: Expose schedule server actions and revalidation paths**

Update `src/app/actions/task-actions.ts` with these additions:

```ts
import { applySchedule as applyScheduleCommand } from "@/modules/commands/apply-schedule";
import { clearSchedule as clearScheduleCommand } from "@/modules/commands/clear-schedule";
import { decideScheduleProposal as decideScheduleProposalCommand } from "@/modules/commands/decide-schedule-proposal";
import { proposeSchedule as proposeScheduleCommand } from "@/modules/commands/propose-schedule";

function revalidateWorkspaceTaskPaths(workspaceId: string, taskId: string) {
  revalidatePath("/workspaces");
  revalidatePath("/schedule");
  revalidatePath("/tasks");
  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath(`/workspaces/${workspaceId}/tasks/${taskId}`);
  revalidatePath(`/workspaces/${workspaceId}/work/${taskId}`);
  revalidatePath("/inbox");
}

export async function applySchedule(input: Parameters<typeof applyScheduleCommand>[0]) {
  const result = await applyScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function clearSchedule(input: Parameters<typeof clearScheduleCommand>[0]) {
  const result = await clearScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function proposeSchedule(input: Parameters<typeof proposeScheduleCommand>[0]) {
  const result = await proposeScheduleCommand(input);
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
  return result;
}

export async function acceptScheduleProposal(proposalId: string) {
  const result = await decideScheduleProposalCommand({
    proposalId,
    decision: "Accepted",
    actorId: "user:saya",
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
}

export async function rejectScheduleProposal(proposalId: string) {
  const result = await decideScheduleProposalCommand({
    proposalId,
    decision: "Rejected",
    actorId: "user:saya",
  });
  revalidateWorkspaceTaskPaths(result.workspaceId, result.taskId);
}
```

- [ ] **Step 5: Run the schedule command tests**

Run:

```bash
bun test src/modules/commands/__tests__/schedule-commands.bun.test.ts
```

Expected: `1 passed`

- [ ] **Step 6: Commit the domain-command layer**

Run:

```bash
git add src/modules/commands/apply-schedule.ts src/modules/commands/clear-schedule.ts src/modules/commands/propose-schedule.ts src/modules/commands/decide-schedule-proposal.ts src/modules/commands/__tests__/schedule-commands.bun.test.ts src/app/actions/task-actions.ts
git commit -m "feat: add schedule domain commands"
```

Expected: schedule-command commit created successfully

## Task 4: Build The Top-Level Schedule Page And Shared Scheduling Form

**Files:**
- Modify: `src/modules/ui/navigation.ts`
- Modify: `src/components/__tests__/control-plane-shell.test.tsx`
- Create: `src/modules/queries/get-schedule-page.ts`
- Create: `src/modules/queries/__tests__/get-schedule-page.bun.test.ts`
- Create: `src/app/schedule/page.tsx`
- Create: `src/components/schedule/schedule-page.tsx`
- Create: `src/components/schedule/schedule-editor-form.tsx`
- Create: `src/components/schedule/__tests__/schedule-page.test.tsx`

- [ ] **Step 1: Write the failing schedule-page query test**

Create `src/modules/queries/__tests__/get-schedule-page.bun.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("getSchedulePage", () => {
  beforeEach(resetDb);

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("groups scheduled work, unscheduled work, risk items, and pending proposals", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Schedule Query", status: "Active", defaultRuntime: "openclaw" },
    });

    const scheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Scheduled task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        dueAt: new Date("2026-04-12T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-12T11:00:00.000Z"),
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const unscheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Unscheduled task",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    await db.scheduleProposal.create({
      data: {
        workspaceId: workspace.id,
        taskId: unscheduledTask.id,
        source: "ai",
        proposedBy: "planner-agent",
        summary: "Schedule for tomorrow afternoon",
        dueAt: new Date("2026-04-13T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-13T13:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-13T15:00:00.000Z"),
      },
    });

    await rebuildTaskProjection(scheduledTask.id);
    await rebuildTaskProjection(unscheduledTask.id);

    const page = await getSchedulePage();

    expect(page.scheduled).toHaveLength(1);
    expect(page.scheduled[0]?.title).toBe("Scheduled task");
    expect(page.unscheduled).toHaveLength(1);
    expect(page.unscheduled[0]?.title).toBe("Unscheduled task");
    expect(page.proposals).toHaveLength(1);
    expect(page.proposals[0]?.summary).toBe("Schedule for tomorrow afternoon");
  });
});
```

- [ ] **Step 2: Run the query test and confirm it fails before implementation**

Run:

```bash
bun test src/modules/queries/__tests__/get-schedule-page.bun.test.ts
```

Expected: fail because `getSchedulePage` does not exist yet

- [ ] **Step 3: Implement the schedule query and top navigation update**

Create `src/modules/queries/get-schedule-page.ts`:

```ts
import { db } from "@/lib/db";

export async function getSchedulePage() {
  const [projections, proposals] = await Promise.all([
    db.taskProjection.findMany({
      include: { task: true },
      orderBy: [
        { scheduledStartAt: "asc" },
        { dueAt: "asc" },
        { updatedAt: "desc" },
      ],
    }),
    db.scheduleProposal.findMany({
      where: { status: "Pending" },
      include: { task: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    scheduled: projections
      .filter((item) => item.scheduleStatus !== "Unscheduled")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        scheduleStatus: item.scheduleStatus,
        dueAt: item.dueAt,
        scheduledStartAt: item.scheduledStartAt,
        scheduledEndAt: item.scheduledEndAt,
      })),
    unscheduled: projections
      .filter((item) => item.scheduleStatus === "Unscheduled")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        priority: item.task.priority,
      })),
    risks: projections
      .filter((item) => item.scheduleStatus === "AtRisk" || item.scheduleStatus === "Overdue")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        scheduleStatus: item.scheduleStatus,
        actionRequired: item.actionRequired,
      })),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      title: proposal.task.title,
      summary: proposal.summary,
      dueAt: proposal.dueAt,
      scheduledStartAt: proposal.scheduledStartAt,
      scheduledEndAt: proposal.scheduledEndAt,
      proposedBy: proposal.proposedBy,
    })),
  };
}
```

Update `src/modules/ui/navigation.ts`:

```ts
export type ControlPlaneNavItem = {
  href: string;
  label: string;
};

export const NAV_ITEMS: ControlPlaneNavItem[] = [
  { href: "/workspaces", label: "Workspaces" },
  { href: "/schedule", label: "Schedule" },
  { href: "/tasks", label: "Tasks" },
  { href: "/inbox", label: "Inbox" },
  { href: "/memory", label: "Memory" },
  { href: "/settings", label: "Settings" },
];
```

- [ ] **Step 4: Write the failing UI tests for the new Schedule surface**

Create `src/components/schedule/__tests__/schedule-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchedulePage } from "@/components/schedule/schedule-page";

describe("SchedulePage", () => {
  it("renders planned work, unscheduled work, proposals, and risks", () => {
    render(
      <SchedulePage
        data={{
          scheduled: [
            {
              taskId: "task_1",
              workspaceId: "ws_1",
              title: "Scheduled task",
              scheduleStatus: "Scheduled",
              dueAt: new Date("2026-04-12T18:00:00.000Z"),
              scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-12T11:00:00.000Z"),
            },
          ],
          unscheduled: [
            { taskId: "task_2", workspaceId: "ws_1", title: "Unscheduled task", priority: "High" },
          ],
          risks: [
            {
              taskId: "task_3",
              workspaceId: "ws_1",
              title: "Overdue task",
              scheduleStatus: "Overdue",
              actionRequired: "Reschedule task",
            },
          ],
          proposals: [
            {
              id: "proposal_1",
              taskId: "task_2",
              workspaceId: "ws_1",
              title: "Unscheduled task",
              summary: "Schedule for tomorrow afternoon",
              dueAt: new Date("2026-04-13T18:00:00.000Z"),
              scheduledStartAt: new Date("2026-04-13T13:00:00.000Z"),
              scheduledEndAt: new Date("2026-04-13T15:00:00.000Z"),
              proposedBy: "planner-agent",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Scheduled Blocks")).toBeInTheDocument();
    expect(screen.getByText("Unscheduled Queue")).toBeInTheDocument();
    expect(screen.getByText("AI Proposals")).toBeInTheDocument();
    expect(screen.getByText("Conflicts / Overdue Risks")).toBeInTheDocument();
  });
});
```

Update `src/components/__tests__/control-plane-shell.test.tsx` to assert the new nav item:

```tsx
expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/schedule");
expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
```

- [ ] **Step 5: Implement the route, schedule page component, and shared form**

Create `src/components/schedule/schedule-editor-form.tsx`:

```tsx
import { applySchedule, clearSchedule } from "@/app/actions/task-actions";

type ScheduleEditorFormProps = {
  taskId: string;
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
};

export function ScheduleEditorForm({
  taskId,
  dueAt,
  scheduledStartAt,
  scheduledEndAt,
}: ScheduleEditorFormProps) {
  async function applyScheduleFromForm(formData: FormData) {
    "use server";

    await applySchedule({
      taskId,
      dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))) : null,
      scheduledStartAt: formData.get("scheduledStartAt")
        ? new Date(String(formData.get("scheduledStartAt")))
        : null,
      scheduledEndAt: formData.get("scheduledEndAt")
        ? new Date(String(formData.get("scheduledEndAt")))
        : null,
      source: "human",
      actorId: "user:saya",
    });
  }

  async function clearScheduleFromForm() {
    "use server";

    await clearSchedule({ taskId, actorId: "user:saya" });
  }

  return (
    <div className="space-y-3">
      <form action={applyScheduleFromForm} className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>Due</span>
          <input name="dueAt" type="date" defaultValue={dueAt?.slice(0, 10) ?? ""} className="rounded-md border px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>Start</span>
          <input name="scheduledStartAt" type="datetime-local" defaultValue={scheduledStartAt?.slice(0, 16) ?? ""} className="rounded-md border px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>End</span>
          <input name="scheduledEndAt" type="datetime-local" defaultValue={scheduledEndAt?.slice(0, 16) ?? ""} className="rounded-md border px-3 py-2 text-sm text-foreground" />
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          Apply Schedule
        </button>
      </form>

      <form action={clearScheduleFromForm}>
        <button type="submit" className="rounded-md border px-3 py-2 text-sm">
          Clear Schedule
        </button>
      </form>
    </div>
  );
}
```

Create `src/components/schedule/schedule-page.tsx`:

```tsx
import Link from "next/link";
import { acceptScheduleProposal, rejectScheduleProposal } from "@/app/actions/task-actions";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";

type SchedulePageProps = {
  data: {
    scheduled: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      scheduleStatus: string | null;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
    }>;
    unscheduled: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
    }>;
    risks: Array<{
      taskId: string;
      workspaceId: string;
      title: string;
      scheduleStatus: string | null;
      actionRequired: string | null;
    }>;
    proposals: Array<{
      id: string;
      taskId: string;
      workspaceId: string;
      title: string;
      summary: string;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
      proposedBy: string;
    }>;
  };
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "-";
}

export function SchedulePage({ data }: SchedulePageProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Plan when work happens, spot conflicts early, and confirm AI scheduling proposals.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Scheduled Blocks</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {data.scheduled.map((item) => (
            <div key={item.taskId} className="rounded-xl border bg-background p-4">
              <div className="flex items-center justify-between gap-4">
                <Link href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`} className="font-medium text-foreground hover:text-primary">
                  {item.title}
                </Link>
                <span>{item.scheduleStatus}</span>
              </div>
              <p className="mt-2">{formatDate(item.scheduledStartAt)} -> {formatDate(item.scheduledEndAt)}</p>
              <p>Due: {formatDate(item.dueAt)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Unscheduled Queue</h2>
        <div className="mt-4 space-y-4">
          {data.unscheduled.map((item) => (
            <div key={item.taskId} className="rounded-xl border bg-background p-4">
              <div className="flex items-center justify-between gap-4">
                <Link href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`} className="font-medium text-foreground hover:text-primary">
                  {item.title}
                </Link>
                <span className="text-xs text-muted-foreground">{item.priority}</span>
              </div>
              <div className="mt-4">
                <ScheduleEditorForm taskId={item.taskId} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">AI Proposals</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {data.proposals.map((proposal) => (
            <div key={proposal.id} className="rounded-xl border bg-background p-4">
              <p className="font-medium text-foreground">{proposal.title}</p>
              <p className="mt-1">{proposal.summary}</p>
              <p className="mt-1">Suggested by {proposal.proposedBy}</p>
              <div className="mt-3 flex gap-2">
                <form action={acceptScheduleProposal.bind(null, proposal.id)}>
                  <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                    Accept
                  </button>
                </form>
                <form action={rejectScheduleProposal.bind(null, proposal.id)}>
                  <button type="submit" className="rounded-md border px-3 py-2 text-sm">
                    Reject
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Conflicts / Overdue Risks</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {data.risks.map((item) => (
            <div key={item.taskId} className="rounded-xl border bg-background p-4">
              <p className="font-medium text-foreground">{item.title}</p>
              <p>{item.scheduleStatus}</p>
              <p>{item.actionRequired ?? "Open task for replanning"}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

Create `src/app/schedule/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";

export default async function ScheduleRoute() {
  const data = await getSchedulePage();

  return (
    <ControlPlaneShell>
      <SchedulePage data={data} />
    </ControlPlaneShell>
  );
}
```

- [ ] **Step 6: Run the query and UI tests for the schedule surface**

Run:

```bash
bun test src/modules/queries/__tests__/get-schedule-page.bun.test.ts && bun run test -- src/components/__tests__/control-plane-shell.test.tsx src/components/schedule/__tests__/schedule-page.test.tsx
```

Expected:
- query test passes
- shell nav test passes with `Schedule`
- schedule page component test passes

- [ ] **Step 7: Commit the new planning surface**

Run:

```bash
git add src/modules/ui/navigation.ts src/components/__tests__/control-plane-shell.test.tsx src/modules/queries/get-schedule-page.ts src/modules/queries/__tests__/get-schedule-page.bun.test.ts src/app/schedule/page.tsx src/components/schedule/schedule-page.tsx src/components/schedule/schedule-editor-form.tsx src/components/schedule/__tests__/schedule-page.test.tsx
git commit -m "feat: add top-level schedule planning surface"
```

Expected: schedule-page commit created successfully

## Task 5: Align Task, Work, Task Center, And Workspace Overview With Schedule Semantics

**Files:**
- Modify: `src/modules/queries/get-task-page.ts`
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/modules/queries/get-task-center.ts`
- Modify: `src/modules/queries/get-workspace-overview.ts`
- Modify: `src/app/tasks/page.tsx`
- Modify: `src/app/workspaces/[workspaceId]/page.tsx`
- Modify: `src/components/tasks/task-page.tsx`
- Modify: `src/components/work/work-page-client.tsx`
- Modify: `src/components/tasks/task-center-table.tsx`
- Modify: `src/components/workspaces/workspace-overview.tsx`
- Modify: `src/components/tasks/__tests__/task-page.test.tsx`
- Modify: `src/components/work/__tests__/work-page.test.tsx`
- Modify: `src/components/workspaces/__tests__/workspace-overview.test.tsx`

- [ ] **Step 1: Update the failing component tests to describe the new page roles**

Update `src/components/tasks/__tests__/task-page.test.tsx`:

```tsx
expect(screen.getByText("Scheduling")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute("href", "/schedule");
expect(screen.getByRole("button", { name: "Apply Schedule" })).toBeInTheDocument();
```

Update `src/components/work/__tests__/work-page.test.tsx`:

```tsx
expect(screen.getByText("Schedule status")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Open Schedule" })).toHaveAttribute("href", "/schedule");
```

Update `src/components/workspaces/__tests__/workspace-overview.test.tsx`:

```tsx
expect(screen.getByText("Schedule Risks")).toBeInTheDocument();
```

- [ ] **Step 2: Run the updated UI tests and confirm they fail before the page changes**

Run:

```bash
bun run test -- src/components/tasks/__tests__/task-page.test.tsx src/components/work/__tests__/work-page.test.tsx src/components/workspaces/__tests__/workspace-overview.test.tsx
```

Expected: fail because the schedule semantics are not rendered yet

- [ ] **Step 3: Extend the task and work queries with schedule context**

Update `src/modules/queries/get-task-page.ts` to return schedule fields and proposal counts:

```ts
include: {
  projection: true,
  runs: { orderBy: { createdAt: "desc" }, take: 1 },
  approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
  artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
  scheduleProposals: { where: { status: "Pending" }, orderBy: { createdAt: "desc" }, take: 3 },
  dependencies: {
    include: {
      dependsOnTask: {
        select: { id: true, title: true, status: true },
      },
    },
  },
},

task: {
  id: task.id,
  workspaceId: task.workspaceId,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  dueAt: task.dueAt?.toISOString() ?? null,
  scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
  scheduledEndAt: task.scheduledEndAt?.toISOString() ?? null,
  scheduleStatus: task.scheduleStatus,
  scheduleSource: task.scheduleSource,
  blockReason: readBlockReason(task),
  dependencies: task.dependencies.map((dependency) => ({
    id: dependency.id,
    dependencyType: dependency.dependencyType,
    dependsOnTask: dependency.dependsOnTask,
  })),
},
scheduleProposals: task.scheduleProposals.map((proposal) => ({
  id: proposal.id,
  summary: proposal.summary,
  proposedBy: proposal.proposedBy,
})),
```

Update `src/modules/queries/get-work-page.ts`:

```ts
taskShell: {
  id: task.id,
  workspaceId: task.workspaceId,
  title: task.title,
  status: task.projection?.displayState ?? task.status,
  priority: task.priority,
  dueAt: task.dueAt?.toISOString() ?? null,
  scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
  scheduledEndAt: task.scheduledEndAt?.toISOString() ?? null,
  scheduleStatus: task.scheduleStatus,
  blockReason: readBlockReason(task),
},
```

- [ ] **Step 4: Make the Task and Work components show their correct scheduling responsibilities**

Update `src/components/tasks/task-page.tsx` to reuse `ScheduleEditorForm` and expose the planning CTA:

```tsx
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";

<section className="rounded-xl border bg-background p-4">
  <div className="flex items-center justify-between gap-4">
    <h2 className="text-sm font-semibold">Scheduling</h2>
    <Link href="/schedule" className="text-sm text-primary hover:underline">
      Open Schedule
    </Link>
  </div>
  <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
    <div className="flex items-center justify-between gap-4">
      <dt>Schedule status</dt>
      <dd>{data.task.scheduleStatus}</dd>
    </div>
    <div className="flex items-center justify-between gap-4">
      <dt>Schedule source</dt>
      <dd>{data.task.scheduleSource ?? "-"}</dd>
    </div>
    <div className="flex items-center justify-between gap-4">
      <dt>Due</dt>
      <dd>{formatDate(data.task.dueAt)}</dd>
    </div>
    <div className="flex items-center justify-between gap-4">
      <dt>Start</dt>
      <dd>{formatDate(data.task.scheduledStartAt)}</dd>
    </div>
    <div className="flex items-center justify-between gap-4">
      <dt>End</dt>
      <dd>{formatDate(data.task.scheduledEndAt)}</dd>
    </div>
  </dl>
  <div className="mt-4">
    <ScheduleEditorForm
      taskId={data.task.id}
      dueAt={data.task.dueAt}
      scheduledStartAt={data.task.scheduledStartAt}
      scheduledEndAt={data.task.scheduledEndAt}
    />
  </div>
</section>
```

Update `src/components/work/work-page-client.tsx` so the work surface reflects schedule risk but does not own writes:

```tsx
import Link from "next/link";

<dl className="space-y-2 text-sm text-muted-foreground">
  <div className="flex items-center justify-between gap-4">
    <dt>Priority</dt>
    <dd>{data.taskShell.priority}</dd>
  </div>
  <div className="flex items-center justify-between gap-4">
    <dt>Schedule status</dt>
    <dd>{data.taskShell.scheduleStatus}</dd>
  </div>
  <div className="flex items-center justify-between gap-4">
    <dt>Due</dt>
    <dd>{formatDate(data.taskShell.dueAt)}</dd>
  </div>
  <div className="flex items-center justify-between gap-4">
    <dt>Next action</dt>
    <dd>{data.taskShell.blockReason?.actionRequired ?? "Observe timeline"}</dd>
  </div>
</dl>

<Link href="/schedule" className="inline-flex rounded-md border px-3 py-2 text-sm hover:bg-muted">
  Open Schedule
</Link>
```

- [ ] **Step 5: Make Task Center and Workspace Overview schedule-aware**

Update `src/modules/queries/get-task-center.ts`:

```ts
export async function getTaskCenter(
  filter?:
    | "Running"
    | "WaitingForApproval"
    | "Blocked"
    | "Failed"
    | "Unscheduled"
    | "Overdue",
) {
  const projections = await db.taskProjection.findMany({
    include: { task: true },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
  });

  return projections
    .filter((item) => {
      if (!filter) return true;
      if (filter === "WaitingForApproval") return item.displayState === "WaitingForApproval";
      if (filter === "Failed") return item.persistedStatus === "Failed" || item.displayState === "Attention Needed";
      if (filter === "Blocked") return item.persistedStatus === "Blocked";
      if (filter === "Unscheduled") return item.scheduleStatus === "Unscheduled";
      if (filter === "Overdue") return item.scheduleStatus === "Overdue" || item.scheduleStatus === "AtRisk";
      return item.persistedStatus === filter;
    })
    .map((item) => ({
      taskId: item.taskId,
      title: item.task.title,
      persistedStatus: item.persistedStatus,
      displayState: item.displayState,
      latestRunStatus: item.latestRunStatus,
      actionRequired: item.actionRequired,
      dueAt: item.dueAt,
      scheduleStatus: item.scheduleStatus,
      updatedAt: item.lastActivityAt ?? item.updatedAt,
      workspaceId: item.workspaceId,
    }));
}
```

Update `src/app/tasks/page.tsx`:

```ts
const FILTERS = [
  "Running",
  "WaitingForApproval",
  "Blocked",
  "Failed",
  "Unscheduled",
  "Overdue",
] as const;
```

Update `src/components/tasks/task-center-table.tsx`:

```tsx
<th className="px-4 py-3 font-medium">Schedule</th>

<td className="px-4 py-3 text-muted-foreground">{row.scheduleStatus ?? "-"}</td>
```

Update `src/modules/queries/get-workspace-overview.ts` and `src/components/workspaces/workspace-overview.tsx` to add a `scheduleRisks` section:

```ts
scheduleRisks: projections
  .filter((item) => item.scheduleStatus === "AtRisk" || item.scheduleStatus === "Overdue")
  .map((item) => ({
    taskId: item.taskId,
    scheduleStatus: item.scheduleStatus,
    actionRequired: item.actionRequired,
  })),
```

```tsx
{
  title: "Schedule Risks",
  items: data.scheduleRisks.map((item) => ({
    taskId: item.taskId,
    meta: `${item.scheduleStatus} · ${item.actionRequired ?? "Open task"}`,
  })),
},
```

Update `src/app/workspaces/[workspaceId]/page.tsx` copy:

```tsx
<p className="text-sm text-muted-foreground">
  Triage the runs and schedule risks that need attention before diving into execution detail.
</p>
```

- [ ] **Step 6: Run the updated UI suite for the aligned surfaces**

Run:

```bash
bun run test -- src/components/tasks/__tests__/task-page.test.tsx src/components/work/__tests__/work-page.test.tsx src/components/workspaces/__tests__/workspace-overview.test.tsx
```

Expected: all three component tests pass

- [ ] **Step 7: Commit the page-alignment changes**

Run:

```bash
git add src/modules/queries/get-task-page.ts src/modules/queries/get-work-page.ts src/modules/queries/get-task-center.ts src/modules/queries/get-workspace-overview.ts src/app/tasks/page.tsx src/app/workspaces/[workspaceId]/page.tsx src/components/tasks/task-page.tsx src/components/work/work-page-client.tsx src/components/tasks/task-center-table.tsx src/components/workspaces/workspace-overview.tsx src/components/tasks/__tests__/task-page.test.tsx src/components/work/__tests__/work-page.test.tsx src/components/workspaces/__tests__/workspace-overview.test.tsx
git commit -m "feat: align task and work surfaces with schedule semantics"
```

Expected: surface-alignment commit created successfully

## Task 6: Update Seed Data, Browser Coverage, And Project Docs

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `README.md`
- Modify: `e2e/control-plane.spec.ts`
- Create: `e2e/schedule.spec.ts`

- [ ] **Step 1: Extend the seed data for scheduled, unscheduled, overdue, and proposal cases**

Update `prisma/seed.ts` so the full seed set includes the two existing execution-focused tasks plus at least these three schedule-focused tasks:

```ts
const scheduledTask = await prisma.task.upsert({
  where: { id: "task_scheduled" },
  update: {
    workspaceId: workspace.id,
    title: "Prepare release notes",
    description: "Scheduled planning task",
    status: TaskStatus.Ready,
    priority: TaskPriority.Medium,
    ownerType: "human",
    dueAt: new Date("2026-04-12T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-12T10:00:00.000Z"),
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
  },
  create: {
    id: "task_scheduled",
    workspaceId: workspace.id,
    title: "Prepare release notes",
    description: "Scheduled planning task",
    status: TaskStatus.Ready,
    priority: TaskPriority.Medium,
    ownerType: "human",
    dueAt: new Date("2026-04-12T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-12T10:00:00.000Z"),
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
  },
});

const unscheduledTask = await prisma.task.upsert({
  where: { id: "task_unscheduled" },
  update: {
    workspaceId: workspace.id,
    title: "Plan docs migration",
    description: "Needs a slot on the schedule page",
    status: TaskStatus.Ready,
    priority: TaskPriority.High,
    ownerType: "human",
    scheduleStatus: "Unscheduled",
  },
  create: {
    id: "task_unscheduled",
    workspaceId: workspace.id,
    title: "Plan docs migration",
    description: "Needs a slot on the schedule page",
    status: TaskStatus.Ready,
    priority: TaskPriority.High,
    ownerType: "human",
    scheduleStatus: "Unscheduled",
  },
});

await prisma.scheduleProposal.upsert({
  where: { id: "proposal_unscheduled" },
  update: {
    workspaceId: workspace.id,
    taskId: unscheduledTask.id,
    source: "ai",
    status: "Pending",
    proposedBy: "planner-agent",
    summary: "Schedule docs migration tomorrow morning",
    dueAt: new Date("2026-04-13T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-13T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-13T11:00:00.000Z"),
  },
  create: {
    id: "proposal_unscheduled",
    workspaceId: workspace.id,
    taskId: unscheduledTask.id,
    source: "ai",
    status: "Pending",
    proposedBy: "planner-agent",
    summary: "Schedule docs migration tomorrow morning",
    dueAt: new Date("2026-04-13T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-13T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-13T11:00:00.000Z"),
  },
});

const overdueTask = await prisma.task.upsert({
  where: { id: "task_overdue" },
  update: {
    workspaceId: workspace.id,
    title: "Finish adapter retry review",
    description: "Execution has already spilled beyond the planned window",
    status: TaskStatus.Running,
    priority: TaskPriority.Urgent,
    ownerType: "human",
    dueAt: new Date("2026-04-08T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-08T13:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-08T15:00:00.000Z"),
    scheduleStatus: "Overdue",
    scheduleSource: "human",
  },
  create: {
    id: "task_overdue",
    workspaceId: workspace.id,
    title: "Finish adapter retry review",
    description: "Execution has already spilled beyond the planned window",
    status: TaskStatus.Running,
    priority: TaskPriority.Urgent,
    ownerType: "human",
    dueAt: new Date("2026-04-08T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-08T13:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-08T15:00:00.000Z"),
    scheduleStatus: "Overdue",
    scheduleSource: "human",
  },
});

await prisma.taskProjection.upsert({
  where: { taskId: overdueTask.id },
  update: {
    workspaceId: workspace.id,
    persistedStatus: TaskStatus.Running,
    latestRunStatus: RunStatus.Running,
    scheduleStatus: "Overdue",
    actionRequired: "Reschedule task",
    dueAt: new Date("2026-04-08T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-08T13:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-08T15:00:00.000Z"),
    lastActivityAt: new Date("2026-04-08T15:30:00.000Z"),
  },
  create: {
    taskId: overdueTask.id,
    workspaceId: workspace.id,
    persistedStatus: TaskStatus.Running,
    latestRunStatus: RunStatus.Running,
    scheduleStatus: "Overdue",
    actionRequired: "Reschedule task",
    dueAt: new Date("2026-04-08T18:00:00.000Z"),
    scheduledStartAt: new Date("2026-04-08T13:00:00.000Z"),
    scheduledEndAt: new Date("2026-04-08T15:00:00.000Z"),
    lastActivityAt: new Date("2026-04-08T15:30:00.000Z"),
  },
});
```

- [ ] **Step 2: Add a browser test for the schedule workflow**

Create `e2e/schedule.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("schedule page exposes planning queues and proposal actions", async ({ page }) => {
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Unscheduled Queue")).toBeVisible();
  await expect(page.getByText("AI Proposals")).toBeVisible();
  await expect(page.getByText("Conflicts / Overdue Risks")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan docs migration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
});
```

Update `e2e/control-plane.spec.ts` so the nav expectation includes `Schedule`:

```ts
await page.goto("/tasks");
await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();
```

- [ ] **Step 3: Replace the stock README with actual product and dev workflow docs**

Replace `README.md` with this content:

~~~~md
# Agent Dashboard

Task-centric AI control plane for supervising OpenClaw-backed work.

## What This App Is

- `Schedule` is the global planning surface for assigning time blocks, reviewing AI schedule proposals, and spotting conflicts.
- `Task Page` is the single-task planning and control surface.
- `Work Page` is the execution surface for timeline, conversation, tool calls, approvals, and recovery.

## Stack

- Next.js App Router
- Prisma + SQLite
- React 19
- Bun

## Local Development

```bash
bun install
bunx prisma migrate dev
bunx prisma generate
bun run db:seed
bun run dev
```

## Verification

```bash
bun test
bun run test
bun run lint
bun run build
bun run test:e2e
```

## OpenClaw Gate

Refresh the runtime feasibility evidence before large adapter changes:

```bash
OPENCLAW_MODE=live bun run probe:openclaw
```
~~~~

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
bun run db:seed && bun test src/modules/tasks/__tests__/derive-schedule-state.test.ts src/modules/commands/__tests__/schedule-commands.bun.test.ts src/modules/queries/__tests__/get-schedule-page.bun.test.ts src/modules/projections/__tests__/projection-read-model.bun.test.ts && bun run test -- src/components/__tests__/control-plane-shell.test.tsx src/components/schedule/__tests__/schedule-page.test.tsx src/components/tasks/__tests__/task-page.test.tsx src/components/work/__tests__/work-page.test.tsx src/components/workspaces/__tests__/workspace-overview.test.tsx && bun run lint && bun run build && bun run test:e2e
```

Expected:
- seed completes
- bun tests pass
- vitest component tests pass
- lint passes
- production build passes
- Playwright passes both control-plane and schedule specs

- [ ] **Step 5: Commit the seed, e2e, and docs updates**

Run:

```bash
git add prisma/seed.ts README.md e2e/control-plane.spec.ts e2e/schedule.spec.ts
git commit -m "test: cover schedule-first control plane flows"
```

Expected: final schedule-alignment commit created successfully

## Final Review Checklist

- [ ] `Schedule` is in top nav and its page purpose is self-evident without usage docs.
- [ ] `Task Page` can explain and change why a task is scheduled as it is.
- [ ] `Work Page` shows whether execution is threatening the plan, but does not become a schedule editor.
- [ ] All scheduling writes flow through domain commands and canonical events.
- [ ] AI schedule changes land as proposals until a human accepts them.
- [ ] Projection/state logic reflects `Unscheduled`, `AtRisk`, `Overdue`, and `Completed` schedule states.
- [ ] Seed data and e2e coverage exercise scheduled, unscheduled, overdue-risk, and proposal scenarios.
