import { randomUUID } from "node:crypto";

import { db, type Prisma } from "@chrona/db";
import type { AiClientType } from "@chrona/contracts";
import { ensureEnabledAiClientDefault } from "./default-ai-client";

interface CreateAiClientInput {
  name: string;
  type: AiClientType;
  config?: Record<string, unknown>;
  isDefault?: boolean;
}

export async function createAiClient(input: CreateAiClientInput) {
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
