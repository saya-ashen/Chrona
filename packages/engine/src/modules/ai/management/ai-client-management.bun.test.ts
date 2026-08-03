import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { AI_FEATURES } from "@chrona/contracts";
import { db, type Prisma } from "@chrona/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";
import { aiClientManagement } from "./ai-client-management";
import { aiClientRegistry } from "../runtime/client-registry";
import { getAiClientForTask } from "../runtime/client-resolution";

const validFeatureSet = new Set<string>(AI_FEATURES);
const originalFetch = globalThis.fetch;

async function resetDb() {
  await db.aiFeatureBinding.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
  await db.aiClient.deleteMany();
  await aiClientRegistry.refresh();
}

async function createClient(type: string, config: Prisma.InputJsonObject = {}) {
  return db.aiClient.create({
    data: {
      name: `${type} client`,
      type,
      config,
      enabled: true,
      isDefault: false,
    },
  });
}

beforeEach(async () => {
  globalThis.fetch = originalFetch;
  await resetDb();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await resetDb();
  await db.$disconnect();
});

describe("AI Feature Runtime client bindings", () => {
  it("rejects local-only providers without changing existing bindings", async () => {
    const debug = await createClient("debug", { profile: "deterministic" });
    await db.aiFeatureBinding.create({
      data: { id: "existing-binding", clientId: debug.id, feature: "chat" },
    });

    await expect(aiClientManagement.updateBindings({
      clientId: debug.id,
      features: ["task.plan"],
      validFeatureSet,
    })).rejects.toMatchObject({
      code: ENGINE_ERROR_CODES.VALIDATION_FAILED,
    } satisfies Partial<EngineError>);

    expect(await db.aiFeatureBinding.findMany({ where: { clientId: debug.id }, select: { feature: true } }))
      .toEqual([{ feature: "chat" }]);
  });

  it("accepts durable Hermes capabilities and stores canonical bindings", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      features: {
        run_submission: true,
        run_status: true,
        run_events_sse: true,
        run_stop: true,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const hermes = await createClient("hermes", { baseUrl: "http://hermes.test" });

    await expect(aiClientManagement.updateBindings({
      clientId: hermes.id,
      features: ["goal.review", "task.plan"],
      validFeatureSet,
    })).resolves.toEqual(["goal.review", "task.plan"]);

    expect(await db.aiFeatureBinding.findMany({ where: { clientId: hermes.id }, orderBy: { feature: "asc" }, select: { feature: true } }))
      .toEqual([{ feature: "goal.review" }, { feature: "task.plan" }]);
  });

  it("honors a task-bound client and never falls back from disabled explicit selections", async () => {
    const fallback = await createClient("debug", { profile: "deterministic" });
    const pinned = await createClient("debug", { profile: "deterministic" });
    await db.aiFeatureBinding.create({
      data: { clientId: fallback.id, feature: "task.execution" },
    });
    const workspace = await db.workspace.create({
      data: { name: "Task-bound provider", defaultRuntime: "debug", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Pinned provider task",
        executionRuntime: "debug",
        executionConfig: {},
        status: "Ready",
        priority: "Medium",
        aiClientId: pinned.id,
      },
    });
    await aiClientRegistry.refresh();

    expect((await getAiClientForTask({ taskId: task.id, purpose: "task.execution" }))?.record.id).toBe(pinned.id);
    expect((await aiClientRegistry.getForFeature("task.execution"))?.record.id).toBe(fallback.id);

    await db.aiClient.update({ where: { id: pinned.id }, data: { enabled: false } });
    await aiClientRegistry.refresh();
    expect(await getAiClientForTask({ taskId: task.id, purpose: "task.execution" })).toBeNull();

    await db.aiFeatureBinding.update({
      where: { feature: "task.execution" },
      data: { clientId: pinned.id },
    });
    await aiClientRegistry.refresh();
    expect(await aiClientRegistry.getForFeature("task.execution")).toBeNull();
  });

  it("fails closed when Hermes capabilities cannot be verified", async () => {
    globalThis.fetch = mock(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const hermes = await createClient("hermes", { baseUrl: "http://offline.test" });

    await expect(aiClientManagement.updateBindings({
      clientId: hermes.id,
      features: ["task.plan"],
      validFeatureSet,
    })).rejects.toMatchObject({ code: ENGINE_ERROR_CODES.VALIDATION_FAILED });
    expect(await db.aiFeatureBinding.count()).toBe(0);
  });
});
