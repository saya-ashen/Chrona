import { db } from "@/lib/db";
import type { AiFeature } from "@chrona/contracts";
import { aiClientRegistry } from "./client-registry";

export async function getClientForFeature(
  feature: AiFeature,
): Promise<Awaited<ReturnType<typeof aiClientRegistry.get>>> {
  const binding = await db.aiFeatureBinding.findUnique({
    where: { feature },
  });

  return aiClientRegistry.get(binding?.clientId ?? null);
}
