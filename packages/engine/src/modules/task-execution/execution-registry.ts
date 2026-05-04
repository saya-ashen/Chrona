import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import type { OpenClawAdapterConfig } from "@chrona/openclaw";
import { getRuntimeAdapterDefinition } from "@/modules/task-execution/registry";
import { db } from "@/lib/db";

type RuntimeExecutionFactory = (config?: OpenClawAdapterConfig) => Promise<RuntimeExecutionAdapter>;

const runtimeExecutionFactories = new Map<string, RuntimeExecutionFactory>([
  [
    "openclaw",
    async (config) => (await import("@chrona/openclaw")).createRuntimeAdapter(config),
  ],
  [
    "research",
    async () => (await import("@/modules/research-execution/adapter")).createResearchRuntimeAdapter(),
  ],
]);

export function overrideRuntimeExecutionAdapter(key: string, factory: RuntimeExecutionFactory): void {
  runtimeExecutionFactories.set(key, factory);
}

async function loadOpenClawAdapterConfig(): Promise<OpenClawAdapterConfig | undefined> {
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
