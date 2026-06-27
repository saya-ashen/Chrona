import { db } from "@/lib/db";

export async function listAiClients() {
  return db.aiClient.findMany({
    include: { bindings: true },
    orderBy: { createdAt: "asc" },
  });
}
