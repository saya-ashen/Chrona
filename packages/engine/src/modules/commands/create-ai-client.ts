import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type AiClientType = "openclaw" | "llm";

interface CreateAiClientInput {
  name: string;
  type: AiClientType;
  config?: Record<string, unknown>;
  isDefault?: boolean;
}

export async function createAiClient(input: CreateAiClientInput) {
  const isDefault = input.isDefault ?? false;

  if (isDefault) {
    await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  return db.aiClient.create({
    data: {
      id: randomUUID().replace(/-/g, "").slice(0, 25),
      name: input.name,
      type: input.type,
      config: (input.config ?? {}) as Prisma.InputJsonValue,
      isDefault,
      enabled: true,
    },
  });
}
