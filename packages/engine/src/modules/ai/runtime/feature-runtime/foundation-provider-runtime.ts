import type { AiFeature, AiJsonObject } from "@chrona/contracts";
import {
	supportsDurableFeatureRuntime,
	supportsSafeTerminalOnlyFeatureRuntime,
	type AgentProviderClient,
	type ProviderRunEvent,
	type ProviderRunRef,
	type StartRunInput,
} from "@chrona/providers-foundation";
import {
	AiFeatureProviderError,
	classifyAiFeatureProviderError,
	type AiFeatureProviderPort,
	type AiFeatureProviderStart,
	type AiFeatureProviderTurn,
	type CompiledAiFeatureRequest,
} from "../../feature-runtime/feature-compiler";
import type { AiFeatureProviderCapabilities } from "../../feature-runtime/provider-capabilities";
import { getAiClientForFeature } from "../client-resolution";
import { aiClientRegistry } from "../client-registry";
import { createProviderStreamEventBoundary } from "../../provider-stream-contract";
import { stableJsonHash } from "../../feature-runtime/stable-json";

function providerCapabilities(
	capabilities: Awaited<ReturnType<AgentProviderClient["getCapabilities"]>>,
): AiFeatureProviderCapabilities {
	return {
		startRecovery: supportsDurableFeatureRuntime(capabilities)
			? "durable_attach"
			: supportsSafeTerminalOnlyFeatureRuntime(capabilities)
				? "single_attempt_read_only"
				: "unsupported",
		actionInvocation: capabilities.actionInvocation ?? "unsupported",
	};
}

function toolDefinitions(request: CompiledAiFeatureRequest) {
	const actionTools = request.tools.map(
		({ name, description, inputSchema }) => ({
			name,
			...(description ? { description } : {}),
			inputSchema,
		}),
	);
	return [
		...actionTools,
		{
			name: request.terminalTool.name,
			description: request.terminalTool.description,
			inputSchema: request.terminalTool.inputSchema,
		},
	];
}
export function createFoundationFeatureStartInput(
	request: CompiledAiFeatureRequest,
): StartRunInput {
	return {
		clientOperationId: request.clientOperationId,
		sessionId: request.clientOperationId,
		sessionKey: request.clientOperationId,
		instructions: request.instructions,
		input: request.input,
		tools: toolDefinitions(request),
		structuredOutputSchema: {
			name: `${request.feature}.result`,
			description: `Terminal result contract for ${request.feature}.`,
			schema: request.structuredOutputSchema,
		},
		terminalToolName: request.terminalTool.name,
		toolPolicy: request.tools.length > 0 ? "full" : "terminal_only",
		stream: true,
	};
}

function terminalPayload(input: unknown): unknown {
	if (
		input &&
		typeof input === "object" &&
		!Array.isArray(input) &&
		"result" in input
	) {
		return (input as Record<string, unknown>).result;
	}
	return input;
}
function terminalCandidate(
	event: Extract<ProviderRunEvent, { type: "run_completed" }>,
): unknown {
	return terminalPayload(
		event.terminalToolCall?.input ?? event.structuredPayload,
	);
}

export type FoundationProviderBinding = {
	providerClientId: string;
	providerName: string;
	providerConfigFingerprint: string;
};
/** Concrete adapter from the provider foundation protocol to the pure feature runtime port. */
export class FoundationProviderRuntime implements AiFeatureProviderPort {
	capabilities: AiFeatureProviderCapabilities = {
		startRecovery: "unsupported",
		actionInvocation: "unsupported",
	};

	private binding: FoundationProviderBinding | null = null;

	constructor(
		private readonly feature: string,
		private provider: AgentProviderClient | null = null,
		private readonly signal?: AbortSignal,
	) {}

	async initialize(expected?: FoundationProviderBinding): Promise<this> {
		if (!this.provider) {
			const client = expected?.providerClientId
				? await aiClientRegistry.get(expected.providerClientId)
				: await getAiClientForFeature(this.feature as AiFeature);
			if (!client)
				throw new Error(
					`No AI client is configured for feature '${this.feature}'.`,
				);
			const providerClient = aiClientRegistry.requireProviderClient(client);
			const binding = {
				providerClientId: providerClient.record.id,
				providerName: providerClient.providerClient.provider,
				providerConfigFingerprint: stableJsonHash(providerClient.record.config),
			};
			if (
				expected &&
				(binding.providerClientId !== expected.providerClientId ||
					binding.providerName !== expected.providerName ||
					binding.providerConfigFingerprint !==
						expected.providerConfigFingerprint)
			) {
				throw new Error(
					`Persisted AI provider binding for feature '${this.feature}' is no longer available.`,
				);
			}
			this.provider = providerClient.providerClient;
			this.binding = binding;
		}
		this.capabilities = providerCapabilities(
			await this.provider.getCapabilities(),
		);
		return this;
	}

	providerBinding(): FoundationProviderBinding {
		if (!this.binding)
			throw new Error(
				"Foundation provider binding is unavailable for an injected provider client.",
			);
		return this.binding;
	}

	async startOrAttach(
		request: CompiledAiFeatureRequest,
		existingProviderRunRef?: string,
	): Promise<AiFeatureProviderStart> {
		const provider = this.requireProvider();
		if (existingProviderRunRef) {
			const snapshot = await provider.getRun({ runId: existingProviderRunRef });
			if (
				snapshot.provider !== provider.provider ||
				snapshot.runId !== existingProviderRunRef
			) {
				throw new Error(
					`Persisted provider run '${existingProviderRunRef}' belongs to a different provider authority.`,
				);
			}
			const providerResumeRef =
				snapshot.providerResumeRef ?? existingProviderRunRef;
			if (snapshot.status === "completed") {
				return {
					kind: "terminal",
					candidate: terminalPayload(snapshot.terminalToolCall?.input),
					providerRunRef: existingProviderRunRef,
					providerResumeRef,
				};
			}
			if (snapshot.status === "failed" || snapshot.status === "cancelled") {
				throw new Error(`Persisted provider run is ${snapshot.status}.`);
			}
			const turn = await this.nextTurn(
				provider,
				{
					provider: provider.provider,
					runId: existingProviderRunRef,
					sessionId: snapshot.sessionId ?? request.clientOperationId,
					providerResumeRef,
				},
				request,
			);
			return {
				...turn,
				providerRunRef: existingProviderRunRef,
				providerResumeRef,
			};
		}
		const run = await provider.startRun({
			...createFoundationFeatureStartInput(request),
			signal: this.signal,
		});
		if (run.provider !== provider.provider) {
			throw new Error(
				`Provider start returned a run for a different provider authority.`,
			);
		}
		const turn = await this.nextTurn(provider, run, request);
		return {
			...turn,
			providerRunRef: run.runId,
			providerResumeRef: run.providerResumeRef ?? run.runId,
		};
	}

	async resume(input: {
		providerRunRef: string;
		providerResumeRef: string;
		clientOperationId: string;
		request: CompiledAiFeatureRequest;
	}): Promise<AiFeatureProviderTurn> {
		const provider = this.requireProvider();
		const snapshot = await provider.getRun({ runId: input.providerRunRef });
		if (
			snapshot.provider !== provider.provider ||
			snapshot.runId !== input.providerRunRef
		) {
			throw new Error(
				`Persisted provider run '${input.providerRunRef}' belongs to a different provider authority.`,
			);
		}
		const providerResumeRef =
			snapshot.providerResumeRef ?? input.providerResumeRef;
		if (snapshot.status === "completed") {
			return {
				kind: "terminal",
				candidate: terminalPayload(snapshot.terminalToolCall?.input),
				providerRunRef: input.providerRunRef,
				providerResumeRef,
			};
		}
		if (snapshot.status === "failed" || snapshot.status === "cancelled")
			throw new Error(`Persisted provider run is ${snapshot.status}.`);
		return this.nextTurn(
			provider,
			{
				provider: provider.provider,
				runId: input.providerRunRef,
				sessionId: snapshot.sessionId ?? input.clientOperationId,
				providerResumeRef,
			},
			input.request,
		);
	}

	async submitActionResult(input: {
		providerRunRef: string;
		providerResumeRef: string;
		clientOperationId: string;
		request: CompiledAiFeatureRequest;
		callId: string;
		action: { id: string; version: number };
		outputObservation: AiJsonObject;
	}): Promise<AiFeatureProviderTurn> {
		const provider = this.requireProvider();
		if (!provider.submitToolResult)
			throw new Error(
				"Provider does not accept engine-managed action results.",
			);
		const submitted = await provider.submitToolResult({
			runId: input.providerRunRef,
			callId: input.callId,
			result: input.outputObservation,
		});
		if (submitted.code !== "accepted")
			throw new Error(`Provider rejected action result: ${submitted.code}.`);
		return this.nextTurn(
			provider,
			{
				provider: provider.provider,
				runId: input.providerRunRef,
				sessionId: input.clientOperationId,
				providerResumeRef: input.providerResumeRef,
			},
			input.request,
		);
	}

	private requireProvider(): AgentProviderClient {
		if (!this.provider)
			throw new Error("Foundation provider runtime was not initialized.");
		return this.provider;
	}

	private async nextTurn(
		provider: AgentProviderClient,
		run: ProviderRunRef,
		request: CompiledAiFeatureRequest,
	): Promise<AiFeatureProviderTurn> {
		const boundary = createProviderStreamEventBoundary(run);
		for await (const value of provider.streamRun({
			runId: run.runId,
			sessionId: run.sessionId,
			signal: this.signal,
		})) {
			const event = boundary.accept(value);
			if (event.type === "tool_call" && event.status === "pending") {
				if (event.tool === request.terminalTool.name) {
					return {
						kind: "terminal",
						candidate: terminalPayload(event.input),
						providerRunRef: run.runId,
						providerResumeRef: run.providerResumeRef ?? run.runId,
					};
				}
				const tool = request.tools.find(({ name }) => name === event.tool);
				if (!tool)
					throw new Error(
						`Provider requested undeclared action '${event.tool}'.`,
					);
				boundary.pauseAfterToolCall(event.callId);
				return {
					kind: "invoke_action",
					action: tool.action,
					callId: event.callId,
					input: event.input as AiJsonObject,
					providerRunRef: run.runId,
					providerResumeRef: run.providerResumeRef ?? run.runId,
				};
			}
			if (event.type === "run_completed") {
				return {
					kind: "terminal",
					candidate: terminalCandidate(event),
					providerRunRef: run.runId,
					providerResumeRef: run.providerResumeRef ?? run.runId,
				};
			}
			if (event.type === "run_failed") {
				throw new AiFeatureProviderError(
					classifyAiFeatureProviderError(event.error),
					event.error,
				);
			}
			if (event.type === "run_cancelled") {
				throw new AiFeatureProviderError(
					"cancelled",
					"Provider run was cancelled.",
				);
			}
		}
		boundary.finish();
		throw new AiFeatureProviderError(
			"provider_protocol_error",
			"Provider stream ended before a terminal result or action request.",
		);
	}
}
