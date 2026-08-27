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

// eslint-disable-next-line complexity -- Secret preservation and explicit clear semantics are coupled at this boundary.
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

  const existingConfig = existing as Record<string, unknown>;
  const merged = { ...existingConfig, ...next };
  if (next.baseUrl === null && merged.env && typeof merged.env === "object" && !Array.isArray(merged.env)) {
    const env = { ...(merged.env as Record<string, unknown>) };
    for (const key of ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL"]) delete env[key];
    merged.env = Object.keys(env).length > 0 ? env : undefined;
  }
  for (const key of SECRET_CONFIG_KEYS) {
    if (next[key] === "" && existingConfig[key] !== undefined) {
      merged[key] = existingConfig[key];
    }
  }
  return merged;
}
