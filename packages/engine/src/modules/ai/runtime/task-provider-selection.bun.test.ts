import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  resolveTaskExecutionProviderSelection,
  stableJsonHash,
} from "@/modules/ai";

async function reset() {
  await db.task.deleteMany();
  await db.aiFeatureBinding.deleteMany();
  await db.aiClient.deleteMany();
}

async function client(input: {
  name: string;
  type: string;
  isDefault?: boolean;
  enabled?: boolean;
  config?: Prisma.InputJsonObject;
}) {
  return db.aiClient.create({
    data: {
      name: input.name,
      type: input.type,
      config: input.config ?? {},
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
    },
  });
}

describe("resolveTaskExecutionProviderSelection", () => {
  beforeEach(reset);
  afterAll(reset);

  it("uses an explicit enabled task AI client as the sole provider source", async () => {
    const fallback = await client({ name: "Default OMP", type: "omp", isDefault: true });
    const explicit = await client({
      name: "Task Codex",
      type: "codex",
      config: { model: "gpt-5" },
    });
    await db.aiFeatureBinding.create({
      data: { feature: "task.execution", clientId: fallback.id },
    });

    await expect(resolveTaskExecutionProviderSelection({ aiClientId: explicit.id }))
      .resolves.toEqual({
        clientId: explicit.id,
        clientName: "Task Codex",
        providerName: "codex",
        configFingerprint: stableJsonHash({ model: "gpt-5" }),
      });
  });

  it("uses the task.execution binding when the task has no client override", async () => {
    await client({ name: "Default OMP", type: "omp", isDefault: true });
    const bound = await client({ name: "Bound Claude", type: "claude_code" });
    await db.aiFeatureBinding.create({
      data: { feature: "task.execution", clientId: bound.id },
    });

    expect(await resolveTaskExecutionProviderSelection({ aiClientId: null }))
      .toMatchObject({ clientId: bound.id, providerName: "claude_code" });
  });

  it("falls back to the enabled default client when no binding exists", async () => {
    await client({ name: "First OMP", type: "omp" });
    const preferred = await client({ name: "Preferred Codex", type: "codex", isDefault: true });

    expect(await resolveTaskExecutionProviderSelection({}))
      .toMatchObject({ clientId: preferred.id, providerName: "codex" });
  });

  it("fails closed for an explicit disabled or unknown client", async () => {
    const disabled = await client({
      name: "Disabled Hermes",
      type: "hermes",
      enabled: false,
    });

    await expect(resolveTaskExecutionProviderSelection({ aiClientId: disabled.id }))
      .resolves.toBeNull();
    await expect(resolveTaskExecutionProviderSelection({ aiClientId: "missing" }))
      .resolves.toBeNull();
  });
});
