import { createAiRunResultSchema, type AiContractRef, type AiFeatureManifest, type AiJsonObject, type AiObservationEnvelope } from "@chrona/contracts/ai-feature-runtime";
import { z } from "zod";
import type { AiFeatureCompilationContext, AiFeatureDefinition } from "./define-feature";
import type { AiFeatureProviderCapabilities } from "./provider-capabilities";

export type ProviderNeutralJsonSchema = AiJsonObject;

export type CompiledAiFeatureTool = {
  action: AiContractRef;
  name: string;
  inputSchema: ProviderNeutralJsonSchema;
  description?: string;
};

export type CompiledAiFeatureRequest = {
  feature: string;
  instructions: string;
  input: AiJsonObject;
  tools: readonly CompiledAiFeatureTool[];
  structuredOutputSchema: ProviderNeutralJsonSchema;
  clientOperationId: string;
};

/** Converts domain-owned schemas and an immutable feature-run snapshot into provider-neutral request data. */
export function compileAiFeatureRequest(input: {
  definition: AiFeatureDefinition;
  manifest: AiFeatureManifest;
  context: AiFeatureCompilationContext;
  instructions: string;
  clientOperationId: string;
}): CompiledAiFeatureRequest {
  const { definition, manifest, context, instructions, clientOperationId } = input;
  const tools = manifest.actions.flatMap((binding) => {
    if (binding.mode !== "invoke") return [];
    const action = definition.actions.find(({ binding: candidate }) => candidate.mode === "invoke"
      && candidate.action.id === binding.action.id
      && candidate.action.version === binding.action.version);
    if (!action?.inputSchema) throw new Error(`Feature invoke action has no input schema: ${binding.action.id}:${binding.action.version}`);
    return [{
      action: binding.action,
      name: binding.action.id,
      inputSchema: z.toJSONSchema(action.inputSchema, { target: "draft-07", unrepresentable: "any" }) as unknown as ProviderNeutralJsonSchema,
      ...(action.description ? { description: action.description } : {}),
    }];
  });
  return {
    feature: manifest.feature.id,
    instructions,
    clientOperationId,
    tools,
    structuredOutputSchema: z.toJSONSchema(
      createAiRunResultSchema(definition.outputSchema, definition.partialOutputSchema ?? definition.outputSchema),
      { target: "draft-07", unrepresentable: "any" },
    ) as unknown as ProviderNeutralJsonSchema,
    input: {
      objective: context.objective,
      observations: context.observations as AiObservationEnvelope[],
      terminalResultContract: {
        supportedStatuses: manifest.supportedTerminalStatuses,
        output: manifest.output,
        completion: manifest.completion,
      },
    },
  };
}

/** A provider turn is either terminal or a single engine-managed invoke request. */
export type AiFeatureProviderTurn =
  | { kind: "terminal"; candidate: unknown; providerRunRef?: string; providerResumeRef?: string }
  | { kind: "invoke_action"; action: AiContractRef; callId: string; input: AiJsonObject; providerRunRef?: string; providerResumeRef?: string };

export type AiFeatureProviderStart = AiFeatureProviderTurn & {
  providerRunRef: string;
  providerResumeRef: string;
};


/**
 * Provider-neutral durable protocol. Every transition carries recoverable refs;
 * action results are accepted only after their domain result has been persisted.
 */
export type AiFeatureProviderPort = {
  capabilities: AiFeatureProviderCapabilities;
  startOrAttach(request: CompiledAiFeatureRequest, existingProviderRunRef?: string): Promise<AiFeatureProviderStart>;
  resume(input: { providerRunRef: string; providerResumeRef: string; clientOperationId: string; request: CompiledAiFeatureRequest }): Promise<AiFeatureProviderTurn>;
  submitActionResult(input: {
    providerRunRef: string;
    providerResumeRef: string;
    clientOperationId: string;
    request: CompiledAiFeatureRequest;
    callId: string;
    action: AiContractRef;
    outputObservation: AiObservationEnvelope;
  }): Promise<AiFeatureProviderTurn>;
};
