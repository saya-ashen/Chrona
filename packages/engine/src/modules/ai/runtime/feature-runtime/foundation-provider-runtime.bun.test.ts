import { describe, expect, it, mock } from "bun:test";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type { CompiledAiFeatureRequest } from "../../feature-runtime";
import {
	createFoundationFeatureStartInput,
	FoundationProviderRuntime,
} from "./foundation-provider-runtime";

const request: CompiledAiFeatureRequest = {
	feature: "test.feature",
	instructions: "Return a terminal result.",
	input: {},
	tools: [],
	terminalTool: {
		name: "chrona_feature_complete",
		description: "Submit terminal result.",
		inputSchema: { type: "object" },
	},
	structuredOutputSchema: { type: "object" },
	clientOperationId: "feature-run-1",
};

function provider() {
	const lookups: unknown[] = [];
	const client = {
		provider: "fake",
		async getCapabilities() {
			return {
				supportsSessions: true,
				supportsStreaming: true,
				supportsRunLookup: true,
				supportsCancellation: true,
				supportsToolCalls: true,
				supportsPreviousResponse: false,
				actionInvocation: "unsupported" as const,
				startIdempotency: "client_operation_id" as const,
				recovery: {
					sessionResume: true,
					historyReplay: true,
					activeRunLookup: true,
					streamReconnect: true,
					crossProcessDurable: true,
					providerResumeRef: true,
					runEventReplay: true,
					mode: "authoritative_run_lookup" as const,
				},
			};
		},
		getRun: mock(async (input: unknown) => {
			lookups.push(input);
			return {
				provider: "fake",
				runId: "provider-run-1",
				sessionId: "provider-session-1",
				providerResumeRef: "provider-resume-1",
				status: "completed" as const,
				terminalToolCall: {
					name: "chrona_feature_complete",
					callId: "terminal-1",
					input: { result: { status: "completed" } },
				},
				structuredPayload: { status: "completed" },
			};
		}),
	} as unknown as AgentProviderClient;
	return { client, lookups };
}

describe("FoundationProviderRuntime recovery references", () => {
	it("looks up a persisted run by run ID and preserves the provider-native resume ref", async () => {
		const fake = provider();
		const runtime = await new FoundationProviderRuntime(
			"test.feature",
			fake.client,
		).initialize();

		const turn = await runtime.startOrAttach(request, "provider-run-1");

		expect(fake.lookups).toEqual([{ runId: "provider-run-1" }]);
		expect(turn).toMatchObject({
			kind: "terminal",
			providerRunRef: "provider-run-1",
			providerResumeRef: "provider-resume-1",
		});
		expect(runtime.capabilities).toMatchObject({
			startRecovery: "durable_attach",
		});
	});

	it("does not reinterpret an opaque resume ref as a provider session ID", async () => {
		const fake = provider();
		const runtime = await new FoundationProviderRuntime(
			"test.feature",
			fake.client,
		).initialize();

		const turn = await runtime.resume({
			providerRunRef: "provider-run-1",
			providerResumeRef: "persisted-opaque-resume",
			clientOperationId: request.clientOperationId,
			request,
		});

		expect(fake.lookups).toEqual([{ runId: "provider-run-1" }]);
		expect(turn).toMatchObject({
			kind: "terminal",
			providerRunRef: "provider-run-1",
			providerResumeRef: "provider-resume-1",
		});
	});
	it("maps explicitly safe adapters to one read-only start and disables provider-native tools", async () => {
		const client = {
			provider: "read-only-fake",
			async getCapabilities() {
				return {
					supportsSessions: true,
					supportsStreaming: true,
					supportsRunLookup: true,
					supportsCancellation: true,
					supportsToolCalls: true,
					supportsPreviousResponse: false,
					actionInvocation: "unsupported" as const,
					startIdempotency: "unsupported" as const,
					readOnlySingleAttempt: true,
					recovery: {
						sessionResume: true,
						historyReplay: true,
						activeRunLookup: false,
						streamReconnect: false,
						crossProcessDurable: false,
						providerResumeRef: true,
						runEventReplay: false,
						mode: "session_history" as const,
					},
				};
			},
		} as unknown as AgentProviderClient;
		const runtime = await new FoundationProviderRuntime(
			"test.feature",
			client,
		).initialize();
		const startInput = createFoundationFeatureStartInput(request);

		expect(runtime.capabilities).toEqual({
			startRecovery: "single_attempt_read_only",
			actionInvocation: "unsupported",
		});
		expect(startInput.toolPolicy).toBe("terminal_only");
		expect(startInput.terminalToolName).toBe("chrona_feature_complete");
		expect(startInput.tools).toHaveLength(1);
	});

	it("classifies an observed provider run failure as a known protocol error", async () => {
		const run = {
			provider: "read-only-fake",
			runId: "provider-run-failed",
			sessionId: "provider-session-failed",
			providerResumeRef: "provider-run-failed",
			status: "running" as const,
			startedAt: "2026-08-10T06:11:02.000Z",
			stream: { supported: true, reconnectable: false },
		};
		const client = {
			provider: run.provider,
			async getCapabilities() {
				return {
					supportsSessions: true,
					supportsStreaming: true,
					supportsRunLookup: false,
					supportsCancellation: true,
					supportsToolCalls: true,
					supportsPreviousResponse: false,
					actionInvocation: "unsupported" as const,
					startIdempotency: "unsupported" as const,
					readOnlySingleAttempt: true,
					recovery: {
						sessionResume: true,
						historyReplay: true,
						activeRunLookup: false,
						streamReconnect: false,
						crossProcessDurable: false,
						providerResumeRef: true,
						runEventReplay: false,
						mode: "session_history" as const,
					},
				};
			},
			async startRun() {
				return run;
			},
			async *streamRun() {
				yield {
					type: "run_failed" as const,
					provider: run.provider,
					runId: run.runId,
					sessionId: run.sessionId,
					sequence: 0,
					run: { ...run, status: "failed" as const },
					error: "Provider response stream closed before completion.",
				};
			},
		} as unknown as AgentProviderClient;
		const runtime = await new FoundationProviderRuntime(
			"test.feature",
			client,
		).initialize();

		await expect(runtime.startOrAttach(request)).rejects.toMatchObject({
			name: "AiFeatureProviderError",
			code: "provider_protocol_error",
			message: "Provider response stream closed before completion.",
		});
	});
});
