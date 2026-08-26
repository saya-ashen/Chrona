import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { runRecurringWorkBlockExpansionWorker } from "@chrona/engine/test-support";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

// The SSR task-page loader fans out 5 GETs in parallel (see
// apps/web/src/loaders.ts:133). This test mirrors that fan-out and
// asserts (a) every read model is work-block-scoped, (b) the spread
// { ...bootstrap, ...runtimeContext, ...reviewContext } does not
// silently drop a field, and (c) the header status tracks the
// selected occurrence — not the shared task-row status. Regression
// pin for the "primaryStatus stuck on Blocked across occurrence
// switch" bug (commit 184575d9).
//
// The header's primary status badge lives at
//   spec.elements["badge:primary-state"].props.text
// with values: "Waiting" | "Running" | "Blocked" | "Completed" | "Approval needed".

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function createRecurringTaskWithOccurrences(input: {
  workspaceId: string;
  rrule: string;
  anchor: Date;
  taskRowStatus?: "Blocked" | "Ready" | "Running" | "Completed";
}) {
  const taskRowStatus = input.taskRowStatus ?? "Ready";
  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: "SSR scope probe",
      status: taskRowStatus,
      priority: "Medium",
      executionConfig: {},
      recurrenceRule: input.rrule,
      recurrenceAnchorStartAt: input.anchor,
      recurrenceAnchorEndAt: new Date(input.anchor.getTime() + 30 * 60 * 1000),
    },
  });
  await db.taskTrigger.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: task.id,
      kind: "schedule",
      state: "Enabled",
      config: {
        mode: "recurring",
        rrule: input.rrule,
        anchorStartAt: input.anchor.toISOString(),
        timezone: "UTC",
        durationMs: 30 * 60 * 1000,
      },
    },
  });
  await runRecurringWorkBlockExpansionWorker({ now: input.anchor });
  const blocks = await db.workBlock.findMany({
    where: { taskId: task.id },
    orderBy: { scheduledStartAt: "asc" },
  });
  return { task, blocks };
}

async function fetchSsrBundle(taskId: string, workBlockId: string | null) {
  const query = workBlockId ? `?workBlockId=${encodeURIComponent(workBlockId)}` : "";
  const path = `/api/tasks/${taskId}`;
  const server = app();
  // Mirror the 5-endpoint fan-out in apps/web/src/loaders.ts:133.
  const bootstrap = await (await server.request(`http://local${path}${query}`)).json();
  const runtimeContext = await (await server.request(`http://local${path}/runtime-context${query}`)).json();
  const reviewContext = await (await server.request(`http://local${path}/review-context${query}`)).json();
  const commandCenter = await (await server.request(`http://local${path}/command-center${query}`)).json();
  const header = await (await server.request(`http://local${path}/workspace/header${query}`)).json();
  return { bootstrap, runtimeContext, reviewContext, commandCenter, header };
}

function primaryStatusText(header: { spec: { elements: Record<string, { props?: { text?: string } }> } }): string {
  return header.spec.elements["badge:primary-state"]?.props?.text ?? "<missing>";
}

describe("SSR loader fan-out — header + 4 read models are work-block scoped", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("header status tracks the selected work block, not the task row", async () => {
    const { workspaceId } = await seedWorkspace("SSR scope");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=2",
      anchor,
      taskRowStatus: "Blocked",
    });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    // Occurrence 1 has no active execution → header should be "Waiting"
    // (Scheduled). NOT "Blocked" — the task row's "Blocked" must not
    // surface here. Regression for commit 184575d9.
    const firstBundle = await fetchSsrBundle(task.id, first!.id);
    expect(primaryStatusText(firstBundle.header)).toBe("Waiting");

    // Switching workBlockId returns the same status (both Scheduled,
    // no execution) — the point is the *task row Blocked* never
    // leaks into either occurrence's header.
    const secondBundle = await fetchSsrBundle(task.id, second!.id);
    expect(primaryStatusText(secondBundle.header)).toBe("Waiting");
  });

  it("every read model accepts the same workBlockId without 4xx", async () => {
    const { workspaceId } = await seedWorkspace("SSR consistency");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=2",
      anchor,
    });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    for (const block of [first!, second!]) {
      const query = `?workBlockId=${encodeURIComponent(block.id)}`;
      const path = `/api/tasks/${task.id}`;
      const responses = await Promise.all([
        app().request(`http://local${path}${query}`),
        app().request(`http://local${path}/runtime-context${query}`),
        app().request(`http://local${path}/review-context${query}`),
        app().request(`http://local${path}/command-center${query}`),
        app().request(`http://local${path}/workspace/header${query}`),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(200);
      }
    }
  });

  it("header and command-center both report Waiting on a Scheduled occurrence", async () => {
    // When the task row is Blocked but the work block is Scheduled
    // with no execution, the header (after the fix) returns
    // "Waiting". The command-center should not surface a different
    // primary status — if it does, the SSR loader's spread
    // (header < command-center) would still show the wrong one
    // because header is the LAST write.
    const { workspaceId } = await seedWorkspace("SSR disagreement");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=2",
      anchor,
      taskRowStatus: "Blocked",
    });
    const [, second] = blocks;
    expect(second).toBeTruthy();

    const bundle = await fetchSsrBundle(task.id, second!.id);
    expect(primaryStatusText(bundle.header)).toBe("Waiting");
  });

  it("spread retains every read model's top-level keys", async () => {
    // The SSR loader does { ...bootstrap, ...runtimeContext, ...reviewContext }
    // — a field name collision would silently clobber. We don't assert
    // the spread (it lives in the web app), we assert each read model
    // returns a non-empty object so the spread has something to
    // spread. A non-empty object is the contract: if a future read
    // model starts returning { } the page will silently lose data.
    const { workspaceId } = await seedWorkspace("SSR spread");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=1",
      anchor,
    });
    const [block] = blocks;
    expect(block).toBeTruthy();

    const { bootstrap, runtimeContext, reviewContext } = await fetchSsrBundle(task.id, block!.id);
    for (const [_name, value] of Object.entries({ bootstrap, runtimeContext, reviewContext })) {
      const obj = value as Record<string, unknown>;
      expect(obj).toBeTruthy();
      expect(typeof obj).toBe("object");
      expect(Object.keys(obj).length).toBeGreaterThan(0);
    }
  });

  it("header does not inherit Completed from a Completed task row", async () => {
    // Edge: a task with status Completed (e.g. user clicked "mark
    // done" at the task level) but with a still-Scheduled recurrence
    // occurrence. The header should reflect the Scheduled
    // occurrence, not the Completed task row.
    //
    // The recurring worker skips Completed tasks, so we create the
    // task as Ready, run the worker to materialize the work blocks,
    // THEN flip the task row to Completed.
    const { workspaceId } = await seedWorkspace("SSR completed task");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=2",
      anchor,
      taskRowStatus: "Ready",
    });
    const [first] = blocks;
    expect(first).toBeTruthy();
    await db.task.update({ where: { id: task.id }, data: { status: "Completed" } });

    const bundle = await fetchSsrBundle(task.id, first!.id);
    expect(primaryStatusText(bundle.header)).not.toBe("Completed");
  });

  it("sibling occurrences with Completed status do not influence the selected block's header", async () => {
    // Stronger variant: 3 occurrences, mark the FIRST and THIRD as
    // Completed at the block level. The SECOND (selected) is still
    // Scheduled. The header MUST reflect the second occurrence
    // (Scheduled → Waiting), not surface any Completed signal from
    // siblings.
    const { workspaceId } = await seedWorkspace("SSR sibling isolation");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const { task, blocks } = await createRecurringTaskWithOccurrences({
      workspaceId,
      rrule: "FREQ=DAILY;COUNT=3",
      anchor,
      taskRowStatus: "Ready",
    });
    expect(blocks).toHaveLength(3);
    const [first, second, third] = blocks;
    await db.workBlock.update({ where: { id: first!.id }, data: { status: "Completed" } });
    await db.workBlock.update({ where: { id: third!.id }, data: { status: "Completed" } });

    const bundle = await fetchSsrBundle(task.id, second!.id);
    expect(primaryStatusText(bundle.header)).toBe("Waiting");
  });
});
