import { randomUUID } from "node:crypto";

import { db, type Prisma } from "@chrona/db";
import type { AiClientType } from "@chrona/contracts";
import { testAiClientAvailability } from "../providers";
import { supportsDurableFeatureRuntime } from "@chrona/providers-foundation";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";
import { aiClientRegistry } from "../runtime/client-registry";

type AiClientStore = Pick<typeof db, "aiClient">;

type CreateAiClientInput = {
  name: string;
  type: AiClientType;
  config?: Record<string, unknown>;
  isDefault?: boolean;
};

type UpdateAiClientInput = {
  name?: string;
  type?: AiClientType;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  enabled?: boolean;
};

type UpdateBindingsInput = {
  clientId: string;
  features: string[];
  validFeatureSet: ReadonlySet<string>;
};

async function ensureEnabledAiClientDefault(store: AiClientStore = db) {
  const currentDefault = await store.aiClient.findFirst({
    where: { enabled: true, isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (currentDefault) {
    await store.aiClient.updateMany({
      where: { isDefault: true, id: { not: currentDefault.id } },
      data: { isDefault: false },
    });
    return currentDefault.id;
  }

  const fallbackDefault = await store.aiClient.findFirst({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!fallbackDefault) {
    await store.aiClient.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    return null;
  }

  await store.aiClient.updateMany({
    where: { isDefault: true, id: { not: fallbackDefault.id } },
    data: { isDefault: false },
  });
  await store.aiClient.update({
    where: { id: fallbackDefault.id },
    data: { isDefault: true },
  });
  return fallbackDefault.id;
}

async function createAiClient(input: CreateAiClientInput) {
  const enabledClientCount = await db.aiClient.count({ where: { enabled: true } });
  const isDefault = input.isDefault === true || enabledClientCount === 0;

  if (isDefault) {
    await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const client = await db.aiClient.create({
    data: {
      id: randomUUID().replace(/-/g, "").slice(0, 25),
      name: input.name,
      type: input.type,
      config: (input.config ?? {}) as Prisma.InputJsonValue,
      isDefault,
      enabled: true,
    },
  });

  await ensureEnabledAiClientDefault();
  return client;
}

const SECRET_CONFIG_KEYS = new Set([
  "apiKey",
  "bridgeToken",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "password",
]);

function mergeExistingSecrets(
  existing: Prisma.JsonValue,
  next: Record<string, unknown>,
  existingType: AiClientType,
  nextType: AiClientType,
) {
  if (existingType !== nextType || !existing || typeof existing !== "object" || Array.isArray(existing)) {
    return next;
  }

  const merged = { ...(existing as Record<string, unknown>), ...next };
  for (const key of SECRET_CONFIG_KEYS) {
    if (next[key] === "" && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
}

async function updateAiClient(clientId: string, input: UpdateAiClientInput) {
  const existing = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!existing) throw new Error("Client not found");

  if (input.isDefault === true) {
    await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const nextConfig = input.config === undefined
    ? undefined
    : mergeExistingSecrets(existing.config, input.config, existing.type, input.type ?? existing.type);

  const updated = await db.aiClient.update({
    where: { id: clientId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.type !== undefined && { type: input.type }),
      ...(nextConfig !== undefined && { config: nextConfig as Prisma.InputJsonValue }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  });

  await ensureEnabledAiClientDefault();
  return db.aiClient.findUniqueOrThrow({ where: { id: updated.id } });
}

async function deleteAiClient(clientId: string) {
  await db.aiClient.delete({ where: { id: clientId } });
  await ensureEnabledAiClientDefault();
}

async function updateAiClientBindings(input: UpdateBindingsInput) {
  const { clientId, features, validFeatureSet } = input;
  const client = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!client) throw new EngineError(ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Client not found");
  const invalidFeatures = [...new Set(features.filter((feature) => !validFeatureSet.has(feature)))];
  if (invalidFeatures.length > 0) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Unknown AI feature bindings: ${invalidFeatures.join(", ")}`);
  }
  const validFeatures = [...new Set(features.filter((feature) => validFeatureSet.has(feature)))];
  const durableFeatures = validFeatures.filter((feature) => feature === "goal.review" || feature === "task.plan");
  if (durableFeatures.length > 0) {
    const capabilities = await aiClientRegistry.inspectProviderCapabilities(clientId);
    if (!capabilities || !supportsDurableFeatureRuntime(capabilities)) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        `AI client does not support durable Feature Runtime bindings: ${durableFeatures.join(", ")}`,
      );
    }
  }
  await db.$transaction(async (tx) => {
    if (validFeatures.length > 0) {
      await tx.aiFeatureBinding.deleteMany({ where: { feature: { in: validFeatures } } });
    }
    await tx.aiFeatureBinding.deleteMany({
      where: { clientId, feature: { notIn: validFeatures } },
    });
    for (const feature of validFeatures) {
      await tx.aiFeatureBinding.create({
        data: {
          id: randomUUID().replace(/-/g, "").slice(0, 25),
          feature,
          clientId,
        },
      });
    }
  });
  return validFeatures;
}

export class AiClientManagement {
  list() {
    return db.aiClient.findMany({ include: { bindings: true }, orderBy: { createdAt: "asc" } });
  }

  async create(input: CreateAiClientInput) {
    const client = await createAiClient(input);
    await aiClientRegistry.refresh();
    return client;
  }

  async update(input: { clientId: string; data: UpdateAiClientInput }) {
    const client = await updateAiClient(input.clientId, input.data);
    await aiClientRegistry.refresh();
    return client;
  }

  async delete(input: { clientId: string }) {
    await deleteAiClient(input.clientId);
    await aiClientRegistry.refresh();
    return { success: true };
  }

  test(input: Parameters<typeof testAiClientAvailability>[0]) {
    return testAiClientAvailability(input);
  }

  async updateBindings(input: UpdateBindingsInput) {
    const features = await updateAiClientBindings(input);
    await aiClientRegistry.refresh();
    return features;
  }
}

export const aiClientManagement = new AiClientManagement();
