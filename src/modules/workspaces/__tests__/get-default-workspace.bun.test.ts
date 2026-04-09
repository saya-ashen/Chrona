import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { WorkspaceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_WORKSPACE_ID,
  DefaultWorkspaceError,
  getDefaultWorkspace,
} from "@/modules/workspaces/get-default-workspace";

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

describe("getDefaultWorkspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("returns the only existing workspace", async () => {
    const workspace = await db.workspace.create({
      data: {
        id: "ws_only",
        name: "Only Workspace",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const result = await getDefaultWorkspace();

    expect(result).toMatchObject({
      id: workspace.id,
      name: "Only Workspace",
      status: WorkspaceStatus.Active,
    });
  });

  it("returns a deterministic active workspace when multiple workspaces exist", async () => {
    await db.workspace.create({
      data: {
        id: "ws_later",
        name: "Later Workspace",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
      },
    });

    await db.workspace.create({
      data: {
        id: "ws_earlier",
        name: "Earlier Workspace",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
        createdAt: new Date("2026-04-09T09:00:00.000Z"),
      },
    });

    const result = await getDefaultWorkspace();

    expect(result).toMatchObject({
      id: "ws_earlier",
      name: "Earlier Workspace",
    });
  });

  it("creates a default workspace when the database is empty", async () => {
    const result = await getDefaultWorkspace();

    expect(result).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      name: "Default Workspace",
      status: WorkspaceStatus.Active,
      defaultRuntime: "openclaw",
    });

    const stored = await db.workspace.findUnique({
      where: { id: DEFAULT_WORKSPACE_ID },
    });

    expect(stored).not.toBeNull();
  });

  it("surfaces an explicit error when initialization fails", async () => {
    const originalCreate = db.workspace.create.bind(db.workspace);

    (db.workspace as typeof db.workspace & {
      create: typeof db.workspace.create;
    }).create = (async () => {
      throw new Error("create failed");
    }) as typeof db.workspace.create;

    try {
      await expect(getDefaultWorkspace()).rejects.toBeInstanceOf(DefaultWorkspaceError);
    } finally {
      (db.workspace as typeof db.workspace & {
        create: typeof db.workspace.create;
      }).create = originalCreate;
    }
  });
});
