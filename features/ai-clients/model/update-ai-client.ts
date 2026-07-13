import { db, type Prisma } from "@chrona/db";
import type { AiClientType } from "@chrona/contracts";
import { ensureEnabledAiClientDefault } from "./default-ai-client";

interface UpdateAiClientInput {
  name?: string;
  type?: AiClientType;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  enabled?: boolean;
}

export async function updateAiClient(clientId: string, input: UpdateAiClientInput) {
  const existing = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!existing) {
    throw new Error("Client not found");
  }

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
  if (existingType !== nextType) {
    return next;
  }

  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return next;
  }

  const merged = { ...(existing as Record<string, unknown>), ...next };
  for (const key of SECRET_CONFIG_KEYS) {
    if (next[key] === "" && existing[key] !== undefined) {
      merged[key] = existing[key];
    }
  }
  return merged;
}
