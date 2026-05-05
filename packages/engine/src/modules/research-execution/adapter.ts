import {
  buildResearchRunPrompt,
  getResearchTaskConfigSpec,
  RESEARCH_RUNTIME_ADAPTER_KEY,
  RESEARCH_RUNTIME_INPUT_VERSION,
  validateResearchTaskConfig,
} from "@/modules/research-execution/config";
import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";

export {
  buildResearchRunPrompt,
  getResearchTaskConfigSpec,
  RESEARCH_RUNTIME_ADAPTER_KEY,
  RESEARCH_RUNTIME_INPUT_VERSION,
  validateResearchTaskConfig,
};

export async function createResearchRuntimeAdapter(
  baseAdapter?: RuntimeExecutionAdapter,
): Promise<RuntimeExecutionAdapter> {
  const runtimeAdapter: RuntimeExecutionAdapter =
    baseAdapter ??
    (await (await import("@chrona/providers-core")).createRuntimeAdapter()) as unknown as RuntimeExecutionAdapter;

  return {
    ...runtimeAdapter,
    async createRun(input) {
      return runtimeAdapter.createRun({
        ...input,
        prompt: buildResearchRunPrompt(input.runtimeInput),
      });
    },
  };
}
