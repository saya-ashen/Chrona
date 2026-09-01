import {
	providerCapabilityMatrix,
	summarizeProviderCapabilities,
	type ProviderCapabilityName,
} from "./provider-capability-matrix";
import {
	providerCapabilitiesSchema,
	providerRunEventSchema,
	type AgentProviderClient,
	type ProviderRunEvent,
} from "./ProviderClient";

export const LIVE_PROVIDER_SMOKE_MARKER = "CHRONA_PROVIDER_SMOKE_OK";

export type LiveProviderSmokeStatus = "passed" | "failed";

export type LiveProviderSmokeResult = {
	provider: string;
	status: LiveProviderSmokeStatus;
	durationMs: number;
	health: {
		ok: boolean;
		status?: string;
		latencyMs?: number;
		reason?: string;
	};
	capabilities: {
		matched: boolean;
		mismatches: string[];
	};
	run?: {
		durationMs: number;
		eventCount: number;
		eventTypes: Record<string, number>;
		terminalType?: "run_completed" | "run_failed" | "run_cancelled";
		outputMarkerMatched: boolean;
	};
	error?: string;
};

export type LiveProviderSmokeOptions = {
	timeoutMs?: number;
	expectedOutputContains?: string;
};

type SmokeBase = Pick<
	LiveProviderSmokeResult,
	"provider" | "health" | "capabilities"
>;
type SmokeRun = NonNullable<LiveProviderSmokeResult["run"]>;

const DEFAULT_TIMEOUT_MS = 120_000;
const TERMINAL_EVENT_TYPES = new Set<ProviderRunEvent["type"]>([
	"run_completed",
	"run_failed",
	"run_cancelled",
]);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function checkCapabilities(
	client: AgentProviderClient,
): Promise<LiveProviderSmokeResult["capabilities"]> {
	const value = await client.getCapabilities();
	const capabilities = providerCapabilitiesSchema.parse(value);
	const expected = providerCapabilityMatrix.find(
		(entry) => entry.provider === client.provider,
	);
	if (!expected) {
		throw new Error(`No capability matrix entry exists for ${client.provider}`);
	}
	const actual = summarizeProviderCapabilities(capabilities);
	const mismatches = (
		Object.keys(expected.capabilities) as ProviderCapabilityName[]
	)
		.filter((name) => actual[name] !== expected.capabilities[name])
		.map(
			(name) =>
				`${name}: expected ${expected.capabilities[name]}, received ${actual[name]}`,
		);
	if (mismatches.length > 0) {
		throw new Error(`Capability matrix mismatch: ${mismatches.join("; ")}`);
	}
	return { matched: true, mismatches: [] };
}

async function withTimeout<T>(
	timeoutMs: number,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation(controller.signal),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					controller.abort();
					reject(new Error(`Provider smoke timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function checkHealth(
	client: AgentProviderClient,
	timeoutMs: number,
): Promise<LiveProviderSmokeResult["health"]> {
	const health = await withTimeout(timeoutMs, (signal) =>
		client.checkHealth({ signal, timeoutMs }),
	);
	const healthReason = health.reason ?? health.message;
	const report = {
		ok: health.ok,
		status: health.status === undefined ? undefined : String(health.status),
		latencyMs: health.latencyMs,
		reason: healthReason === undefined ? undefined : String(healthReason),
	};
	if (!health.ok) {
		throw new Error(report.reason ?? "Provider health check failed");
	}
	return report;
}

function validateEventIdentity(events: ProviderRunEvent[], provider: string) {
	for (const event of events) {
		if (event.provider && event.provider !== provider) {
			throw new Error(
				`Provider event identity mismatch: expected ${provider}, received ${event.provider}`,
			);
		}
	}
}

function validateIncreasingSequence(events: ProviderRunEvent[]) {
	const sequences = events
		.map((event) => event.sequence)
		.filter((sequence): sequence is number => sequence !== undefined);
	for (let index = 1; index < sequences.length; index += 1) {
		if (sequences[index]! <= sequences[index - 1]!) {
			throw new Error(
				`Provider event sequence must increase: ${sequences[index]} followed ${sequences[index - 1]}`,
			);
		}
	}
}

function validateTerminalContract(events: ProviderRunEvent[]) {
	const terminals = events.filter((event) => TERMINAL_EVENT_TYPES.has(event.type));
	if (terminals.length !== 1) {
		throw new Error(
			`Provider must emit exactly one terminal event, received ${terminals.length}`,
		);
	}
	if (!TERMINAL_EVENT_TYPES.has(events.at(-1)!.type)) {
		throw new Error("Provider terminal event must be the final event");
	}
}

function validateEvents(events: ProviderRunEvent[], provider: string) {
	if (events.length === 0) throw new Error("Provider emitted no run events");
	if (events[0]?.type !== "run_started") {
		throw new Error(
			`First provider event must be run_started, received ${events[0]?.type}`,
		);
	}
	validateEventIdentity(events, provider);
	validateIncreasingSequence(events);
	validateTerminalContract(events);
}

function countEventTypes(events: ProviderRunEvent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
	return counts;
}

function completedOutput(events: ProviderRunEvent[]): string {
	const completed = events.findLast((event) => event.type === "run_completed");
	if (!completed) return "";
	return [
		completed.outputText,
		completed.output?.text,
		...events
			.filter((event) => event.type === "text_delta")
			.map((event) => event.text),
	]
		.filter((value): value is string => typeof value === "string")
		.join("\n");
}

async function collectSmokeEvents(input: {
	client: AgentProviderClient;
	timeoutMs: number;
	expectedOutputContains: string;
}): Promise<{ events: ProviderRunEvent[]; durationMs: number }> {
	const started = Date.now();
	const events = await withTimeout(input.timeoutMs, async (signal) => {
		const collected: ProviderRunEvent[] = [];
		const id = crypto.randomUUID();
		const sessionId = `provider-smoke-session:${input.client.provider}:${id}`;
		const sessionKey = `provider-smoke:${input.client.provider}:${id}`;
		const run = await input.client.startRun({
			clientOperationId: `provider-smoke:${input.client.provider}:${id}`,
			sessionId,
			sessionKey,
			instructions: [
				"This is a read-only provider connectivity smoke test.",
				"Do not use tools, read files, modify files, or access the network.",
				`Reply with the exact marker ${input.expectedOutputContains}.`,
			].join(" "),
			input: {
				type: "text",
				text: `Return only ${input.expectedOutputContains}`,
			},
			toolPolicy: "read_only",
			maxOutputTokens: 64,
			timeoutMs: input.timeoutMs,
			stream: true,
			signal,
		});
		for await (const rawEvent of input.client.streamRun({
			runId: run.runId,
			sessionId: run.sessionId,
			sessionKey,
			signal,
		})) {
			collected.push(providerRunEventSchema.parse(rawEvent));
		}
		return collected;
	});
	return { events, durationMs: Date.now() - started };
}

function summarizeRun(
	events: ProviderRunEvent[],
	durationMs: number,
	expectedOutputContains: string,
): SmokeRun {
	const terminal = events.at(-1)!;
	return {
		durationMs,
		eventCount: events.length,
		eventTypes: countEventTypes(events),
		terminalType: terminal.type as SmokeRun["terminalType"],
		outputMarkerMatched: completedOutput(events).includes(expectedOutputContains),
	};
}

function terminalFailure(events: ProviderRunEvent[]): string | undefined {
	const terminal = events.at(-1)!;
	if (terminal.type === "run_completed") return undefined;
	if (terminal.type === "run_failed") {
		return `Provider run ended with ${terminal.error}`;
	}
	return `Provider run ended with ${terminal.type}`;
}

export async function runLiveProviderSmoke(
	client: AgentProviderClient,
	options: LiveProviderSmokeOptions = {},
): Promise<LiveProviderSmokeResult> {
	const started = Date.now();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const expectedOutputContains =
		options.expectedOutputContains ?? LIVE_PROVIDER_SMOKE_MARKER;
	const base: SmokeBase = {
		provider: client.provider,
		health: { ok: false },
		capabilities: { matched: false, mismatches: [] },
	};

	try {
		base.capabilities = await checkCapabilities(client);
		base.health = await checkHealth(client, timeoutMs);
		const collected = await collectSmokeEvents({
			client,
			timeoutMs,
			expectedOutputContains,
		});
		validateEvents(collected.events, client.provider);
		const run = summarizeRun(
			collected.events,
			collected.durationMs,
			expectedOutputContains,
		);
		const failure = terminalFailure(collected.events);
		if (failure || !run.outputMarkerMatched) {
			return {
				...base,
				status: "failed",
				durationMs: Date.now() - started,
				run,
				error:
					failure ?? "Provider completed without the expected smoke marker",
			};
		}
		return {
			...base,
			status: "passed",
			durationMs: Date.now() - started,
			run,
		};
	} catch (error) {
		return {
			...base,
			status: "failed",
			durationMs: Date.now() - started,
			error: errorMessage(error),
		};
	}
}
