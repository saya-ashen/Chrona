import { db } from "@chrona/db";

export async function listAiClients() {
  return db.aiClient.findMany({
    include: { bindings: true },
    orderBy: { createdAt: "asc" },
  });
}
