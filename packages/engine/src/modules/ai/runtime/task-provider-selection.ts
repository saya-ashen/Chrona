import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { stableJsonHash } from "../feature-runtime/stable-json";

type DbClient = Prisma.TransactionClient | typeof db;

export type TaskExecutionProviderSelection = {
  clientId: string;
  clientName: string;
  providerName: string;
  configFingerprint: string;
};

/**
 * Resolve the sole authoritative provider selection for task execution.
 *
 * Precedence matches the runtime registry: an explicit task client, then the
 * task.execution feature binding, then the enabled default/first client.
 * Legacy task/workspace adapter fields intentionally do not participate.
 */
export async function resolveTaskExecutionProviderSelection(input: {
  aiClientId?: string | null;
  client?: DbClient;
}): Promise<TaskExecutionProviderSelection | null> {
  const client = input.client ?? db;
  const enabledClients = await client.aiClient.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      isDefault: true,
    },
  });

  let selected = input.aiClientId
    ? enabledClients.find((candidate) => candidate.id === input.aiClientId)
    : undefined;

  if (!input.aiClientId) {
    const binding = await client.aiFeatureBinding.findUnique({
      where: { feature: "task.execution" },
      select: { clientId: true },
    });
    selected = binding
      ? enabledClients.find((candidate) => candidate.id === binding.clientId)
      : enabledClients.find((candidate) => candidate.isDefault) ?? enabledClients[0];
  }

  if (!selected) return null;

  return {
    clientId: selected.id,
    clientName: selected.name,
    providerName: selected.type,
    configFingerprint: stableJsonHash(selected.config),
  };
}

export function unresolvedTaskProviderName() {
  return "unconfigured";
}
