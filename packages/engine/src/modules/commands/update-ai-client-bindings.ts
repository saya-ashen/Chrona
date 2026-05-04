import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";

interface UpdateBindingsInput {
  clientId: string;
  features: string[];
  validFeatureSet: ReadonlySet<string>;
}

export async function updateAiClientBindings(input: UpdateBindingsInput) {
  const { clientId, features, validFeatureSet } = input;

  const client = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!client) {
    throw new Error("Client not found");
  }

  const validFeatures = [...new Set(features.filter((f) => validFeatureSet.has(f)))];

  await db.$transaction(async (tx) => {
    if (validFeatures.length > 0) {
      await tx.aiFeatureBinding.deleteMany({ where: { feature: { in: validFeatures } } });
    }

    await tx.aiFeatureBinding.deleteMany({
      where: { clientId, feature: { notIn: validFeatures } },
    });

    for (const feature of validFeatures) {
      await tx.aiFeatureBinding.create({
        data: {
          id: randomUUID().replace(/-/g, "").slice(0, 25),
          feature,
          clientId,
        },
      });
    }
  });

  return validFeatures;
}
