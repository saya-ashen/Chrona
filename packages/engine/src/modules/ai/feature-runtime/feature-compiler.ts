import {
	createAiRunResultSchema,
	type AiContractRef,
	type AiFeatureManifest,
	type AiJsonObject,
	type AiObservationEnvelope,
} from "@chrona/contracts/ai-feature-runtime";
import { z } from "zod";
import type {
	AiFeatureCompilationContext,
	AiFeatureDefinition,
} from "./define-feature";
import type { AiFeatureProviderCapabilities } from "./provider-capabilities";

export type ProviderNeutralJsonSchema = AiJsonObject;

export type CompiledAiFeatureTool = {
	action: AiContractRef;
	name: string;
	inputSchema: ProviderNeutralJsonSchema;
	description?: string;
};
export type CompiledAiFeatureTerminalTool = {
	name: string;
	inputSchema: ProviderNeutralJsonSchema;
	description: string;
};

export type CompiledAiFeatureRequest = {
	feature: string;
	instructions: string;
	input: AiJsonObject;
	tools: readonly CompiledAiFeatureTool[];
	terminalTool: CompiledAiFeatureTerminalTool;
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
	const { definition, manifest, context, instructions, clientOperationId } =
		input;
	const tools = manifest.actions.flatMap((binding) => {
		if (binding.mode !== "invoke") return [];
		const action = definition.actions.find(
			({ binding: candidate }) =>
				candidate.mode === "invoke" &&
				candidate.action.id === binding.action.id &&
				candidate.action.version === binding.action.version,
		);
		if (!action?.inputSchema)
			throw new Error(
				`Feature invoke action has no input schema: ${binding.action.id}:${binding.action.version}`,
			);
		return [
			{
				action: binding.action,
				name: binding.action.id,
				inputSchema: z.toJSONSchema(action.inputSchema, {
					target: "draft-07",
					unrepresentable: "any",
				}) as unknown as ProviderNeutralJsonSchema,
				...(action.description ? { description: action.description } : {}),
			},
		];
	});
	const terminalResultSchema = z.toJSONSchema(
		createAiRunResultSchema(
			definition.outputSchema,
			definition.partialOutputSchema ?? definition.outputSchema,
		),
		{ target: "draft-07", unrepresentable: "any" },
	) as unknown as ProviderNeutralJsonSchema;
	const terminalToolInputSchema = {
		type: "object",
		properties: { result: terminalResultSchema },
		required: ["result"],
		additionalProperties: false,
	} as unknown as ProviderNeutralJsonSchema;
	const terminalTool: CompiledAiFeatureTerminalTool = {
		name: "chrona_feature_complete",
		description: `Submit the completed terminal result for ${manifest.feature.id}. This tool call is the only authoritative structured result.`,
		inputSchema: terminalToolInputSchema,
	};
	return {
		feature: manifest.feature.id,
		instructions: [
			instructions,
			"Evidence references must use an observationId from the frozen observations. An optional path is a JSON Pointer relative to that observation's data value; omit path to cite the entire observation. Never prefix a path with /data.",
			`You must call the terminal tool ${terminalTool.name} exactly once with the complete terminal result. Plain text and JSON in assistant messages are not results.`,
		].join("\n"),
		clientOperationId,
		tools,
		terminalTool,
		structuredOutputSchema: terminalResultSchema,
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

export type AiFeatureProviderErrorCode =
	| "provider_authentication_error"
	| "provider_configuration_error"
	| "provider_permission_error"
	| "provider_quota_exceeded"
	| "provider_rate_limited"
	| "provider_request_error"
	| "provider_unavailable"
	| "provider_network_error"
	| "provider_protocol_error"
	| "provider_timeout"
	| "cancelled";

const PROVIDER_ERROR_PATTERNS: ReadonlyArray<
	readonly [AiFeatureProviderErrorCode, RegExp]
> = [
	["provider_timeout", /\b(?:408|etimedout)\b|timed? out|timeout/i],
	[
		"provider_quota_exceeded",
		/\b402\b|billing|balance|credit(?:s)?|insufficient funds|payment required|quota/i,
	],
	[
		"provider_authentication_error",
		/\b401\b|api key required|invalid api key|missing api key|unauthenticated|unauthorized|authentication failed/i,
	],
	[
		"provider_configuration_error",
		/no model selected|select a model|no provider configured|provider (?:is )?not configured|configuration (?:is )?incomplete/i,
	],
	[
		"provider_permission_error",
		/\b403\b|forbidden|permission denied|access denied/i,
	],
	[
		"provider_rate_limited",
		/\b429\b|rate.?limit|too many requests/i,
	],
	[
		"provider_request_error",
		/\b(?:400|404)\b|bad request|invalid request|model (?:is )?(?:not found|unavailable|unsupported)|unknown model/i,
	],
	[
		"provider_unavailable",
		/\b(?:500|502|503|504)\b|service unavailable|temporarily unavailable|provider overloaded|upstream error/i,
	],
	[
		"provider_network_error",
		/\b(?:econnrefused|econnreset|enotfound|enetunreach)\b|connection (?:closed|ended|reset|refused)|fetch failed|network error|socket hang up/i,
	],
];

export function classifyAiFeatureProviderError(
	message: string,
): AiFeatureProviderErrorCode {
	return (
		PROVIDER_ERROR_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0] ??
		"provider_protocol_error"
	);
}

/** Known provider terminal failure, distinct from an ambiguous start outcome. */
export class AiFeatureProviderError extends Error {
	constructor(
		public readonly code: AiFeatureProviderErrorCode,
		message: string,
	) {
		super(message);
		this.name = "AiFeatureProviderError";
	}
}

/** A provider turn is either terminal or a single engine-managed invoke request. */
export type AiFeatureProviderTurn =
	| {
			kind: "terminal";
			candidate: unknown;
			providerRunRef?: string;
			providerResumeRef?: string;
	  }
	| {
			kind: "invoke_action";
			action: AiContractRef;
			callId: string;
			input: AiJsonObject;
			providerRunRef?: string;
			providerResumeRef?: string;
	  };

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
	startOrAttach(
		request: CompiledAiFeatureRequest,
		existingProviderRunRef?: string,
	): Promise<AiFeatureProviderStart>;
	resume(input: {
		providerRunRef: string;
		providerResumeRef: string;
		clientOperationId: string;
		request: CompiledAiFeatureRequest;
	}): Promise<AiFeatureProviderTurn>;
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
