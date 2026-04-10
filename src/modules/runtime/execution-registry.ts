import type { RuntimeExecutionAdapter } from "@/modules/runtime/types";
import { getRuntimeAdapterDefinition } from "@/modules/runtime/registry";

const runtimeExecutionFactories = new Map<string, () => Promise<RuntimeExecutionAdapter>>([
  [
    "openclaw",
    async () => (await import("@/modules/runtime/openclaw/adapter")).createRuntimeAdapter(),
  ],
  [
    "research",
    async () => (await import("@/modules/runtime/research/adapter")).createResearchRuntimeAdapter(),
  ],
]);

export async function createRuntimeExecutionAdapter(key: string): Promise<RuntimeExecutionAdapter> {
  const definition = getRuntimeAdapterDefinition(key);
  const factory = runtimeExecutionFactories.get(definition.key);

  if (!factory) {
    throw new Error(`No execution adapter registered for runtime: ${definition.key}`);
  }

  return factory();
}
