import { db } from "@chrona/db";

type AiClientStore = Pick<typeof db, "aiClient">;

export async function ensureEnabledAiClientDefault(store: AiClientStore = db) {
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
