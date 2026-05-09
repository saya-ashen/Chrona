import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import {
  createOpenClawAdapter,
  OPENCLAW_EXECUTION_RUNTIME,
  type OpenClawAdapterConfig,
} from "@chrona/openclaw";
import { getRuntimeAdapterDefinition } from "@/modules/task-execution/registry";
import { db } from "@/lib/db";

type RuntimeAdapterFactory = (
  config?: OpenClawAdapterConfig,
) => Promise<RuntimeExecutionAdapter>;

const runtimeAdapterFactories = new Map<string, RuntimeAdapterFactory>([
  [OPENCLAW_EXECUTION_RUNTIME, createOpenClawAdapter],
  [
    "research",
    async (config) =>
      (await import("@/modules/research-execution/adapter")).createResearchRuntimeAdapter(
        await createOpenClawAdapter(config),
      ),
  ],
]);

export function overrideRuntimeExecutionAdapter(
  key: string,
  factory: RuntimeAdapterFactory,
): void {
  runtimeAdapterFactories.set(key, factory);
}

async function loadAdapterConfig(): Promise<OpenClawAdapterConfig | undefined> {
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
  const factory = runtimeAdapterFactories.get(definition.key);
  if (!factory) {
    throw new Error(`No runtime adapter factory registered for key: ${definition.key}`);
  }
  const config =
    definition.key === OPENCLAW_EXECUTION_RUNTIME || definition.key === "research"
      ? await loadAdapterConfig()
      : undefined;
  return factory(config);
}
