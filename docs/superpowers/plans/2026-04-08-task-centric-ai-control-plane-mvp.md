# Task-Centric AI Control Plane MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working `Task-Centric AI Control Plane` MVP for `OpenClaw`, preserving task-first control semantics and stopping immediately if the OpenClaw feasibility gate fails.

**Architecture:** Use a single `Next.js` application with `Prisma` and `SQLite`, keeping canonical platform objects (`Task`, `Run`, `Approval`, `Artifact`, `Memory`, `Event`) inside the app and isolating runtime-specific logic behind an `OpenClawAdapter`. Persist both current state and canonical events, derive `Task Projection` and `Work Projection` from those records, and keep `Task Page` and `Work Page` as separate surfaces with distinct responsibilities.

**Tech Stack:** `Next.js` App Router, `TypeScript`, `SQLite`, `Prisma`, `shadcn/ui`, `Vitest`, `Testing Library`, `Playwright`, `Zod`

---

## Execution Gate

- Task 2 is a hard `stop/continue` gate.
- If the generated `docs/research/2026-04-08-openclaw-feasibility.md` report fails any of the four mandatory checks, stop implementation and do not continue to Tasks 3-10.
- A mock adapter is allowed for local UI development and tests after the gate passes, but it must never replace the live feasibility decision.

## File Structure

### Root / Tooling

- `package.json`: app scripts, dependencies, test commands, probe command
- `.env.example`: local environment variables for database and OpenClaw connectivity
- `next.config.ts`: Next.js configuration
- `vitest.config.ts`: unit and component test configuration
- `playwright.config.ts`: browser verification configuration
- `components.json`: `shadcn/ui` registry configuration

### Database / Seed

- `prisma/schema.prisma`: canonical domain schema and enums
- `prisma/seed.ts`: local development seed data for one workspace and representative tasks
- `src/lib/db.ts`: shared `PrismaClient` singleton

### Runtime / Adapter

- `scripts/openclaw/probe.ts`: feasibility probe runner that writes the gate report
- `src/modules/runtime/openclaw/types.ts`: runtime-native payload types and canonical gate types
- `src/modules/runtime/openclaw/client.ts`: low-level OpenClaw HTTP client
- `src/modules/runtime/openclaw/evaluate-gate.ts`: four-check pass/fail evaluator
- `src/modules/runtime/openclaw/adapter.ts`: runtime adapter factory and live adapter
- `src/modules/runtime/openclaw/mock-adapter.ts`: deterministic adapter for local UI and e2e tests
- `src/modules/runtime/openclaw/mapper.ts`: runtime payload to canonical event/object mapping
- `src/modules/runtime/openclaw/sync-run.ts`: incremental sync orchestration

### Domain / Projections / Commands

- `src/modules/events/append-canonical-event.ts`: append canonical events with stable dedupe keys
- `src/modules/tasks/derive-task-state.ts`: derive persisted task status, display state, and block summary
- `src/modules/projections/rebuild-task-projection.ts`: update the task control-plane read model
- `src/modules/projections/get-work-projection.ts`: assemble the execution read model
- `src/modules/commands/update-task.ts`: task definition and schedule edits
- `src/modules/commands/start-run.ts`: local run creation plus adapter execution kickoff
- `src/modules/commands/retry-run.ts`: retry behavior for failed runs
- `src/modules/commands/resume-run.ts`: resume behavior for blocked runs
- `src/modules/commands/resolve-approval.ts`: approve, reject, edit-and-approve actions
- `src/modules/commands/provide-input.ts`: human input submission for waiting runs
- `src/modules/queries/get-workspaces.ts`: workspace list query
- `src/modules/queries/get-workspace-overview.ts`: overview cards query
- `src/modules/queries/get-task-center.ts`: task list query with control-plane filters
- `src/modules/queries/get-task-page.ts`: task planning/control page query
- `src/modules/queries/get-work-page.ts`: work page shell query
- `src/modules/queries/get-inbox.ts`: inbox items query
- `src/modules/queries/get-memory-console.ts`: memory console query

### App / UI

- `src/app/layout.tsx`: global shell frame
- `src/app/page.tsx`: redirect to `/workspaces`
- `src/app/workspaces/page.tsx`: workspace switcher/list
- `src/app/workspaces/[workspaceId]/page.tsx`: workspace overview
- `src/app/tasks/page.tsx`: task center
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`: task page
- `src/app/workspaces/[workspaceId]/work/[taskId]/page.tsx`: work page
- `src/app/inbox/page.tsx`: approval/input interruption inbox
- `src/app/memory/page.tsx`: memory console
- `src/app/settings/page.tsx`: runtime config and adapter health summary
- `src/app/actions/task-actions.ts`: server actions for task, run, approval, input, and memory mutations
- `src/app/api/work/[taskId]/projection/route.ts`: polling endpoint that syncs active runs and returns fresh work projection
- `src/components/control-plane-shell.tsx`: global navigation shell
- `src/components/tasks/task-center-table.tsx`: task control list
- `src/components/tasks/task-page.tsx`: planning/control surface
- `src/components/work/work-page-client.tsx`: polling execution surface
- `src/components/work/execution-timeline.tsx`: canonical timeline renderer
- `src/components/work/conversation-panel.tsx`: conversation as secondary view
- `src/components/work/run-side-panel.tsx`: approvals, artifacts, tool summaries, runtime refs
- `src/components/inbox/inbox-list.tsx`: interruption list with action affordances
- `src/components/memory/memory-console.tsx`: memory list and invalidate action

### Tests

- `src/components/__tests__/control-plane-shell.test.tsx`
- `src/modules/runtime/openclaw/__tests__/evaluate-gate.test.ts`
- `src/modules/db/__tests__/schema-smoke.test.ts`
- `src/modules/projections/__tests__/task-state.test.ts`
- `src/modules/runtime/openclaw/__tests__/sync-run.test.ts`
- `src/modules/commands/__tests__/command-chain.test.ts`
- `src/components/workspaces/__tests__/workspace-overview.test.tsx`
- `src/components/tasks/__tests__/task-page.test.tsx`
- `src/components/work/__tests__/work-page.test.tsx`
- `src/components/inbox/__tests__/inbox-list.test.tsx`
- `src/components/memory/__tests__/memory-console.test.tsx`
- `e2e/control-plane.spec.ts`

## Task 1: Bootstrap The Workspace And Test Harness

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/modules/ui/navigation.ts`
- Create: `src/components/control-plane-shell.tsx`
- Create: `src/components/__tests__/control-plane-shell.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Initialize git and scaffold the app**

Run:

```bash
git init
npx create-next-app@latest . --ts --app --src-dir --tailwind --eslint --use-npm --import-alias "@/*"
npx shadcn@latest init -d
npm install @prisma/client zod date-fns lucide-react clsx tailwind-merge
npm install -D prisma vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8 playwright tsx
```

Expected:
- `.git/` exists
- `src/app/` exists
- `components.json` exists
- `node_modules/` installs cleanly

- [ ] **Step 2: Add baseline scripts and test setup**

Update `package.json` scripts to:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:seed": "tsx prisma/seed.ts",
    "probe:openclaw": "tsx scripts/openclaw/probe.ts"
  }
}
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `.env.example`:

```bash
DATABASE_URL="file:./dev.db"
OPENCLAW_MODE="live"
OPENCLAW_BASE_URL="http://localhost:3001"
OPENCLAW_API_KEY="replace-me"
WORK_POLL_INTERVAL_MS="10000"
```

- [ ] **Step 3: Write the failing shell test**

Create `src/components/__tests__/control-plane-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { ControlPlaneShell } from "@/components/control-plane-shell";

describe("ControlPlaneShell", () => {
  it("renders the MVP control-plane navigation and excludes Calendar", () => {
    render(
      <ControlPlaneShell>
        <div>Workspace body</div>
      </ControlPlaneShell>,
    );

    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "href",
      "/workspaces",
    );
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/inbox",
    );
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement the shell, navigation config, and root redirect**

Create `src/modules/ui/navigation.ts`:

```ts
export const NAV_ITEMS = [
  { href: "/workspaces", label: "Workspaces" },
  { href: "/tasks", label: "Tasks" },
  { href: "/inbox", label: "Inbox" },
  { href: "/memory", label: "Memory" },
  { href: "/settings", label: "Settings" },
] as const;
```

Create `src/components/control-plane-shell.tsx`:

```tsx
import Link from "next/link";
import { NAV_ITEMS } from "@/modules/ui/navigation";

type ControlPlaneShellProps = {
  children: React.ReactNode;
};

export function ControlPlaneShell({ children }: ControlPlaneShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4">
          <Link href="/workspaces" className="text-sm font-semibold tracking-wide">
            Agent Dashboard
          </Link>
          <nav className="flex gap-4 text-sm text-slate-300">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
```

Update `src/app/layout.tsx` so the `<body>` keeps the generated font wiring and wraps `{children}` directly.

Update `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/workspaces");
}
```

- [ ] **Step 5: Run the shell test**

Run:

```bash
npm run test -- src/components/__tests__/control-plane-shell.test.tsx
```

Expected: `1 passed`

- [ ] **Step 6: Commit the bootstrap**

Run:

```bash
git add .
git commit -m "chore: bootstrap task control plane workspace"
```

Expected: bootstrap commit created successfully

## Task 2: Verify The OpenClaw Feasibility Gate

**Files:**
- Create: `src/modules/runtime/openclaw/types.ts`
- Create: `src/modules/runtime/openclaw/client.ts`
- Create: `src/modules/runtime/openclaw/evaluate-gate.ts`
- Create: `src/modules/runtime/openclaw/__tests__/evaluate-gate.test.ts`
- Create: `scripts/openclaw/probe.ts`
- Create: `docs/research/2026-04-08-openclaw-feasibility.md`

- [ ] **Step 1: Write the failing gate evaluator test**

Create `src/modules/runtime/openclaw/__tests__/evaluate-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateOpenClawGate } from "@/modules/runtime/openclaw/evaluate-gate";

describe("evaluateOpenClawGate", () => {
  it("fails when any mandatory check is missing", () => {
    const report = evaluateOpenClawGate([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "Running" },
      { name: "read_outputs", passed: true, evidence: "1 output item" },
      { name: "resume_after_wait", passed: false, evidence: "resume endpoint missing" },
    ]);

    expect(report.overall).toBe("fail");
  });

  it("passes only when all four checks pass", () => {
    const report = evaluateOpenClawGate([
      { name: "create_run", passed: true, evidence: "run_123" },
      { name: "query_status", passed: true, evidence: "Running" },
      { name: "read_outputs", passed: true, evidence: "tool + message payload visible" },
      { name: "resume_after_wait", passed: true, evidence: "resume accepted" },
    ]);

    expect(report.overall).toBe("pass");
  });
});
```

- [ ] **Step 2: Implement the gate types and evaluator**

Create `src/modules/runtime/openclaw/types.ts`:

```ts
export type GateCheckName =
  | "create_run"
  | "query_status"
  | "read_outputs"
  | "resume_after_wait";

export type GateCheckResult = {
  name: GateCheckName;
  passed: boolean;
  evidence: string;
};

export type GateReport = {
  overall: "pass" | "fail";
  checks: GateCheckResult[];
};

export type OpenClawRunSnapshot = {
  runtimeRunRef: string;
  runtimeSessionRef?: string;
  status: "Pending" | "Running" | "WaitingForInput" | "WaitingForApproval" | "Failed" | "Completed";
  lastMessage?: string;
};

export type OpenClawEventPage = {
  nextCursor?: string;
  items: Array<Record<string, unknown>>;
};
```

Create `src/modules/runtime/openclaw/evaluate-gate.ts`:

```ts
import type { GateCheckResult, GateReport } from "@/modules/runtime/openclaw/types";

const REQUIRED_CHECKS = [
  "create_run",
  "query_status",
  "read_outputs",
  "resume_after_wait",
] as const;

export function evaluateOpenClawGate(checks: GateCheckResult[]): GateReport {
  const checkMap = new Map(checks.map((check) => [check.name, check]));
  const normalized = REQUIRED_CHECKS.map(
    (name) => checkMap.get(name) ?? { name, passed: false, evidence: "missing check" },
  );

  return {
    overall: normalized.every((check) => check.passed) ? "pass" : "fail",
    checks: normalized,
  };
}
```

- [ ] **Step 3: Implement the OpenClaw client and probe runner**

Create `src/modules/runtime/openclaw/client.ts`:

```ts
import type { OpenClawEventPage, OpenClawRunSnapshot } from "@/modules/runtime/openclaw/types";

export interface OpenClawRuntimeClient {
  createRun(input: { prompt: string }): Promise<{ runtimeRunRef: string; runtimeSessionRef?: string }>;
  getRun(runtimeRunRef: string): Promise<OpenClawRunSnapshot>;
  listEvents(runtimeRunRef: string, cursor?: string): Promise<OpenClawEventPage>;
  resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }): Promise<{ accepted: boolean }>;
}

export class OpenClawHttpClient implements OpenClawRuntimeClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async createRun(input: { prompt: string }) {
    const response = await fetch(`${this.baseUrl}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });
    return response.json();
  }

  async getRun(runtimeRunRef: string) {
    const response = await fetch(`${this.baseUrl}/runs/${runtimeRunRef}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    return response.json();
  }

  async listEvents(runtimeRunRef: string, cursor?: string) {
    const url = new URL(`${this.baseUrl}/runs/${runtimeRunRef}/events`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    return response.json();
  }

  async resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }) {
    const response = await fetch(`${this.baseUrl}/runs/${input.runtimeRunRef}/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });
    return response.json();
  }
}
```

Create `scripts/openclaw/probe.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { OpenClawHttpClient } from "@/modules/runtime/openclaw/client";
import { evaluateOpenClawGate } from "@/modules/runtime/openclaw/evaluate-gate";
import type { GateCheckResult } from "@/modules/runtime/openclaw/types";

async function main() {
  const baseUrl = process.env.OPENCLAW_BASE_URL;
  const apiKey = process.env.OPENCLAW_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("OPENCLAW_BASE_URL and OPENCLAW_API_KEY are required");
  }

  const client = new OpenClawHttpClient(baseUrl, apiKey);
  const created = await client.createRun({ prompt: "Probe: print status and wait for approval if supported." });
  const snapshot = await client.getRun(created.runtimeRunRef);
  const events = await client.listEvents(created.runtimeRunRef);
  const resumed = await client.resumeRun({ runtimeRunRef: created.runtimeRunRef, inputText: "resume probe" });

  const checks: GateCheckResult[] = [
    { name: "create_run", passed: Boolean(created.runtimeRunRef), evidence: created.runtimeRunRef ?? "no runtime ref" },
    { name: "query_status", passed: Boolean(snapshot.status), evidence: snapshot.status ?? "no status" },
    { name: "read_outputs", passed: events.items.length > 0 || Boolean(snapshot.lastMessage), evidence: `${events.items.length} events` },
    { name: "resume_after_wait", passed: resumed.accepted, evidence: resumed.accepted ? "resume accepted" : "resume rejected" },
  ];

  const report = evaluateOpenClawGate(checks);
  const lines = [
    "# OpenClaw Feasibility Gate",
    "",
    `Overall: ${report.overall.toUpperCase()}`,
    "",
    ...report.checks.map((check) => `- ${check.name}: ${check.passed ? "PASS" : "FAIL"} (${check.evidence})`),
  ];

  await mkdir("docs/research", { recursive: true });
  await writeFile("docs/research/2026-04-08-openclaw-feasibility.md", `${lines.join("\n")}\n`);

  if (report.overall === "fail") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Run the gate evaluator unit test**

Run:

```bash
npm run test -- src/modules/runtime/openclaw/__tests__/evaluate-gate.test.ts
```

Expected: `2 passed`

- [ ] **Step 5: Execute the live feasibility probe**

Run:

```bash
set -a && source .env && set +a && npm run probe:openclaw
```

Expected:
- `docs/research/2026-04-08-openclaw-feasibility.md` is written
- exit code `0` only when all four mandatory checks pass
- if exit code is non-zero, stop here and do not continue to Task 3

- [ ] **Step 6: Commit the feasibility gate**

Run:

```bash
git add src/modules/runtime/openclaw scripts/openclaw docs/research .env.example
git commit -m "feat: add openclaw feasibility gate"
```

Expected: feasibility gate commit created successfully

## Task 3: Define The Canonical Database Schema And Seed Data

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `src/lib/db.ts`
- Create: `src/modules/db/__tests__/schema-smoke.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing schema smoke test**

Create `src/modules/db/__tests__/schema-smoke.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, ApprovalStatus, RunStatus, TaskPriority, TaskStatus } from "@prisma/client";

const prisma = new PrismaClient();

describe("schema smoke", () => {
  beforeAll(async () => {
    await prisma.event.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.artifact.deleteMany();
    await prisma.run.deleteMany();
    await prisma.taskProjection.deleteMany();
    await prisma.task.deleteMany();
    await prisma.workspace.deleteMany();
  });

  it("stores a task -> run -> event chain with approval and artifact references", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "MVP Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Draft adapter sync",
        status: TaskStatus.Ready,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await prisma.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await prisma.event.create({
      data: {
        eventType: "run.started",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        actorType: "user",
        actorId: "seed-user",
        source: "ui",
        payload: { runtime_name: "openclaw" },
        dedupeKey: `run.started:${run.id}`,
        ingestSequence: 1,
      },
    });

    await prisma.approval.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "file_change",
        title: "Approve patch",
        summary: "Write task projection patch",
        riskLevel: "medium",
        status: ApprovalStatus.Pending,
        requestedAt: new Date(),
      },
    });

    await prisma.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "patch",
        title: "projection.diff",
        uri: "file:///tmp/projection.diff",
      },
    });

    const stored = await prisma.task.findUnique({
      where: { id: task.id },
      include: { runs: true, approvals: true, artifacts: true, events: true },
    });

    expect(stored?.runs).toHaveLength(1);
    expect(stored?.approvals).toHaveLength(1);
    expect(stored?.artifacts).toHaveLength(1);
    expect(stored?.events[0]?.eventType).toBe("run.started");
  });
});
```

- [ ] **Step 2: Implement the Prisma schema and Prisma client**

Create `prisma/schema.prisma` with these core enums and models:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum WorkspaceStatus {
  Active
  Archived
}

enum TaskStatus {
  Draft
  Ready
  Queued
  Running
  WaitingForInput
  WaitingForApproval
  Scheduled
  Blocked
  Failed
  Completed
  Cancelled
}

enum TaskPriority {
  Low
  Medium
  High
  Urgent
}

enum OwnerType {
  human
  agent
}

enum RunStatus {
  Pending
  Running
  WaitingForInput
  WaitingForApproval
  Failed
  Completed
  Cancelled
}

enum ApprovalStatus {
  Pending
  Approved
  Rejected
  EditedAndApproved
  Expired
}

enum ArtifactType {
  file
  patch
  summary
  report
  terminal_output
  url
}

enum MemoryScope {
  user
  workspace
  project
  task
}

enum MemorySourceType {
  user_input
  agent_inferred
  imported
  system_rule
}

enum MemoryStatus {
  Active
  Inactive
  Conflicted
  Expired
}

model Workspace {
  id             String           @id @default(cuid())
  name           String
  description    String?
  defaultRuntime String
  status         WorkspaceStatus
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  tasks          Task[]
  approvals      Approval[]
  artifacts      Artifact[]
  memories       Memory[]
  events         Event[]
  taskProjections TaskProjection[]
}

model Task {
  id               String         @id @default(cuid())
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
  budgetLimit      Int?
  blockReason      Json?
  latestRunId      String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  completedAt      DateTime?
  workspace        Workspace      @relation(fields: [workspaceId], references: [id])
  runs             Run[]
  approvals        Approval[]
  artifacts        Artifact[]
  memories         Memory[]
  events           Event[]
  projection       TaskProjection?
}

model Run {
  id                 String      @id @default(cuid())
  taskId             String
  runtimeName        String
  runtimeRunRef      String?     @unique
  runtimeSessionRef  String?
  status             RunStatus
  startedAt          DateTime?
  endedAt            DateTime?
  errorSummary       String?
  resumeToken        String?
  triggeredBy        String
  retryable          Boolean     @default(false)
  resumeSupported    Boolean     @default(false)
  pendingInputPrompt String?
  pendingInputType   String?
  lastSyncedAt       DateTime?
  syncStatus         String      @default("healthy")
  mappingPartial     Boolean     @default(false)
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt
  task               Task        @relation(fields: [taskId], references: [id])
  approvals          Approval[]
  artifacts          Artifact[]
  events             Event[]
  conversationEntries ConversationEntry[]
  toolCallDetails    ToolCallDetail[]
  runtimeCursor      RuntimeCursor?
}

model Approval {
  id             String         @id @default(cuid())
  workspaceId    String
  taskId         String
  runId          String
  type           String
  title          String
  summary        String
  riskLevel      String
  payload        Json?
  status         ApprovalStatus
  requestedAt    DateTime
  resolvedAt     DateTime?
  resolvedBy     String?
  resolutionNote String?
  workspace      Workspace      @relation(fields: [workspaceId], references: [id])
  task           Task           @relation(fields: [taskId], references: [id])
  run            Run            @relation(fields: [runId], references: [id])
}

model Artifact {
  id             String       @id @default(cuid())
  workspaceId    String
  taskId         String
  runId          String
  type           ArtifactType
  title          String
  uri            String
  contentPreview String?
  metadata       Json?
  createdAt      DateTime     @default(now())
  workspace      Workspace    @relation(fields: [workspaceId], references: [id])
  task           Task         @relation(fields: [taskId], references: [id])
  run            Run          @relation(fields: [runId], references: [id])
}

model Memory {
  id          String           @id @default(cuid())
  workspaceId String
  taskId      String?
  sourceRunId String?
  content     String
  scope       MemoryScope
  sourceType  MemorySourceType
  confidence  Float?
  status      MemoryStatus
  expiresAt   DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  workspace   Workspace        @relation(fields: [workspaceId], references: [id])
  task        Task?            @relation(fields: [taskId], references: [id])
}

model Event {
  id             String    @id @default(cuid())
  eventType      String
  workspaceId    String
  taskId         String
  runId          String?
  actorType      String
  actorId        String
  source         String
  payload        Json
  dedupeKey      String    @unique
  runtimeTs      DateTime?
  ingestSequence Int
  createdAt      DateTime  @default(now())
  workspace      Workspace @relation(fields: [workspaceId], references: [id])
  task           Task      @relation(fields: [taskId], references: [id])
  run            Run?      @relation(fields: [runId], references: [id])
}

model ConversationEntry {
  id          String   @id @default(cuid())
  runId       String
  role        String
  content     String
  runtimeTs   DateTime?
  sequence    Int
  externalRef String?  @unique
  createdAt   DateTime @default(now())
  run         Run      @relation(fields: [runId], references: [id])
}

model ToolCallDetail {
  id               String   @id @default(cuid())
  runId            String
  toolName         String
  status           String
  argumentsSummary String?
  resultSummary    String?
  errorSummary     String?
  runtimeTs        DateTime?
  externalRef      String?  @unique
  createdAt        DateTime @default(now())
  run              Run      @relation(fields: [runId], references: [id])
}

model TaskProjection {
  taskId               String   @id
  workspaceId          String
  persistedStatus      String
  displayState         String?
  blockType            String?
  blockScope           String?
  blockSince           DateTime?
  actionRequired       String?
  latestRunStatus      String?
  approvalPendingCount Int      @default(0)
  dueAt                DateTime?
  scheduledStartAt     DateTime?
  scheduledEndAt       DateTime?
  latestArtifactTitle  String?
  lastActivityAt       DateTime?
  updatedAt            DateTime @updatedAt
  workspace            Workspace @relation(fields: [workspaceId], references: [id])
  task                 Task      @relation(fields: [taskId], references: [id])
}

model RuntimeCursor {
  runId          String   @id
  runtimeName    String
  nextCursor     String?
  lastEventRef   String?
  lastSyncedAt   DateTime?
  healthStatus   String   @default("healthy")
  lastError      String?
  run            Run      @relation(fields: [runId], references: [id])
}
```

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 3: Seed a representative local workspace**

Create `prisma/seed.ts`:

```ts
import { PrismaClient, TaskPriority, TaskStatus, RunStatus, ApprovalStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspace = await prisma.workspace.upsert({
    where: { id: "ws_demo" },
    update: {},
    create: {
      id: "ws_demo",
      name: "Demo Workspace",
      description: "Seed data for the control-plane MVP",
      defaultRuntime: "openclaw",
      status: "Active",
    },
  });

  const runningTask = await prisma.task.upsert({
    where: { id: "task_projection" },
    update: {},
    create: {
      id: "task_projection",
      workspaceId: workspace.id,
      title: "Write task projection",
      description: "Build the Task Projection pipeline",
      status: TaskStatus.Running,
      priority: TaskPriority.High,
      ownerType: "human",
    },
  });

  const blockedTask = await prisma.task.upsert({
    where: { id: "task_adapter" },
    update: {},
    create: {
      id: "task_adapter",
      workspaceId: workspace.id,
      title: "Review adapter mapping",
      description: "Needs approval before applying file changes",
      status: TaskStatus.Blocked,
      priority: TaskPriority.Urgent,
      ownerType: "human",
    },
  });

  const run = await prisma.run.upsert({
    where: { id: "run_projection" },
    update: {},
    create: {
      id: "run_projection",
      taskId: runningTask.id,
      runtimeName: "openclaw",
      runtimeRunRef: "oc_run_projection",
      status: RunStatus.Running,
      triggeredBy: "user",
      startedAt: new Date(),
    },
  });

  await prisma.approval.upsert({
    where: { id: "approval_adapter" },
    update: {},
    create: {
      id: "approval_adapter",
      workspaceId: workspace.id,
      taskId: blockedTask.id,
      runId: run.id,
      type: "file_change",
      title: "Approve adapter patch",
      summary: "Apply OpenClaw mapping changes",
      riskLevel: "high",
      status: ApprovalStatus.Pending,
      requestedAt: new Date(),
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Apply the schema, seed the database, and run the smoke test**

Run:

```bash
npx prisma generate
npx prisma db push
npm run db:seed
npm run test -- src/modules/db/__tests__/schema-smoke.test.ts
```

Expected:
- Prisma client generates cleanly
- SQLite schema is created
- seed inserts demo data
- schema smoke test passes

- [ ] **Step 5: Commit the canonical schema**

Run:

```bash
git add prisma src/lib/db.ts src/modules/db .env.example
git commit -m "feat: add canonical control plane schema"
```

Expected: schema commit created successfully

## Task 4: Implement Task-State Derivation And Read Models

**Files:**
- Create: `src/modules/events/append-canonical-event.ts`
- Create: `src/modules/tasks/derive-task-state.ts`
- Create: `src/modules/projections/rebuild-task-projection.ts`
- Create: `src/modules/projections/get-work-projection.ts`
- Create: `src/modules/projections/__tests__/task-state.test.ts`

- [ ] **Step 1: Write failing projection tests for the core blocked-state rules**

Create `src/modules/projections/__tests__/task-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveTaskState } from "@/modules/tasks/derive-task-state";

describe("deriveTaskState", () => {
  it("marks the task blocked when the active run waits for approval", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_2" },
      runs: [
        { id: "run_1", status: "Failed", updatedAt: new Date("2026-04-08T09:00:00Z") },
        { id: "run_2", status: "WaitingForApproval", updatedAt: new Date("2026-04-08T10:00:00Z") },
      ],
      approvals: [{ status: "Pending", requestedAt: new Date("2026-04-08T10:00:00Z") }],
      sync: { stale: false },
    });

    expect(result.persistedStatus).toBe("Blocked");
    expect(result.displayState).toBe("WaitingForApproval");
    expect(result.blockReason?.actionRequired).toBe("Approve / Reject / Edit and Approve");
  });

  it("keeps sync-stale as a display state instead of overwriting the stored task status", () => {
    const result = deriveTaskState({
      task: { status: "Completed", latestRunId: "run_3" },
      runs: [{ id: "run_3", status: "Completed", updatedAt: new Date("2026-04-08T10:00:00Z") }],
      approvals: [],
      sync: { stale: true },
    });

    expect(result.persistedStatus).toBe("Completed");
    expect(result.displayState).toBe("Sync Stale");
  });
});
```

- [ ] **Step 2: Implement canonical event append and task-state derivation**

Create `src/modules/events/append-canonical-event.ts`:

```ts
import { db } from "@/lib/db";

type AppendCanonicalEventInput = {
  eventType: string;
  workspaceId: string;
  taskId: string;
  runId?: string;
  actorType: string;
  actorId: string;
  source: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  runtimeTs?: Date;
};

export async function appendCanonicalEvent(input: AppendCanonicalEventInput) {
  const latest = await db.event.aggregate({ _max: { ingestSequence: true } });

  return db.event.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      ...input,
      ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
    },
  });
}
```

Create `src/modules/tasks/derive-task-state.ts`:

```ts
type DeriveTaskStateInput = {
  task: { status: string; latestRunId?: string | null };
  runs: Array<{ id: string; status: string; updatedAt: Date }>;
  approvals: Array<{ status: string; requestedAt: Date }>;
  sync: { stale: boolean };
};

export function deriveTaskState(input: DeriveTaskStateInput) {
  const activeRun =
    input.runs.find((run) => run.id === input.task.latestRunId) ??
    [...input.runs].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

  if (input.sync.stale) {
    return {
      persistedStatus: input.task.status,
      displayState: "Sync Stale",
      blockReason: {
        blockType: "sync_stale",
        scope: "run",
        actionRequired: "Re-sync",
      },
    };
  }

  if (activeRun?.status === "WaitingForApproval") {
    return {
      persistedStatus: "Blocked",
      displayState: "WaitingForApproval",
      blockReason: {
        blockType: "waiting_for_approval",
        scope: "run",
        actionRequired: "Approve / Reject / Edit and Approve",
      },
    };
  }

  if (activeRun?.status === "WaitingForInput") {
    return {
      persistedStatus: "Blocked",
      displayState: "WaitingForInput",
      blockReason: {
        blockType: "waiting_for_input",
        scope: "run",
        actionRequired: "Provide Input",
      },
    };
  }

  if (activeRun?.status === "Running" || activeRun?.status === "Pending") {
    return { persistedStatus: "Running", displayState: null, blockReason: null };
  }

  if (activeRun?.status === "Failed") {
    return {
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
      blockReason: {
        blockType: "run_failed",
        scope: "run",
        actionRequired: "Retry Run",
      },
    };
  }

  if (activeRun?.status === "Completed") {
    return { persistedStatus: "Completed", displayState: null, blockReason: null };
  }

  return {
    persistedStatus: input.task.status,
    displayState: null,
    blockReason: input.approvals.some((approval) => approval.status === "Pending")
      ? {
          blockType: "approval_pending",
          scope: "task",
          actionRequired: "Open Work Page",
        }
      : null,
  };
}
```

- [ ] **Step 3: Implement task and work projections**

Create `src/modules/projections/rebuild-task-projection.ts`:

```ts
import { db } from "@/lib/db";
import { deriveTaskState } from "@/modules/tasks/derive-task-state";

export async function rebuildTaskProjection(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { orderBy: { updatedAt: "desc" } },
      approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const syncStale = task.runs.some(
    (run) => run.lastSyncedAt && Date.now() - run.lastSyncedAt.getTime() > 5 * 60 * 1000,
  );

  const derived = deriveTaskState({
    task: { status: task.status, latestRunId: task.latestRunId },
    runs: task.runs,
    approvals: task.approvals,
    sync: { stale: syncStale },
  });

  await db.task.update({
    where: { id: task.id },
    data: {
      status: derived.persistedStatus as never,
      blockReason: derived.blockReason ?? undefined,
    },
  });

  return db.taskProjection.upsert({
    where: { taskId: task.id },
    update: {
      workspaceId: task.workspaceId,
      persistedStatus: derived.persistedStatus,
      displayState: derived.displayState,
      blockType: derived.blockReason?.blockType,
      blockScope: derived.blockReason?.scope,
      actionRequired: derived.blockReason?.actionRequired,
      latestRunStatus: task.runs[0]?.status,
      approvalPendingCount: task.approvals.length,
      dueAt: task.dueAt,
      scheduledStartAt: task.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt,
      latestArtifactTitle: task.artifacts[0]?.title,
      lastActivityAt: task.runs[0]?.updatedAt ?? task.updatedAt,
    },
    create: {
      taskId: task.id,
      workspaceId: task.workspaceId,
      persistedStatus: derived.persistedStatus,
      displayState: derived.displayState,
      blockType: derived.blockReason?.blockType,
      blockScope: derived.blockReason?.scope,
      actionRequired: derived.blockReason?.actionRequired,
      latestRunStatus: task.runs[0]?.status,
      approvalPendingCount: task.approvals.length,
      dueAt: task.dueAt,
      scheduledStartAt: task.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt,
      latestArtifactTitle: task.artifacts[0]?.title,
      lastActivityAt: task.runs[0]?.updatedAt ?? task.updatedAt,
    },
  });
}
```

Create `src/modules/projections/get-work-projection.ts`:

```ts
import { db } from "@/lib/db";

export async function getWorkProjection(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 5 },
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }] },
      approvals: { orderBy: { requestedAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" } },
    },
  });

  const currentRun = task.runs[0] ?? null;

  return {
    taskShell: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      blockReason: task.blockReason,
    },
    currentRun,
    timeline: task.events,
    approvals: task.approvals,
    artifacts: task.artifacts,
  };
}
```

- [ ] **Step 4: Run the projection tests**

Run:

```bash
npm run test -- src/modules/projections/__tests__/task-state.test.ts
```

Expected: `2 passed`

- [ ] **Step 5: Commit the projection layer**

Run:

```bash
git add src/modules/events src/modules/tasks src/modules/projections
git commit -m "feat: add task state derivation and projections"
```

Expected: projection commit created successfully

## Task 5: Implement The OpenClaw Adapter, Mapper, And Incremental Sync

**Files:**
- Create: `src/modules/runtime/openclaw/adapter.ts`
- Create: `src/modules/runtime/openclaw/mock-adapter.ts`
- Create: `src/modules/runtime/openclaw/mapper.ts`
- Create: `src/modules/runtime/openclaw/sync-run.ts`
- Create: `src/modules/runtime/openclaw/fixtures/run-waiting-approval.json`
- Create: `src/modules/runtime/openclaw/fixtures/run-completed.json`
- Create: `src/modules/runtime/openclaw/__tests__/sync-run.test.ts`

- [ ] **Step 1: Write the failing sync test for idempotent canonical mapping**

Create `src/modules/runtime/openclaw/__tests__/sync-run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { syncRunFromRuntime } from "@/modules/runtime/openclaw/sync-run";

describe("syncRunFromRuntime", () => {
  it("maps approval waits into canonical records without duplicating events", async () => {
    const adapter = {
      listEvents: vi.fn().mockResolvedValue({
        nextCursor: "cursor_2",
        items: [
          {
            id: "evt_approval_1",
            kind: "approval_requested",
            timestamp: "2026-04-08T10:00:00Z",
            title: "Approve patch",
            summary: "Write projection patch",
            riskLevel: "high",
          },
        ],
      }),
    };

    const workspace = await db.workspace.create({
      data: { name: "Sync Test", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Projection task",
        status: "Running",
        priority: "High",
        ownerType: "human",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_1",
        status: "Running",
        triggeredBy: "user",
      },
    });

    await syncRunFromRuntime({ runId: run.id, adapter: adapter as never });
    await syncRunFromRuntime({ runId: run.id, adapter: adapter as never });

    const events = await db.event.findMany({ where: { runId: run.id } });
    const approvals = await db.approval.findMany({ where: { runId: run.id } });

    expect(events.filter((event) => event.eventType === "approval.requested")).toHaveLength(1);
    expect(approvals).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement the live adapter factory and the mock adapter**

Create `src/modules/runtime/openclaw/adapter.ts`:

```ts
import { OpenClawHttpClient } from "@/modules/runtime/openclaw/client";
import { createMockOpenClawAdapter } from "@/modules/runtime/openclaw/mock-adapter";

export type RuntimeAdapter = {
  createRun(input: { prompt: string }): Promise<{ runtimeRunRef: string; runtimeSessionRef?: string }>;
  listEvents(runtimeRunRef: string, cursor?: string): Promise<{ nextCursor?: string; items: Array<Record<string, unknown>> }>;
  getRun(runtimeRunRef: string): Promise<Record<string, unknown>>;
  resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }): Promise<{ accepted: boolean }>;
};

export function createRuntimeAdapter(): RuntimeAdapter {
  if (process.env.OPENCLAW_MODE === "mock") {
    return createMockOpenClawAdapter();
  }

  return new OpenClawHttpClient(
    process.env.OPENCLAW_BASE_URL!,
    process.env.OPENCLAW_API_KEY!,
  );
}
```

Create `src/modules/runtime/openclaw/mock-adapter.ts`:

```ts
export function createMockOpenClawAdapter() {
  return {
    async createRun() {
      return { runtimeRunRef: `mock_${Date.now()}`, runtimeSessionRef: "mock_session" };
    },
    async getRun(runtimeRunRef: string) {
      return { runtimeRunRef, status: "Running" };
    },
    async listEvents() {
      return {
        nextCursor: "mock_cursor_1",
        items: [
          {
            id: "mock_evt_1",
            kind: "message",
            timestamp: new Date().toISOString(),
            role: "assistant",
            content: "Drafting the task projection module.",
          },
        ],
      };
    },
    async resumeRun() {
      return { accepted: true };
    },
  };
}
```

- [ ] **Step 3: Implement runtime mapping and sync orchestration**

Create `src/modules/runtime/openclaw/mapper.ts`:

```ts
export function mapRuntimeEvent(input: {
  workspaceId: string;
  taskId: string;
  runId: string;
  event: Record<string, unknown>;
}) {
  switch (input.event.kind) {
    case "approval_requested":
      return {
        eventType: "approval.requested",
        payload: {
          approval_id: String(input.event.id),
          approval_type: "file_change",
          title: String(input.event.title ?? "Approval requested"),
          summary: String(input.event.summary ?? ""),
          risk_level: String(input.event.riskLevel ?? "medium"),
        },
        approval: {
          id: String(input.event.id),
          type: "file_change",
          title: String(input.event.title ?? "Approval requested"),
          summary: String(input.event.summary ?? ""),
          riskLevel: String(input.event.riskLevel ?? "medium"),
          status: "Pending",
        },
      };
    case "tool_started":
      return {
        eventType: "tool.called",
        payload: {
          tool_name: String(input.event.toolName),
          arguments_summary: String(input.event.argumentsSummary ?? ""),
        },
      };
    case "tool_finished":
      return {
        eventType: "tool.completed",
        payload: {
          tool_name: String(input.event.toolName),
          success: Boolean(input.event.success),
          result_summary: String(input.event.resultSummary ?? ""),
        },
      };
    default:
      return {
        eventType: "task.updated",
        payload: { raw_kind: input.event.kind },
      };
  }
}
```

Create `src/modules/runtime/openclaw/sync-run.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { mapRuntimeEvent } from "@/modules/runtime/openclaw/mapper";

export async function syncRunFromRuntime(input: {
  runId: string;
  adapter: {
    listEvents(runtimeRunRef: string, cursor?: string): Promise<{ nextCursor?: string; items: Array<Record<string, unknown>> }>;
  };
}) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: input.runId },
    include: { task: true },
  });

  if (!run.runtimeRunRef) {
    throw new Error(`Run ${run.id} is missing runtimeRunRef`);
  }

  const cursor = await db.runtimeCursor.findUnique({ where: { runId: run.id } });
  const page = await input.adapter.listEvents(run.runtimeRunRef, cursor?.nextCursor ?? undefined);

  for (const event of page.items) {
    const mapped = mapRuntimeEvent({
      workspaceId: run.task.workspaceId,
      taskId: run.taskId,
      runId: run.id,
      event,
    });

    await appendCanonicalEvent({
      eventType: mapped.eventType,
      workspaceId: run.task.workspaceId,
      taskId: run.taskId,
      runId: run.id,
      actorType: "runtime",
      actorId: run.runtimeName,
      source: "adapter",
      payload: mapped.payload,
      dedupeKey: `${mapped.eventType}:${String(event.id ?? crypto.randomUUID())}`,
      runtimeTs: event.timestamp ? new Date(String(event.timestamp)) : undefined,
    });

    if (mapped.approval) {
      await db.approval.upsert({
        where: { id: mapped.approval.id },
        update: {},
        create: {
          id: mapped.approval.id,
          workspaceId: run.task.workspaceId,
          taskId: run.taskId,
          runId: run.id,
          type: mapped.approval.type,
          title: mapped.approval.title,
          summary: mapped.approval.summary,
          riskLevel: mapped.approval.riskLevel,
          status: mapped.approval.status as never,
          requestedAt: event.timestamp ? new Date(String(event.timestamp)) : new Date(),
        },
      });
    }
  }

  await db.run.update({
    where: { id: run.id },
    data: {
      lastSyncedAt: new Date(),
      syncStatus: "healthy",
    },
  });

  await db.runtimeCursor.upsert({
    where: { runId: run.id },
    update: {
      nextCursor: page.nextCursor,
      lastSyncedAt: new Date(),
      healthStatus: "healthy",
    },
    create: {
      runId: run.id,
      runtimeName: run.runtimeName,
      nextCursor: page.nextCursor,
      lastSyncedAt: new Date(),
      healthStatus: "healthy",
    },
  });

  await rebuildTaskProjection(run.taskId);
}
```

- [ ] **Step 4: Run the sync test**

Run:

```bash
npm run test -- src/modules/runtime/openclaw/__tests__/sync-run.test.ts
```

Expected: `1 passed`

- [ ] **Step 5: Commit the adapter layer**

Run:

```bash
git add src/modules/runtime/openclaw
git commit -m "feat: add openclaw adapter sync pipeline"
```

Expected: adapter commit created successfully

## Task 6: Implement Command Chain, Query Loaders, And Work Polling Endpoint

**Files:**
- Create: `src/modules/commands/update-task.ts`
- Create: `src/modules/commands/start-run.ts`
- Create: `src/modules/commands/retry-run.ts`
- Create: `src/modules/commands/resume-run.ts`
- Create: `src/modules/commands/resolve-approval.ts`
- Create: `src/modules/commands/provide-input.ts`
- Create: `src/modules/queries/get-workspaces.ts`
- Create: `src/modules/queries/get-workspace-overview.ts`
- Create: `src/modules/queries/get-task-center.ts`
- Create: `src/modules/queries/get-task-page.ts`
- Create: `src/modules/queries/get-work-page.ts`
- Create: `src/modules/queries/get-inbox.ts`
- Create: `src/modules/queries/get-memory-console.ts`
- Create: `src/modules/commands/__tests__/command-chain.test.ts`
- Create: `src/app/actions/task-actions.ts`
- Create: `src/app/api/work/[taskId]/projection/route.ts`

- [ ] **Step 1: Write the failing command-chain test**

Create `src/modules/commands/__tests__/command-chain.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";

describe("startRun", () => {
  it("creates the local run before calling the adapter", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Commands", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Start a run",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const adapter = {
      createRun: vi.fn(async () => {
        const pendingRun = await db.run.findFirstOrThrow({ where: { taskId: task.id } });
        expect(pendingRun.status).toBe("Pending");
        return { runtimeRunRef: "runtime_123" };
      }),
    };

    const result = await startRun({ taskId: task.id, prompt: "Implement projection", adapter: adapter as never });

    expect(result.runtimeRunRef).toBe("runtime_123");
    expect(adapter.createRun).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement the core commands**

Create `src/modules/commands/start-run.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { syncRunFromRuntime } from "@/modules/runtime/openclaw/sync-run";

export async function startRun(input: {
  taskId: string;
  prompt: string;
  adapter: { createRun(input: { prompt: string }): Promise<{ runtimeRunRef: string; runtimeSessionRef?: string }>; listEvents: never };
}) {
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });

  const run = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "openclaw",
      status: "Pending",
      triggeredBy: "user",
      startedAt: new Date(),
    },
  });

  const created = await input.adapter.createRun({ prompt: input.prompt });

  await db.run.update({
    where: { id: run.id },
    data: {
      runtimeRunRef: created.runtimeRunRef,
      runtimeSessionRef: created.runtimeSessionRef,
      status: "Running",
    },
  });

  await db.task.update({
    where: { id: task.id },
    data: {
      latestRunId: run.id,
      status: "Running",
    },
  });

  await appendCanonicalEvent({
    eventType: "run.started",
    workspaceId: task.workspaceId,
    taskId: task.id,
    runId: run.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      runtime_name: "openclaw",
      runtime_run_ref: created.runtimeRunRef,
      triggered_by: "user",
    },
    dedupeKey: `run.started:${run.id}`,
  });

  await rebuildTaskProjection(task.id);

  return { runId: run.id, runtimeRunRef: created.runtimeRunRef };
}
```

Create `src/modules/commands/update-task.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function updateTask(input: {
  taskId: string;
  title: string;
  description?: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.updated",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      changed_fields: ["title", "description", "priority", "dueAt", "scheduledStartAt", "scheduledEndAt"],
    },
    dedupeKey: `task.updated:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);
}
```

Create `src/modules/commands/retry-run.ts`:

```ts
import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";

export async function retryRun(input: {
  taskId: string;
  prompt: string;
  adapter: {
    createRun(input: { prompt: string }): Promise<{ runtimeRunRef: string; runtimeSessionRef?: string }>;
    listEvents: never;
  };
}) {
  const latestRun = await db.run.findFirst({
    where: { taskId: input.taskId },
    orderBy: { createdAt: "desc" },
  });

  if (!latestRun) {
    throw new Error("Cannot retry a task that has never run.");
  }

  if (!["Failed", "Cancelled", "Completed"].includes(latestRun.status)) {
    throw new Error("Retry is only allowed after a stopped run.");
  }

  return startRun(input);
}
```

Create `src/modules/commands/resume-run.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { syncRunFromRuntime } from "@/modules/runtime/openclaw/sync-run";

export async function resumeRun(input: {
  runId: string;
  approvalId?: string;
  inputText?: string;
  adapter: {
    resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }): Promise<{ accepted: boolean }>;
    listEvents(runtimeRunRef: string, cursor?: string): Promise<{ nextCursor?: string; items: Array<Record<string, unknown>> }>;
  };
}) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: input.runId },
    include: { task: true },
  });

  if (!["WaitingForApproval", "WaitingForInput"].includes(run.status)) {
    throw new Error("Resume is only allowed for blocked runs.");
  }

  if (!run.runtimeRunRef) {
    throw new Error("Cannot resume a run without a runtime reference.");
  }

  const resumed = await input.adapter.resumeRun({
    runtimeRunRef: run.runtimeRunRef,
    approvalId: input.approvalId,
    inputText: input.inputText,
  });

  if (!resumed.accepted) {
    throw new Error("Runtime rejected the resume request.");
  }

  await db.run.update({
    where: { id: run.id },
    data: {
      status: "Running",
      pendingInputPrompt: null,
      pendingInputType: null,
      syncStatus: "healthy",
    },
  });

  await db.task.update({
    where: { id: run.taskId },
    data: { status: "Running", blockReason: null },
  });

  await appendCanonicalEvent({
    eventType: "task.status_changed",
    workspaceId: run.task.workspaceId,
    taskId: run.taskId,
    runId: run.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_status: run.task.status,
      next_status: "Running",
      resume_reason: input.approvalId ? "approval_resolved" : "input_provided",
    },
    dedupeKey: `task.status_changed:${run.id}:${Date.now()}`,
  });

  await syncRunFromRuntime({ runId: run.id, adapter: input.adapter as never });
  await rebuildTaskProjection(run.taskId);

  return {
    taskId: run.taskId,
    workspaceId: run.task.workspaceId,
    runId: run.id,
  };
}
```

Create `src/modules/commands/resolve-approval.ts`:

```ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { resumeRun } from "@/modules/commands/resume-run";

export async function resolveApproval(input: {
  approvalId: string;
  decision: "Approved" | "Rejected" | "EditedAndApproved";
  resolutionNote?: string;
  editedContent?: string;
  adapter: {
    resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }): Promise<{ accepted: boolean }>;
    listEvents(runtimeRunRef: string, cursor?: string): Promise<{ nextCursor?: string; items: Array<Record<string, unknown>> }>;
  };
}) {
  const approval = await db.approval.findUniqueOrThrow({
    where: { id: input.approvalId },
    include: { task: true, run: true },
  });

  if (approval.status !== "Pending") {
    throw new Error("Only pending approvals can be resolved.");
  }

  await db.approval.update({
    where: { id: approval.id },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolvedBy: "server-action",
      resolutionNote: input.resolutionNote,
    },
  });

  await appendCanonicalEvent({
    eventType: "approval.resolved",
    workspaceId: approval.workspaceId,
    taskId: approval.taskId,
    runId: approval.runId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      approval_id: approval.id,
      decision: input.decision,
      resolution_note: input.resolutionNote,
    },
    dedupeKey: `approval.resolved:${approval.id}`,
  });

  if (input.decision === "Rejected") {
    await db.run.update({
      where: { id: approval.runId },
      data: { status: "Failed", retryable: true },
    });
    await db.task.update({
      where: { id: approval.taskId },
      data: {
        status: "Blocked",
        blockReason: {
          blockType: "approval_rejected",
          scope: "task",
          actionRequired: "Re-plan / Create New Run",
        },
      },
    });
    await rebuildTaskProjection(approval.taskId);

    return {
      taskId: approval.taskId,
      workspaceId: approval.task.workspaceId,
      runId: approval.runId,
    };
  }

  return resumeRun({
    runId: approval.runId,
    approvalId: approval.id,
    inputText: input.editedContent,
    adapter: input.adapter,
  });
}
```

Create `src/modules/commands/provide-input.ts`:

```ts
import { db } from "@/lib/db";
import { resumeRun } from "@/modules/commands/resume-run";

export async function provideInput(input: {
  runId: string;
  inputText: string;
  adapter: {
    resumeRun(input: { runtimeRunRef: string; approvalId?: string; inputText?: string }): Promise<{ accepted: boolean }>;
    listEvents(runtimeRunRef: string, cursor?: string): Promise<{ nextCursor?: string; items: Array<Record<string, unknown>> }>;
  };
}) {
  const run = await db.run.findUniqueOrThrow({ where: { id: input.runId } });

  if (run.status !== "WaitingForInput") {
    throw new Error("Input can only be provided when the run is waiting for input.");
  }

  return resumeRun({
    runId: run.id,
    inputText: input.inputText,
    adapter: input.adapter,
  });
}
```

- [ ] **Step 3: Implement read queries and the polling route**

Create `src/modules/queries/get-workspace-overview.ts`:

```ts
import { db } from "@/lib/db";

export async function getWorkspaceOverview(workspaceId: string) {
  const projections = await db.taskProjection.findMany({
    where: { workspaceId },
    orderBy: { lastActivityAt: "desc" },
  });

  return {
    running: projections.filter((item) => item.persistedStatus === "Running"),
    waitingForApproval: projections.filter((item) => item.displayState === "WaitingForApproval"),
    blockedOrFailed: projections.filter(
      (item) => item.persistedStatus === "Blocked" || item.persistedStatus === "Failed",
    ),
    upcomingDeadlines: projections.filter((item) => Boolean(item.dueAt)).slice(0, 5),
    recentlyUpdated: projections.slice(0, 5),
  };
}
```

Create `src/modules/queries/get-task-center.ts`:

```ts
import { db } from "@/lib/db";

export async function getTaskCenter(filter?: "Running" | "WaitingForApproval" | "Blocked" | "Failed") {
  const projections = await db.taskProjection.findMany({
    include: { task: true },
    orderBy: [{ lastActivityAt: "desc" }],
  });

  return projections.filter((item) => {
    if (!filter) return true;
    if (filter === "WaitingForApproval") return item.displayState === "WaitingForApproval";
    return item.persistedStatus === filter;
  });
}
```

Create `src/app/api/work/[taskId]/projection/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createRuntimeAdapter } from "@/modules/runtime/openclaw/adapter";
import { getWorkProjection } from "@/modules/projections/get-work-projection";
import { db } from "@/lib/db";
import { syncRunFromRuntime } from "@/modules/runtime/openclaw/sync-run";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const currentRun = task.runs[0];
  if (currentRun && ["Pending", "Running", "WaitingForApproval", "WaitingForInput"].includes(currentRun.status)) {
    await syncRunFromRuntime({ runId: currentRun.id, adapter: createRuntimeAdapter() });
  }

  return NextResponse.json(await getWorkProjection(taskId));
}
```

Create `src/app/actions/task-actions.ts` with `"use server"` wrappers around `updateTask`, `startRun`, `retryRun`, `resumeRun`, `resolveApproval`, `provideInput`, and `revalidatePath`.

- [ ] **Step 4: Run the command-chain test**

Run:

```bash
npm run test -- src/modules/commands/__tests__/command-chain.test.ts
```

Expected: `1 passed`

- [ ] **Step 5: Commit the command and query layer**

Run:

```bash
git add src/modules/commands src/modules/queries src/app/actions src/app/api/work
git commit -m "feat: add command chain and query loaders"
```

Expected: command/query commit created successfully

## Task 7: Build The Workspace Overview And Task Center

**Files:**
- Create: `src/app/workspaces/page.tsx`
- Create: `src/app/workspaces/[workspaceId]/page.tsx`
- Create: `src/app/tasks/page.tsx`
- Create: `src/components/workspaces/workspace-overview.tsx`
- Create: `src/components/tasks/task-center-table.tsx`
- Create: `src/components/workspaces/__tests__/workspace-overview.test.tsx`

- [ ] **Step 1: Write the failing workspace overview component test**

Create `src/components/workspaces/__tests__/workspace-overview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";

describe("WorkspaceOverview", () => {
  it("shows the triage sections required by the spec", () => {
    render(
      <WorkspaceOverview
        data={{
          running: [],
          waitingForApproval: [],
          blockedOrFailed: [],
          upcomingDeadlines: [],
          recentlyUpdated: [],
        }}
      />,
    );

    expect(screen.getByText("Running Tasks")).toBeInTheDocument();
    expect(screen.getByText("Waiting for Approval")).toBeInTheDocument();
    expect(screen.getByText("Blocked / Failed Tasks")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Deadlines")).toBeInTheDocument();
    expect(screen.getByText("Recently Updated Tasks")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the overview and task center components**

Create `src/components/workspaces/workspace-overview.tsx`:

```tsx
type WorkspaceOverviewProps = {
  data: {
    running: Array<{ taskId: string; latestRunStatus: string | null }>;
    waitingForApproval: Array<{ taskId: string; actionRequired: string | null }>;
    blockedOrFailed: Array<{ taskId: string; persistedStatus: string }>;
    upcomingDeadlines: Array<{ taskId: string; dueAt: Date | null }>;
    recentlyUpdated: Array<{ taskId: string; lastActivityAt: Date | null }>;
  };
};

export function WorkspaceOverview({ data }: WorkspaceOverviewProps) {
  const sections = [
    { title: "Running Tasks", items: data.running },
    { title: "Waiting for Approval", items: data.waitingForApproval },
    { title: "Blocked / Failed Tasks", items: data.blockedOrFailed },
    { title: "Upcoming Deadlines", items: data.upcomingDeadlines },
    { title: "Recently Updated Tasks", items: data.recentlyUpdated },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <section key={section.title} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-white">{section.title}</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            {section.items.length === 0 ? <p>No items</p> : section.items.map((item) => <pre key={item.taskId}>{item.taskId}</pre>)}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Create `src/components/tasks/task-center-table.tsx`:

```tsx
import Link from "next/link";

type TaskCenterTableProps = {
  rows: Array<{
    taskId: string;
    title: string;
    persistedStatus: string;
    displayState: string | null;
    latestRunStatus: string | null;
    actionRequired: string | null;
    dueAt: Date | null;
    updatedAt: Date;
    workspaceId: string;
  }>;
};

export function TaskCenterTable({ rows }: TaskCenterTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <table className="w-full text-left text-sm text-slate-200">
        <thead className="bg-slate-950/60 text-slate-400">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Latest Run</th>
            <th className="px-4 py-3">Block Reason</th>
            <th className="px-4 py-3">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.taskId} className="border-t border-slate-800">
              <td className="px-4 py-3">
                <Link href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`} className="font-medium hover:text-white">
                  {row.title}
                </Link>
              </td>
              <td className="px-4 py-3">{row.displayState ?? row.persistedStatus}</td>
              <td className="px-4 py-3">{row.latestRunStatus ?? "No run"}</td>
              <td className="px-4 py-3">{row.actionRequired ?? "-"}</td>
              <td className="px-4 py-3">{row.dueAt ? row.dueAt.toISOString().slice(0, 10) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Implement the server pages**

Create `src/app/workspaces/page.tsx`:

```tsx
import Link from "next/link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function WorkspacesPage() {
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        {workspaces.map((workspace) => (
          <Link key={workspace.id} href={`/workspaces/${workspace.id}`} className="block rounded-xl border border-slate-800 p-4">
            {workspace.name}
          </Link>
        ))}
      </div>
    </ControlPlaneShell>
  );
}
```

Create `src/app/workspaces/[workspaceId]/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";
import { getWorkspaceOverview } from "@/modules/queries/get-workspace-overview";

export default async function WorkspacePage(
  props: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await props.params;
  const data = await getWorkspaceOverview(workspaceId);

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">Workspace Overview</h1>
        <WorkspaceOverview data={data} />
      </div>
    </ControlPlaneShell>
  );
}
```

Create `src/app/tasks/page.tsx`:

```tsx
import Link from "next/link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskCenterTable } from "@/components/tasks/task-center-table";
import { getTaskCenter } from "@/modules/queries/get-task-center";

const FILTERS = ["Running", "WaitingForApproval", "Blocked", "Failed"] as const;

export default async function TasksPage(
  props: { searchParams?: Promise<{ status?: string }> },
) {
  const searchParams = (await props.searchParams) ?? {};
  const activeFilter = FILTERS.includes(searchParams.status as (typeof FILTERS)[number])
    ? (searchParams.status as (typeof FILTERS)[number])
    : undefined;
  const rows = await getTaskCenter(activeFilter);

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/tasks" className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300">
            All
          </Link>
          {FILTERS.map((filter) => (
            <Link
              key={filter}
              href={`/tasks?status=${filter}`}
              className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300"
            >
              {filter}
            </Link>
          ))}
        </div>
        <TaskCenterTable rows={rows} />
      </div>
    </ControlPlaneShell>
  );
}
```

- [ ] **Step 4: Run the workspace overview test**

Run:

```bash
npm run test -- src/components/workspaces/__tests__/workspace-overview.test.tsx
```

Expected: `1 passed`

- [ ] **Step 5: Commit the overview and task center**

Run:

```bash
git add src/app/workspaces src/app/tasks src/components/workspaces src/components/tasks
git commit -m "feat: add workspace overview and task center"
```

Expected: overview/task-center commit created successfully

## Task 8: Build The Task Page As The Planning And Control Surface

**Files:**
- Create: `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`
- Create: `src/components/tasks/task-page.tsx`
- Create: `src/components/tasks/__tests__/task-page.test.tsx`

- [ ] **Step 1: Write the failing task page test**

Create `src/components/tasks/__tests__/task-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { TaskPage } from "@/components/tasks/task-page";

describe("TaskPage", () => {
  it("shows planning controls plus entry points into the work surface", () => {
    render(
      <TaskPage
        data={{
          task: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
            description: "Plan the read model",
            status: "Blocked",
            priority: "High",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          latestRunSummary: { status: "WaitingForApproval", startedAt: new Date().toISOString() },
          approvals: [],
          artifacts: [],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Start Run" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Work Page" })).toHaveAttribute(
      "href",
      "/workspaces/ws_1/work/task_1",
    );
    expect(screen.getByText("Block Reason")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the task page component**

Create `src/components/tasks/task-page.tsx`:

```tsx
import Link from "next/link";

type TaskPageProps = {
  data: {
    task: {
      id: string;
      workspaceId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      blockReason: { actionRequired?: string } | null;
    };
    latestRunSummary: { status: string; startedAt?: string | null } | null;
    approvals: Array<{ id: string; title: string; status: string }>;
    artifacts: Array<{ id: string; title: string; type: string }>;
  };
};

export function TaskPage({ data }: TaskPageProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-white">{data.task.title}</h1>
          <p className="text-sm text-slate-300">{data.task.description}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 p-4">
            <h2 className="text-sm font-semibold text-white">Task Control</h2>
            <p className="mt-2 text-sm text-slate-300">Status: {data.task.status}</p>
            <p className="text-sm text-slate-300">Priority: {data.task.priority}</p>
          </div>
          <div className="rounded-lg border border-slate-800 p-4">
            <h2 className="text-sm font-semibold text-white">Scheduling</h2>
            <p className="mt-2 text-sm text-slate-300">Due: {data.task.dueAt ?? "-"}</p>
            <p className="text-sm text-slate-300">Start: {data.task.scheduledStartAt ?? "-"}</p>
            <p className="text-sm text-slate-300">End: {data.task.scheduledEndAt ?? "-"}</p>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-white">Block Reason</h2>
          <p className="mt-2 text-sm text-slate-300">{data.task.blockReason?.actionRequired ?? "No block"}</p>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-white">Actions</h2>
          <div className="mt-3 flex flex-col gap-2">
            <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white">Start Run</button>
            <Link href={`/workspaces/${data.task.workspaceId}/work/${data.task.id}`} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">
              Open Work Page
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Implement the server page loader**

Create `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskPage } from "@/components/tasks/task-page";
import { getTaskPage } from "@/modules/queries/get-task-page";

export default async function TaskDetailPage(
  props: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await props.params;
  const data = await getTaskPage(taskId);

  return (
    <ControlPlaneShell>
      <TaskPage data={data} />
    </ControlPlaneShell>
  );
}
```

Create `src/modules/queries/get-task-page.ts`:

```ts
import { db } from "@/lib/db";

export async function getTaskPage(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
      artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  const latestRun = task.runs[0] ?? null;

  return {
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
      blockReason:
        (task.blockReason as { blockType?: string; actionRequired?: string; scope?: string; since?: string } | null) ??
        (task.projection
          ? {
              blockType: task.projection.blockType,
              actionRequired: task.projection.actionRequired,
              scope: task.projection.blockScope,
              since: task.projection.blockSince?.toISOString(),
            }
          : null),
    },
    latestRunSummary: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          syncStatus: latestRun.syncStatus,
        }
      : null,
    approvals: task.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
    })),
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
    })),
  };
}
```

- [ ] **Step 4: Run the task page test**

Run:

```bash
npm run test -- src/components/tasks/__tests__/task-page.test.tsx
```

Expected: `1 passed`

- [ ] **Step 5: Commit the task page**

Run:

```bash
git add src/app/workspaces/[workspaceId]/tasks src/components/tasks src/modules/queries/get-task-page.ts
git commit -m "feat: add task planning page"
```

Expected: task-page commit created successfully

## Task 9: Build The Work Page As The Execution Surface

**Files:**
- Create: `src/app/workspaces/[workspaceId]/work/[taskId]/page.tsx`
- Create: `src/components/work/work-page-client.tsx`
- Create: `src/components/work/execution-timeline.tsx`
- Create: `src/components/work/conversation-panel.tsx`
- Create: `src/components/work/run-side-panel.tsx`
- Create: `src/components/work/__tests__/work-page.test.tsx`

- [ ] **Step 1: Write the failing work page test**

Create `src/components/work/__tests__/work-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { WorkPageClient } from "@/components/work/work-page-client";

describe("WorkPageClient", () => {
  it("renders the timeline as the primary surface with conversation as secondary", () => {
    render(
      <WorkPageClient
        initialData={{
          taskShell: {
            id: "task_1",
            workspaceId: "ws_1",
            title: "Write projection",
            status: "Blocked",
            priority: "High",
            dueAt: null,
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          currentRun: { id: "run_1", status: "WaitingForApproval" },
          timeline: [],
          conversation: [],
          approvals: [],
          artifacts: [],
          toolCalls: [],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Execution Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending Approvals" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the responsive three-pane work page**

Create `src/components/work/execution-timeline.tsx`:

```tsx
type ExecutionTimelineProps = {
  events: Array<{ id: string; eventType: string; createdAt?: string; payload: Record<string, unknown> }>;
};

export function ExecutionTimeline({ events }: ExecutionTimelineProps) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-white">Execution Timeline</h2>
      <div className="mt-3 space-y-3 text-sm text-slate-300">
        {events.length === 0 ? <p>No events yet.</p> : events.map((event) => <pre key={event.id}>{event.eventType}</pre>)}
      </div>
    </section>
  );
}
```

Create `src/components/work/conversation-panel.tsx`:

```tsx
type ConversationPanelProps = {
  entries: Array<{ id: string; role: string; content: string }>;
};

export function ConversationPanel({ entries }: ConversationPanelProps) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold text-white">Conversation</h2>
      <div className="mt-3 space-y-3 text-sm text-slate-300">
        {entries.length === 0 ? <p>No conversation mapped yet.</p> : entries.map((entry) => <pre key={entry.id}>{entry.role}: {entry.content}</pre>)}
      </div>
    </section>
  );
}
```

Create `src/components/work/run-side-panel.tsx`:

```tsx
type RunSidePanelProps = {
  currentRun: { id: string; status: string } | null;
  approvals: Array<{ id: string; title: string; status: string }>;
  artifacts: Array<{ id: string; title: string; type: string }>;
  toolCalls: Array<{ id: string; toolName: string; status: string }>;
};

export function RunSidePanel({ currentRun, approvals, artifacts, toolCalls }: RunSidePanelProps) {
  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-white">Current Run</h2>
        <p className="mt-2 text-sm text-slate-300">{currentRun?.status ?? "No run"}</p>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-white">Pending Approvals</h2>
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          {approvals.length === 0 ? <p>No pending approvals.</p> : approvals.map((approval) => <pre key={approval.id}>{approval.title}</pre>)}
        </div>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-white">Artifacts</h2>
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          {artifacts.length === 0 ? <p>No artifacts.</p> : artifacts.map((artifact) => <pre key={artifact.id}>{artifact.title}</pre>)}
        </div>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-white">Tool Activity</h2>
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          {toolCalls.length === 0 ? <p>No tool calls.</p> : toolCalls.map((tool) => <pre key={tool.id}>{tool.toolName} ({tool.status})</pre>)}
        </div>
      </section>
    </aside>
  );
}
```

Create `src/components/work/work-page-client.tsx`:

```tsx
"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { ConversationPanel } from "@/components/work/conversation-panel";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { RunSidePanel } from "@/components/work/run-side-panel";

type WorkPageClientProps = {
  initialData: {
    taskShell: {
      id: string;
      workspaceId: string;
      title: string;
      status: string;
      priority: string;
      dueAt: string | null;
      blockReason: { actionRequired?: string } | null;
    };
    currentRun: { id: string; status: string } | null;
    timeline: Array<{ id: string; eventType: string; payload: Record<string, unknown> }>;
    conversation: Array<{ id: string; role: string; content: string }>;
    approvals: Array<{ id: string; title: string; status: string }>;
    artifacts: Array<{ id: string; title: string; type: string }>;
    toolCalls: Array<{ id: string; toolName: string; status: string }>;
  };
};

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const [data, setData] = useState(initialData);

  const refresh = useEffectEvent(async () => {
    const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });
    const next = await response.json();
    startTransition(() => setData(next));
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000));

    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h1 className="text-lg font-semibold text-white">{data.taskShell.title}</h1>
        <p className="text-sm text-slate-300">Status: {data.taskShell.status}</p>
        <p className="text-sm text-slate-300">Priority: {data.taskShell.priority}</p>
        <p className="text-sm text-slate-300">Next action: {data.taskShell.blockReason?.actionRequired ?? "Observe timeline"}</p>
      </aside>
      <div className="space-y-4">
        <ExecutionTimeline events={data.timeline} />
        <ConversationPanel entries={data.conversation} />
      </div>
      <RunSidePanel
        currentRun={data.currentRun}
        approvals={data.approvals}
        artifacts={data.artifacts}
        toolCalls={data.toolCalls}
      />
    </div>
  );
}
```

- [ ] **Step 3: Implement the work page server loader**

Create `src/app/workspaces/[workspaceId]/work/[taskId]/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkPageClient } from "@/components/work/work-page-client";
import { getWorkPage } from "@/modules/queries/get-work-page";

export default async function WorkPage(
  props: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await props.params;
  const data = await getWorkPage(taskId);

  return (
    <ControlPlaneShell>
      <WorkPageClient initialData={data} />
    </ControlPlaneShell>
  );
}
```

Create `src/modules/queries/get-work-page.ts`:

```ts
import { db } from "@/lib/db";

export async function getWorkPage(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }], take: 100 },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          approvals: { orderBy: { requestedAt: "desc" } },
          artifacts: { orderBy: { createdAt: "desc" } },
          conversationEntries: { orderBy: { sequence: "asc" } },
          toolCallDetails: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const currentRun = task.runs[0] ?? null;

  return {
    taskShell: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.projection?.displayState ?? task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      blockReason:
        (task.blockReason as { actionRequired?: string } | null) ??
        (task.projection ? { actionRequired: task.projection.actionRequired ?? undefined } : null),
    },
    currentRun: currentRun
      ? {
          id: currentRun.id,
          status: currentRun.status,
        }
      : null,
    timeline: task.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      payload: event.payload as Record<string, unknown>,
    })),
    conversation:
      currentRun?.conversationEntries.map((entry) => ({
        id: entry.id,
        role: entry.role,
        content: entry.content,
      })) ?? [],
    toolCalls:
      currentRun?.toolCallDetails.map((tool) => ({
        id: tool.id,
        toolName: tool.toolName,
        status: tool.status,
      })) ?? [],
    approvals:
      currentRun?.approvals.map((approval) => ({
        id: approval.id,
        title: approval.title,
        status: approval.status,
      })) ?? [],
    artifacts:
      currentRun?.artifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
      })) ?? [],
  };
}
```

- [ ] **Step 4: Run the work page test**

Run:

```bash
npm run test -- src/components/work/__tests__/work-page.test.tsx
```

Expected: `1 passed`

- [ ] **Step 5: Commit the work page**

Run:

```bash
git add src/app/workspaces/[workspaceId]/work src/components/work src/modules/queries/get-work-page.ts
git commit -m "feat: add work execution page"
```

Expected: work-page commit created successfully

## Task 10: Build Inbox, Memory, Recovery Actions, And Final Verification

**Files:**
- Create: `src/app/inbox/page.tsx`
- Create: `src/app/memory/page.tsx`
- Create: `src/app/settings/page.tsx`
- Create: `src/components/inbox/inbox-list.tsx`
- Create: `src/components/memory/memory-console.tsx`
- Create: `src/components/inbox/__tests__/inbox-list.test.tsx`
- Create: `src/components/memory/__tests__/memory-console.test.tsx`
- Create: `e2e/control-plane.spec.ts`

- [ ] **Step 1: Write failing inbox and memory tests**

Create `src/components/inbox/__tests__/inbox-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { InboxList } from "@/components/inbox/inbox-list";

describe("InboxList", () => {
  it("shows action type, risk, task, run, summary, and consequence", () => {
    render(
      <InboxList
        items={[
          {
            id: "approval_1",
            actionType: "approval",
            riskLevel: "high",
            sourceTaskTitle: "Review adapter mapping",
            currentRunLabel: "run_projection",
            summary: "Approve the file patch",
            consequence: "Blocks deployment until approved",
          },
        ]}
      />,
    );

    expect(screen.getByText("approval")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("Review adapter mapping")).toBeInTheDocument();
  });
});
```

Create `src/components/memory/__tests__/memory-console.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryConsole } from "@/components/memory/memory-console";

describe("MemoryConsole", () => {
  it("shows content, source, scope, status, and linked task/run", () => {
    render(
      <MemoryConsole
        items={[
          {
            id: "memory_1",
            content: "Use Task Projection for all list surfaces.",
            sourceType: "user_input",
            scope: "workspace",
            status: "Active",
            taskTitle: "Write task projection",
            runLabel: "run_projection",
          },
        ]}
      />,
    );

    expect(screen.getByText("Use Task Projection for all list surfaces.")).toBeInTheDocument();
    expect(screen.getByText("workspace")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement inbox, memory, and settings pages**

Create `src/components/inbox/inbox-list.tsx`:

```tsx
type InboxListProps = {
  items: Array<{
    id: string;
    actionType: string;
    riskLevel: string;
    sourceTaskTitle: string;
    currentRunLabel: string;
    summary: string;
    consequence: string;
  }>;
};

export function InboxList({ items }: InboxListProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <section key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          <p>{item.actionType}</p>
          <p>{item.riskLevel}</p>
          <p>{item.sourceTaskTitle}</p>
          <p>{item.currentRunLabel}</p>
          <p>{item.summary}</p>
          <p>{item.consequence}</p>
          <div className="mt-3 flex gap-2">
            <button className="rounded-md bg-emerald-600 px-3 py-2 text-white">Approve</button>
            <button className="rounded-md bg-rose-600 px-3 py-2 text-white">Reject</button>
            <button className="rounded-md border border-slate-700 px-3 py-2 text-slate-200">Edit and Approve</button>
          </div>
        </section>
      ))}
    </div>
  );
}
```

Create `src/components/memory/memory-console.tsx`:

```tsx
type MemoryConsoleProps = {
  items: Array<{
    id: string;
    content: string;
    sourceType: string;
    scope: string;
    status: string;
    taskTitle: string | null;
    runLabel: string | null;
  }>;
};

export function MemoryConsole({ items }: MemoryConsoleProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <section key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          <p>{item.content}</p>
          <p>Source: {item.sourceType}</p>
          <p>Scope: {item.scope}</p>
          <p>Status: {item.status}</p>
          <p>Task: {item.taskTitle ?? "-"}</p>
          <p>Run: {item.runLabel ?? "-"}</p>
          <button className="mt-3 rounded-md border border-slate-700 px-3 py-2 text-slate-200">Invalidate</button>
        </section>
      ))}
    </div>
  );
}
```

Create `src/app/inbox/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { InboxList } from "@/components/inbox/inbox-list";
import { getInbox } from "@/modules/queries/get-inbox";

export default async function InboxPage() {
  const items = await getInbox();

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">Inbox</h1>
        <InboxList items={items} />
      </div>
    </ControlPlaneShell>
  );
}
```

Create `src/app/memory/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { MemoryConsole } from "@/components/memory/memory-console";
import { getMemoryConsole } from "@/modules/queries/get-memory-console";

export default async function MemoryPage() {
  const items = await getMemoryConsole();

  return (
    <ControlPlaneShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">Memory</h1>
        <MemoryConsole items={items} />
      </div>
    </ControlPlaneShell>
  );
}
```

Create `src/app/settings/page.tsx`:

```tsx
import { ControlPlaneShell } from "@/components/control-plane-shell";

export default function SettingsPage() {
  const settings = {
    runtimeMode: process.env.OPENCLAW_MODE ?? "mock",
    baseUrl: process.env.OPENCLAW_BASE_URL ?? "http://localhost:4000",
    pollIntervalMs: process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? "10000",
  };

  return (
    <ControlPlaneShell>
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p>Runtime mode: {settings.runtimeMode}</p>
        <p>Base URL: {settings.baseUrl}</p>
        <p>Work poll interval: {settings.pollIntervalMs}ms</p>
      </div>
    </ControlPlaneShell>
  );
}
```

- [ ] **Step 3: Add a browser test for the main B-style flow**

Create `e2e/control-plane.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("task center leads to task page and work page without falling back to chat-first UI", async ({ page }) => {
  await page.goto("/tasks");

  await page.getByRole("link", { name: "Write task projection" }).click();
  await expect(page.getByRole("button", { name: "Start Run" })).toBeVisible();
  await expect(page.getByText("Block Reason")).toBeVisible();

  await page.getByRole("link", { name: "Open Work Page" }).click();
  await expect(page.getByRole("heading", { name: "Execution Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending Approvals" })).toBeVisible();
});
```

- [ ] **Step 4: Run component tests, browser tests, lint, and build**

Run:

```bash
npm run test -- src/components/inbox/__tests__/inbox-list.test.tsx src/components/memory/__tests__/memory-console.test.tsx
npx playwright install
npm run test:e2e
npm run lint
npm run test
npm run build
```

Expected:
- inbox test passes
- memory test passes
- e2e test passes in mock runtime mode
- lint passes
- full test suite passes
- production build succeeds

- [ ] **Step 5: Commit the final MVP slice**

Run:

```bash
git add src/app/inbox src/app/memory src/app/settings src/components/inbox src/components/memory e2e
git commit -m "feat: finish task-centric control plane mvp"
```

Expected: final MVP commit created successfully

## Self-Review Checklist

- Spec coverage: Tasks 2-10 map directly to the approved implementation order in the spec: feasibility gate first, then data model, adapter contract, sync/read models, page skeletons, and finally recovery/inbox/memory details.
- No placeholder policy: do not leave `TODO`, `TBD`, or unnamed files/functions while executing the plan. If any command produces a different generated shape than expected, update the plan step before continuing.
- Status semantics: keep `Task Page` for planning/control, `Work Page` for execution/observation, and never let conversation become the primary status surface.
- Verification discipline: do not claim a task is finished until the exact command in that task has been run and its output checked.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-08-task-centric-ai-control-plane-mvp.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
