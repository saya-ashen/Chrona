import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { createTask } from "./create-task";
import { rebuildTaskWithLatestGoalAssets } from "./rebuild-task-with-latest-goal-assets";
async function resetDb() {
  await db.goalAssetVersion.deleteMany();
  await db.goalAsset.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.taskOccurrence.deleteMany();
  await db.taskSession.deleteMany();
  await db.artifact.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.goal.deleteMany();
  await db.workspace.deleteMany();
}

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
});

describe("rebuildTaskWithLatestGoalAssets", () => {
  beforeEach(resetDb);

  it("atomically replaces a Goal Task with a fresh latest-version asset snapshot", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Rebuild task", status: "Active" },
    });
    const goal = await db.goal.create({
      data: {
        workspaceId: workspace.id,
        title: "Current knowledge",
        status: "Active",
        successCriteria: [],
      },
    });
    const assetSourceTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Asset source",
        executionConfig: {},
        status: "Completed",
        priority: "Medium",
      },
    });
    const assetSourceRun = await db.run.create({
      data: {
        taskId: assetSourceTask.id,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "test",
      },
    });
    const sourceArtifact = await db.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: assetSourceTask.id,
        runId: assetSourceRun.id,
        type: "file",
        title: "Knowledge",
        uri: "generated://tests/knowledge.md",
      },
    });
    const asset = await db.goalAsset.create({
      data: {
        workspaceId: workspace.id,
        goalId: goal.id,
        sourceArtifactId: sourceArtifact.id,
        currentArtifactId: sourceArtifact.id,
        role: "working_document",
        status: "Approved",
        label: "Knowledge",
        kind: "document",
      },
    });
    await db.goalAssetVersion.create({
      data: {
        workspaceId: workspace.id,
        goalId: goal.id,
        assetId: asset.id,
        artifactId: sourceArtifact.id,
        version: 1,
        source: "manual",
        content: "v1",
        contentHash: "v1",
        authorType: "user",
      },
    });
    const source = await createTask({
      workspaceId: workspace.id,
      goalId: goal.id,
      title: "Use current knowledge",
      description: "Keep this definition",
      priority: "High",
      goalContext: { expectedOutcome: "Current answer" },
    });
    await db.goalAssetVersion.create({
      data: {
        workspaceId: workspace.id,
        goalId: goal.id,
        assetId: asset.id,
        artifactId: sourceArtifact.id,
        version: 2,
        source: "manual",
        content: "v2",
        contentHash: "v2",
        authorType: "user",
      },
    });

    const rebuilt = await rebuildTaskWithLatestGoalAssets({ taskId: source.taskId });
    const replacement = await db.task.findUniqueOrThrow({ where: { id: rebuilt.taskId } });
    const context = replacement.goalContext as {
      expectedOutcome?: string;
      assets?: Array<{ version: number }>;
    };

    expect(rebuilt.replacedTaskId).toBe(source.taskId);
    expect(await db.task.findUnique({ where: { id: source.taskId } })).toBeNull();
    expect(replacement.title).toBe("Use current knowledge");
    expect(replacement.description).toBe("Keep this definition");
    expect(replacement.priority).toBe("High");
    expect(replacement.status).toBe("Ready");
    expect(context.expectedOutcome).toBe("Current answer");
    expect(context.assets?.map(({ version }) => version)).toEqual([2]);
    expect(await db.taskPlan.count({ where: { taskId: rebuilt.taskId } })).toBe(0);
    expect(await db.taskProjection.count({ where: { taskId: rebuilt.taskId } })).toBe(1);
  });

  it("rejects standalone Tasks without deleting them", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Standalone", status: "Active" },
    });
    const source = await createTask({ workspaceId: workspace.id, title: "Standalone" });

    await expect(rebuildTaskWithLatestGoalAssets({ taskId: source.taskId })).rejects.toThrow(
      "Only Goal-linked Tasks",
    );
    expect(await db.task.findUnique({ where: { id: source.taskId } })).not.toBeNull();
  });
});
