import type { ProviderRunInput } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { ProviderDeclaration } from "./agent-provider";
import { providerCompletionBudgetSchema } from "./agent-provider";
import { settleRunCompletion } from "./agent-completion-settlement";
import { awaitRegisteredCompletion, releaseRegisteredCompletion } from "./execution-delivery-completion";

interface CompletionContext {
  ports: StewardPorts;
  workspaceId: string;
  input: ProviderRunInput;
  operationId: string;
  deadline: ProviderRunInput["deadline"];
  binding: { completion: unknown; providerOptions: unknown };
  declaration: ProviderDeclaration;
  endpoint: Parameters<typeof awaitRegisteredCompletion>[0];
  releaseCallback: () => void;
}

/** Reconcile one claimed completion without replaying uncertain acceptance or releasing unknown effects. */
export async function startProviderCompletion(context: CompletionContext) {
  const { ports, workspaceId, input, operationId, deadline, binding, declaration, endpoint, releaseCallback } = context;
  const budget = providerCompletionBudgetSchema.parse(binding.completion);
  const options = binding.providerOptions as Record<string, unknown>;
  const timeoutMs = Math.max(1, Math.min(budget.limits.eventTimeoutMs, deadline ? deadline.getTime() - ports.now().getTime() : budget.limits.eventTimeoutMs));
  let durablySettled = false;
  try {
    const settled = await awaitRegisteredCompletion(endpoint, operationId, {
      commandKey: operationId, prompt: input.prompt,
      maxOutputTokens: Math.min(budget.maxOutputTokens, budget.limits.maxOutputTokens), timeoutMs,
      ...(declaration.configuration?.revision ? { configurationRevision: declaration.configuration.revision } : {}),
      ...(typeof options.model === "string" ? { model: options.model } : {}),
      ...(typeof options.thinking === "string" ? { thinking: options.thinking } : {}),
      ...(typeof options.system === "string" ? { system: options.system } : {}),
    }, timeoutMs);
    const outcome = await settleRunCompletion(ports, workspaceId, operationId, settled, [input.token]);
    durablySettled = true;
    return outcome;
  } finally {
    releaseCallback();
    if (durablySettled) await releaseRegisteredCompletion(endpoint, operationId);
  }
}
