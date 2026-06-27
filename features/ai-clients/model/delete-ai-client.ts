import { db } from "@/lib/db";

export async function deleteAiClient(clientId: string) {
  await db.aiClient.delete({ where: { id: clientId } });
}
