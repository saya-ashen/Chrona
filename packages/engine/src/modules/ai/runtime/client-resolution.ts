import { db } from "@/lib/db";
import type {
  AiClientRecord,
  AiClientType,
  AiFeature,
} from "@chrona/contracts";

function toAiClientRecord(client: {
  id: string;
  name: string;
  type: string;
  config: unknown;
  isDefault: boolean;
  enabled: boolean;
}): AiClientRecord {
  return {
    id: client.id,
    name: client.name,
    type: client.type as AiClientType,
    config: client.config as AiClientRecord["config"],
    isDefault: client.isDefault,
    enabled: client.enabled,
  };
}

export async function getClientForFeature(
  feature: AiFeature,
): Promise<AiClientRecord | null> {
  const binding = await db.aiFeatureBinding.findUnique({
    where: { feature },
    include: { client: true },
  });

  if (binding?.client?.enabled) {
    return toAiClientRecord(binding.client);
  }

  const defaultClient = await db.aiClient.findFirst({
    where: { isDefault: true, enabled: true },
  });

  return defaultClient ? toAiClientRecord(defaultClient) : null;
}
