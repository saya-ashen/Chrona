import { db } from "@/lib/db";
import type { AiFeature } from "@chrona/contracts";
import { getAiClient } from "./client-registry";

export async function getClientForFeature(
  feature: AiFeature,
): Promise<Awaited<ReturnType<typeof getAiClient>>> {
  const binding = await db.aiFeatureBinding.findUnique({
    where: { feature },
  });

  return getAiClient(binding?.clientId ?? null);
}
