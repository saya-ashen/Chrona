import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import {
  createRuntimeAdapter,
  DEFAULT_RUNTIME_ADAPTER_KEY,
  registerRuntimeAdapterFactory,
  type RuntimeAdapterConfig,
} from "@chrona/providers-core";
import { getRuntimeAdapterDefinition } from "@/modules/task-execution/registry";
import { db } from "@/lib/db";

registerRuntimeAdapterFactory("research", async () =>
  (await import("@/modules/research-execution/adapter")).createResearchRuntimeAdapter(),
);

export function overrideRuntimeExecutionAdapter(
  key: string,
  factory: (config?: RuntimeAdapterConfig) => Promise<RuntimeExecutionAdapter>,
): void {
  registerRuntimeAdapterFactory(key, factory);
}

async function loadAdapterConfig(): Promise<RuntimeAdapterConfig | undefined> {
  const client = await db.aiClient.findFirst({
    where: { type: "openclaw", isDefault: true, enabled: true },
  });
  if (!client) return undefined;
  const config = client.config as Record<string, unknown> | null;
  if (!config) return undefined;
  const bridgeUrl = typeof config.bridgeUrl === "string" ? config.bridgeUrl : "";
  const bridgeToken = typeof config.bridgeToken === "string" ? config.bridgeToken : "";
  if (!bridgeUrl) return undefined;
  return { bridgeUrl, bridgeToken };
}

export async function createRuntimeExecutionAdapter(key: string): Promise<RuntimeExecutionAdapter> {
  const definition = getRuntimeAdapterDefinition(key);
  const config = definition.key === DEFAULT_RUNTIME_ADAPTER_KEY ? await loadAdapterConfig() : undefined;
  return createRuntimeAdapter<RuntimeExecutionAdapter>(definition.key, config);
}
