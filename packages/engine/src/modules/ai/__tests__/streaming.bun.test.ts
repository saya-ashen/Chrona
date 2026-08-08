import { describe, expect, it, mock } from "bun:test";
import type { AgentProviderClient } from "@chrona/providers-foundation";

mock.module("../runtime/client-registry", () => ({
	aiClientRegistry: {
		requireProviderClient: (client: EngineAiClient) => client,
	},
}));

import type { EngineAiClient } from "../index";
import { dispatchStream, suggestStream } from "../index";

function providerClient(
	streamRun: AgentProviderClient["streamRun"],
	startRun = mock(async () => ({
		provider: "debug",
		runId: "run-1",
		sessionId: "session-1",
	})),
): EngineAiClient {
	return {
		record: {
			id: "debug",
			name: "Debug",
			type: "debug",
			config: {},
			enabled: true,
			isDefault: true,
		},
		providerClient: {
			provider: "debug",
			startRun,
			streamRun,
		} as unknown as AgentProviderClient,
	};
}

describe("provider streaming protocol boundary", () => {
	it("rejects provider events whose identity does not match the started run", async () => {
		const client = providerClient(async function* () {
			yield {
				type: "text_delta" as const,
				provider: "debug",
				runId: "wrong-run",
				sessionId: "session-1",
				sequence: 0,
				text: "untrusted",
			};
		});

		const events = [] as Array<{ type: string; message?: string }>;
		for await (const event of dispatchStream(client, "suggest", {
			scope: "scope-1",
			instructions: "Return suggestions",
			input: { type: "text", text: "Write a test" },
		})) {
			events.push(event as { type: string; message?: string });
		}

		expect(events).toContainEqual({
			type: "error",
			message:
				"Provider stream event identity does not match debug/run-1/session-1",
		});
	});

	it("constructs and validates a direct suggestion request", async () => {
		const startRun = mock(async () => ({
			provider: "debug",
			runId: "run-1",
			sessionId: "session-1",
		}));
		const client = providerClient(async function* () {
			yield {
				type: "tool_call" as const,
				provider: "debug",
				runId: "run-1",
				sessionId: "session-1",
				sequence: 0,
				tool: "chrona_feature_complete",
				callId: "call-1",
				status: "completed" as const,
				input: {
					result: {
						suggestions: [
							{ title: "Write boundary tests" },
							{ title: "Review runtime safety" },
						],
					},
				},
			};
			yield {
				type: "run_completed" as const,
				provider: "debug",
				runId: "run-1",
				sessionId: "session-1",
				sequence: 1,
				run: {
					provider: "debug",
					runId: "run-1",
					sessionId: "session-1",
					status: "completed" as const,
				},
				outputText: "",
			};
		}, startRun);

		const events = [] as Array<Record<string, unknown>>;
		for await (const event of suggestStream(client, {
			input: "Write tests",
			kind: "general",
			sessionKey: "suggestion-scope",
		})) {
			events.push(event as Record<string, unknown>);
		}

		expect(startRun).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { type: "text", text: expect.any(String) },
				structuredOutputSchema: expect.objectContaining({
					name: "chrona_feature_complete",
				}),
				terminalToolName: "chrona_feature_complete",
				toolPolicy: "terminal_only",
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "chrona_feature_complete" }),
				]),
			}),
		);
		expect(events).toContainEqual({
			type: "result",
			suggestions: expect.objectContaining({
				source: "debug",
				suggestions: [
					expect.objectContaining({ title: "Write boundary tests" }),
					expect.objectContaining({ title: "Review runtime safety" }),
				],
			}),
		});
	});
});
