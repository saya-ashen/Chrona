import {
  buildResearchRunPrompt,
  getResearchTaskConfigSpec,
  RESEARCH_EXECUTION_RUNTIME,
  validateResearchTaskConfig,
} from "@/modules/research-execution/config";
import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";
import { createOpenClawAdapter } from "@chrona/openclaw";

export {
  buildResearchRunPrompt,
  getResearchTaskConfigSpec,
  RESEARCH_EXECUTION_RUNTIME,
  validateResearchTaskConfig,
};

export async function createResearchRuntimeAdapter(
  baseAdapter?: RuntimeExecutionAdapter,
): Promise<RuntimeExecutionAdapter> {
  const runtimeAdapter: RuntimeExecutionAdapter =
    baseAdapter ?? (await createOpenClawAdapter());

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
