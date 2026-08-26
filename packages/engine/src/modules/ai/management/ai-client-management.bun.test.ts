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
  it("rejects insecure or credential-bearing Hermes endpoints before persisting client configuration", async () => {
    await expect(aiClientManagement.create({ name: "Remote Hermes", type: "hermes", config: { baseUrl: "http://192.168.1.12:8642", apiKey: "test-token" } }))
      .rejects.toMatchObject({ code: ENGINE_ERROR_CODES.VALIDATION_FAILED });
    await expect(aiClientManagement.create({ name: "Query credential", type: "hermes", config: { baseUrl: "https://hermes.example.test/?client_secret=not-stored" } }))
      .rejects.toMatchObject({ code: ENGINE_ERROR_CODES.VALIDATION_FAILED });
    expect(await db.aiClient.count()).toBe(0);
  });

  it("rejects providers with no safe terminal-only recovery without changing existing bindings", async () => {
    const debug = await createClient("llm", {});
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

  it("accepts OMP only through terminal-only single-attempt recovery", async () => {
    const omp = await createClient("omp", { model: "test-model" });

    await expect(aiClientManagement.updateBindings({
      clientId: omp.id,
      features: ["goal.review", "task.plan"],
      validFeatureSet,
    })).resolves.toEqual(["goal.review", "task.plan"]);

    expect(await db.aiFeatureBinding.findMany({ where: { clientId: omp.id }, orderBy: { feature: "asc" }, select: { feature: true } }))
      .toEqual([{ feature: "goal.review" }, { feature: "task.plan" }]);
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
    const hermes = await createClient("hermes", { baseUrl: "https://hermes.test" });

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
      data: { name: "Task-bound provider", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Pinned provider task",
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
    const hermes = await createClient("hermes", { baseUrl: "https://offline.test" });

    await expect(aiClientManagement.updateBindings({
      clientId: hermes.id,
      features: ["task.plan"],
      validFeatureSet,
    })).rejects.toMatchObject({ code: ENGINE_ERROR_CODES.VALIDATION_FAILED });
    expect(await db.aiFeatureBinding.count()).toBe(0);
  });
});
