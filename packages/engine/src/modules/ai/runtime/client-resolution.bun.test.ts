import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";

import { aiClientRegistry } from "./client-registry";
import { getAiClientForTask } from "./client-resolution";

async function reset() {
  await db.task.deleteMany();
  await db.aiFeatureBinding.deleteMany();
  await db.aiClient.deleteMany();
  await db.workspace.deleteMany();
  await aiClientRegistry.refresh();
}

describe("getAiClientForTask", () => {
  beforeEach(reset);
  afterAll(reset);

  it("uses the task.plan binding instead of an execution-only task client", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Provider resolution", status: "Active" },
    });
    const planner = await db.aiClient.create({
      data: {
        name: "OMP planner",
        type: "omp",
        config: {},
        enabled: true,
        isDefault: true,
      },
    });
    const executor = await db.aiClient.create({
      data: {
        name: "Claude executor",
        type: "claude_code",
        config: {},
        enabled: true,
        isDefault: false,
      },
    });
    await db.aiFeatureBinding.create({
      data: { feature: "task.plan", clientId: planner.id },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Plan with OMP, execute with Claude",
        kind: "single",
        status: "Ready",
        priority: "Medium",
        executionConfig: {},
        aiClientId: executor.id,
      },
    });
    await aiClientRegistry.refresh();

    await expect(getAiClientForTask({ taskId: task.id, purpose: "task.plan" }))
      .resolves.toMatchObject({ record: { id: planner.id, type: "omp" } });
    await expect(getAiClientForTask({ taskId: task.id, purpose: "task.execution" }))
      .resolves.toMatchObject({ record: { id: executor.id, type: "claude_code" } });
    await expect(getAiClientForTask({ taskId: task.id, purpose: "task.result_finalization" }))
      .resolves.toMatchObject({ record: { id: planner.id, type: "omp" } });
  });
});
