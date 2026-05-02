import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import type { OpenClawAdapterConfig } from "@chrona/openclaw-integration/runtime/adapter";
import { getRuntimeAdapterDefinition } from "@/modules/task-execution/registry";
import { db } from "@/lib/db";

const runtimeExecutionFactories = new Map<string, (config?: OpenClawAdapterConfig) => Promise<RuntimeExecutionAdapter>>([
  [
    "openclaw",
    async (config) => (await import("@chrona/openclaw-integration/runtime/adapter")).createRuntimeAdapter(config),
  ],
  [
    "research",
    async () => (await import("@/modules/research-execution/adapter")).createResearchRuntimeAdapter(),
  ],
]);

async function loadOpenClawAdapterConfig(): Promise<OpenClawAdapterConfig | undefined> {
  const client = await db.aiClient.findFirst({
    where: { type: "openclaw", isDefault: true, enabled: true },
  });
  if (!client) return undefined;
  const config = client.config as Record<string, unknown> | null;
  if (!config) return undefined;
  const gatewayUrl = typeof config.gatewayUrl === "string" ? config.gatewayUrl : "";
  const gatewayToken = typeof config.gatewayToken === "string" ? config.gatewayToken : "";
  if (!gatewayUrl) return undefined;
  return { gatewayHttpUrl: gatewayUrl, gatewayToken };
}

export async function createRuntimeExecutionAdapter(key: string): Promise<RuntimeExecutionAdapter> {
  const definition = getRuntimeAdapterDefinition(key);
  const factory = runtimeExecutionFactories.get(definition.key);

  if (!factory) {
    throw new Error(`No execution adapter registered for runtime: ${definition.key}`);
  }

  if (definition.key === "openclaw") {
    const config = await loadOpenClawAdapterConfig();
    return factory(config);
  }
  return factory();
}


