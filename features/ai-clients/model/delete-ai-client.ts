import { db } from "@chrona/db";
import { ensureEnabledAiClientDefault } from "./default-ai-client";

export async function deleteAiClient(clientId: string) {
  await db.aiClient.delete({ where: { id: clientId } });
  await ensureEnabledAiClientDefault();
}
