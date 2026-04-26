import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import { getRuntimeAdapterDefinition } from "@/modules/task-execution/registry";

const runtimeExecutionFactories = new Map<string, () => Promise<RuntimeExecutionAdapter>>([
  [
    "openclaw",
    async () => (await import("@chrona/openclaw-integration/runtime/adapter")).createRuntimeAdapter(),
  ],
  [
    "research",
    async () => (await import("@/modules/research-execution/adapter")).createResearchRuntimeAdapter(),
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


