import {
  buildResearchRunPrompt,
  getResearchTaskConfigSpec,
  RESEARCH_RUNTIME_ADAPTER_KEY,
  RESEARCH_RUNTIME_INPUT_VERSION,
  validateResearchTaskConfig,
} from "@/modules/runtime/research/config";
import type { RuntimeExecutionAdapter } from "@/modules/runtime/types";

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
  const runtimeAdapter =
    baseAdapter ??
    (await (await import("@/modules/runtime/openclaw/adapter")).createRuntimeAdapter());

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
