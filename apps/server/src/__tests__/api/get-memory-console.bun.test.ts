import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { getMemoryConsole } from "@chrona/engine/modules/pages/get-memory-console";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// getMemoryConsole — engine-layer unit for the memory read-model.
// The HTTP surface GET /api/memory is covered by action-center-memory-schedule-pages;
// this file pins the engine contract on the bare read-model function:
//
// - empty workspace returns an empty list
// - rows are ordered by updatedAt desc
// - each row includes content/sourceType/scope/status + taskTitle
//   (null when the task was deleted) and runLabel (from sourceRunId)
// - rows for the wrong workspace are NOT returned

async function seedMemory(input: {
  workspaceId: string;
  taskId?: string | null;
  sourceRunId?: string | null;
  content: string;
  scope?: "user" | "workspace" | "project" | "task";
  sourceType?: "user_input" | "agent_inferred" | "imported" | "system_rule" | "plan_layer";
  status?: "Active" | "Inactive" | "Conflicted" | "Expired";
  updatedAt?: Date;
}) {
  return db.memory.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId ?? null,
      sourceRunId: input.sourceRunId ?? null,
      content: input.content,
      scope: input.scope ?? "task",
      sourceType: input.sourceType ?? "agent_inferred",
      status: input.status ?? "Active",
      updatedAt: input.updatedAt,
    },
  });
}

interface MemoryConsoleRow {
  id: string;
  content: string;
  sourceType: string;
  scope: string;
  status: string;
  workspaceId: string;
  taskId: string | null;
  taskTitle: string | null;
  runLabel: string | null;
}

describe("getMemoryConsole (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("empty workspace returns an empty list", async () => {
    const { workspaceId } = await seedWorkspace("Memory empty");

    const result = await getMemoryConsole(workspaceId);

    expect(result).toEqual([]);
  });

  it("rows are ordered by updatedAt desc with taskTitle and runLabel projected", async () => {
    const { workspaceId } = await seedWorkspace("Memory order");
    const { taskId } = await seedTask(workspaceId, { title: "Memory source task" });

    const older = await seedMemory({
      workspaceId,
      taskId,
      sourceRunId: "run-older",
      content: "Older memory",
      updatedAt: new Date("2030-10-01T08:00:00.000Z"),
    });
    const newer = await seedMemory({
      workspaceId,
      taskId,
      sourceRunId: "run-newer",
      content: "Newer memory",
      updatedAt: new Date("2030-10-01T10:00:00.000Z"),
    });

    const result = (await getMemoryConsole(workspaceId)) as MemoryConsoleRow[];

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(newer.id);
    expect(result[0].content).toBe("Newer memory");
    expect(result[0].taskId).toBe(taskId);
    expect(result[0].taskTitle).toBe("Memory source task");
    expect(result[0].runLabel).toBe("run-newer");
    expect(result[0].sourceType).toBe("agent_inferred");
    expect(result[0].scope).toBe("task");
    expect(result[0].status).toBe("Active");
    expect(result[0].workspaceId).toBe(workspaceId);

    expect(result[1].id).toBe(older.id);
    expect(result[1].runLabel).toBe("run-older");
  });

  it("taskTitle is null when the linked task is null", async () => {
    const { workspaceId } = await seedWorkspace("Memory no task");

    await seedMemory({
      workspaceId,
      taskId: null,
      content: "Workspace-level memory",
      scope: "workspace",
    });

    const result = (await getMemoryConsole(workspaceId)) as MemoryConsoleRow[];

    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBeNull();
    expect(result[0].taskTitle).toBeNull();
    expect(result[0].runLabel).toBeNull();
    expect(result[0].scope).toBe("workspace");
  });

  it("does NOT leak rows from a different workspace", async () => {
    const wsA = await seedWorkspace("Memory WS A");
    const wsB = await seedWorkspace("Memory WS B");

    await seedMemory({ workspaceId: wsA.workspaceId, content: "A only" });
    await seedMemory({ workspaceId: wsB.workspaceId, content: "B only" });

    const aResult = (await getMemoryConsole(wsA.workspaceId)) as MemoryConsoleRow[];
    const bResult = (await getMemoryConsole(wsB.workspaceId)) as MemoryConsoleRow[];

    expect(aResult.map((m) => m.content)).toEqual(["A only"]);
    expect(bResult.map((m) => m.content)).toEqual(["B only"]);
  });

  it("preserves the sourceType / status projection fields", async () => {
    const { workspaceId } = await seedWorkspace("Memory projection fields");

    await seedMemory({
      workspaceId,
      content: "Inactive note",
      sourceType: "user_input",
      scope: "user",
      status: "Inactive",
    });
    await seedMemory({
      workspaceId,
      content: "System rule observation",
      sourceType: "system_rule",
      scope: "workspace",
      status: "Active",
    });

    const result = (await getMemoryConsole(workspaceId)) as MemoryConsoleRow[];

    const inactive = result.find((m) => m.content === "Inactive note");
    const system = result.find((m) => m.content === "System rule observation");

    expect(inactive?.sourceType).toBe("user_input");
    expect(inactive?.scope).toBe("user");
    expect(inactive?.status).toBe("Inactive");
    expect(system?.sourceType).toBe("system_rule");
    expect(system?.scope).toBe("workspace");
  });
});
