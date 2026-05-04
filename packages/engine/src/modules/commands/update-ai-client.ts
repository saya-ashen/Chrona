import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface UpdateAiClientInput {
  name?: string;
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

  return db.aiClient.update({
    where: { id: clientId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.config !== undefined && { config: input.config as Prisma.InputJsonValue }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  });
}
