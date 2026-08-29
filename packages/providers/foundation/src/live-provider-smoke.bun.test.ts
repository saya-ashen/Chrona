import { describe, expect, it } from "bun:test";

import type {
	AgentProviderClient,
	ProviderCapabilities,
	ProviderRunEvent,
	StreamRunInput,
} from "./ProviderClient";
import {
	LIVE_PROVIDER_SMOKE_MARKER,
	runLiveProviderSmoke,
} from "./live-provider-smoke";

const DEBUG_CAPABILITIES: ProviderCapabilities = {
	supportsSessions: true,
	supportsStreaming: true,
	supportsRunLookup: true,
	supportsCancellation: true,
	supportsToolCalls: true,
	readOnlySingleAttempt: true,
	supportsPreviousResponse: false,
	actionInvocation: "engine_managed",
	startIdempotency: "client_operation_id",
	lookupByClientOperationId: true,
	recovery: {
		sessionResume: true,
		historyReplay: true,
		activeRunLookup: true,
		streamReconnect: true,
		crossProcessDurable: false,
		providerResumeRef: true,
		runEventReplay: true,
		mode: "local_stream_only",
	},
};

function fakeClient(events: ProviderRunEvent[]): AgentProviderClient {
	return {
		provider: "debug",
		getCapabilities: async () => DEBUG_CAPABILITIES,
		checkHealth: async () => ({
			provider: "debug",
			ok: true,
			checkedAt: new Date().toISOString(),
			status: "ok",
			latencyMs: 1,
		}),
		createSession: async () => ({
			provider: "debug",
			sessionId: "session",
			createdAt: new Date().toISOString(),
		}),
		startRun: async () => ({
			provider: "debug",
			runId: "run",
			sessionId: "session",
			status: "running",
		}),
		streamRun: (_input: StreamRunInput) =>
			(async function* () {
				for (const event of events) yield event;
			})(),
		getRun: async () => ({
			provider: "debug",
			runId: "run",
			sessionId: "session",
			status: "completed",
		}),
		cancelRun: async () => ({
			provider: "debug",
			runId: "run",
			sessionId: "session",
			status: "cancelled",
		}),
	};
}

function runRef(status: "running" | "completed" = "running") {
	return {
		provider: "debug",
		runId: "run",
		sessionId: "session",
		status,
	};
}

describe("runLiveProviderSmoke", () => {
	it("passes a schema-valid, ordered provider turn with one terminal event", async () => {
		const result = await runLiveProviderSmoke(
			fakeClient([
				{
					type: "run_started",
					provider: "debug",
					sequence: 0,
					run: runRef(),
				},
				{
					type: "text_delta",
					provider: "debug",
					sequence: 1,
					text: LIVE_PROVIDER_SMOKE_MARKER,
				},
				{
					type: "run_completed",
					provider: "debug",
					sequence: 2,
					run: runRef("completed"),
					outputText: LIVE_PROVIDER_SMOKE_MARKER,
				},
			]),
		);

		expect(result).toMatchObject({
			provider: "debug",
			status: "passed",
			capabilities: { matched: true, mismatches: [] },
			run: {
				terminalType: "run_completed",
				outputMarkerMatched: true,
			},
		});
	});

	it("rejects duplicate terminal events", async () => {
		const result = await runLiveProviderSmoke(
			fakeClient([
				{ type: "run_started", sequence: 0, run: runRef() },
				{
					type: "run_completed",
					sequence: 1,
					run: runRef("completed"),
					outputText: LIVE_PROVIDER_SMOKE_MARKER,
				},
				{
					type: "run_completed",
					sequence: 2,
					run: runRef("completed"),
					outputText: LIVE_PROVIDER_SMOKE_MARKER,
				},
			]),
		);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("exactly one terminal event");
	});
});
