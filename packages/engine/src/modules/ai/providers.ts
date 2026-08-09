import { HermesProviderClient } from "@chrona/hermes";
import {
	CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
	ClaudeCodeProviderClient,
} from "@chrona/claude-code";
import { CHRONA_CODEX_PROVIDER_TYPE, CodexProviderClient } from "@chrona/codex";
import { CHRONA_OMP_PROVIDER_TYPE, OmpProviderClient } from "@chrona/omp";
import {
	CHRONA_DEBUG_PROVIDER_TYPE,
	normalizeDebugProviderProfile,
} from "@chrona/providers-debug";
import {
	assertProviderStartSupported,
	type ProviderRunInput,
	type ProviderRunEvent,
	type ProviderRunSnapshot,
	type ProviderStructuredOutputSchema,
	type StartRunInput,
} from "@chrona/providers-foundation";
import type {
	AiClientRecord,
	AiFeature,
	ClaudeCodeClientConfig,
	CodexClientConfig,
	OmpClientConfig,
	HermesClientConfig,
	LLMClientConfig,
	DebugClientConfig,
} from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";
import { createProviderStreamEventBoundary } from "./provider-stream-contract";

/* eslint-disable max-lines -- Provider adapters share one normalized protocol surface. */

function unknownRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function trimTrailingSlashes(value: string) {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
	return value.slice(0, end);
}

const HERMES_API_SERVER_DOCS_URL =
	"https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server";

const HERMES_REQUIRED_CAPABILITIES = [
	{ key: "run_submission", label: "run submission (/v1/runs)" },
	{ key: "run_status", label: "run status (/v1/runs/{run_id})" },
	{
		key: "run_events_sse",
		label: "run event streaming (/v1/runs/{run_id}/events)",
	},
	{ key: "run_stop", label: "run cancellation (/v1/runs/{run_id}/stop)" },
] as const;

function getHermesCapabilityFeatures(
	raw: unknown,
): Record<string, unknown> | null {
	const health = unknownRecord(raw);
	const capabilities = unknownRecord(health?.capabilities);
	return unknownRecord(capabilities?.features);
}

function getMissingHermesCapabilities(raw: unknown): string[] {
	const features = getHermesCapabilityFeatures(raw);
	return HERMES_REQUIRED_CAPABILITIES.filter(
		(capability) => features?.[capability.key] !== true,
	).map((capability) => capability.label);
}

function hermesCapabilityReason(missing: string[]): string {
	return [
		`Hermes API is reachable, but required capabilities are missing: ${missing.join(", ")}.`,
		"Enable the Hermes API server with API_SERVER_ENABLED=true, set API_SERVER_KEY to the token configured in Chrona, then restart Hermes.",
		`Docs: ${HERMES_API_SERVER_DOCS_URL}`,
	].join(" ");
}

// eslint-disable-next-line max-lines-per-function, complexity -- Health checks intentionally normalize each provider's distinct readiness contract.
async function checkClientHealth(
	client: AiClientRecord,
): Promise<{ available: boolean; reason: string }> {
	try {
		if (client.type === "llm") {
			const config = client.config as LLMClientConfig;
			if (typeof config.baseUrl !== "string" || !config.baseUrl) {
				return { available: false, reason: "Base URL is required" };
			}
			if (typeof config.apiKey !== "string" || !config.apiKey) {
				return { available: false, reason: "API key is required" };
			}
			try {
				const res = await fetch(`${config.baseUrl}/models`, {
					headers: { Authorization: `Bearer ${config.apiKey}` },
					signal: AbortSignal.timeout(15_000),
				});
				if (res.ok) return { available: true, reason: "LLM API is reachable" };
				return { available: false, reason: `LLM returned ${res.status}` };
			} catch (error) {
				return {
					available: false,
					reason:
						error instanceof Error ? error.message : "Failed to reach LLM",
				};
			}
		}

		if (client.type === CHRONA_DEBUG_PROVIDER_TYPE) {
			const config = client.config as DebugClientConfig;
			const profile = normalizeDebugProviderProfile(config.profile);
			return {
				available: true,
				reason: `Chrona debug provider is local (${profile})`,
			};
		}

		if (client.type === "hermes") {
			const config = client.config as HermesClientConfig;
			const health = await new HermesProviderClient({
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				timeoutMs: config.timeoutMs,
			}).checkHealth({ deep: true });

			if (!health.ok) {
				return {
					available: false,
					reason:
						health.reason ?? health.message ?? "Hermes health check failed",
				};
			}

			const missingCapabilities = getMissingHermesCapabilities(health.raw);
			if (missingCapabilities.length > 0) {
				return {
					available: false,
					reason: hermesCapabilityReason(missingCapabilities),
				};
			}

			return {
				available: true,
				reason: health.reason ?? health.message ?? "Hermes API is reachable",
			};
		}

		if (client.type === CHRONA_CLAUDE_CODE_PROVIDER_TYPE) {
			const config = client.config as ClaudeCodeClientConfig;
			const health = await new ClaudeCodeProviderClient({
				config,
			}).checkHealth();
			if (!health.ok) {
				return {
					available: false,
					reason:
						health.reason ??
						health.message ??
						"Claude Code health check failed",
				};
			}
			return {
				available: true,
				reason:
					health.reason ??
					health.message ??
					"Claude Code connectivity check passed",
			};
		}

		if (client.type === CHRONA_CODEX_PROVIDER_TYPE) {
			const config = client.config as CodexClientConfig;
			const health = await new CodexProviderClient({ config }).checkHealth();
			if (!health.ok) {
				return {
					available: false,
					reason:
						health.reason ?? health.message ?? "Codex health check failed",
				};
			}
			return {
				available: true,
				reason:
					health.reason ?? health.message ?? "Codex connectivity check passed",
			};
		}

		if (client.type === CHRONA_OMP_PROVIDER_TYPE) {
			const config = client.config as OmpClientConfig;
			const health = await new OmpProviderClient({ config }).checkHealth();
			if (!health.ok) {
				return {
					available: false,
					reason:
						health.reason ?? health.message ?? "Oh My Pi health check failed",
				};
			}
			return {
				available: true,
				reason:
					health.reason ??
					health.message ??
					"Oh My Pi connectivity check passed",
			};
		}

		return {
			available: false,
			reason: `Provider availability check is not configured for ${client.type}`,
		};
	} catch (error) {
		return {
			available: false,
			reason:
				error instanceof Error ? error.message : "Client health check failed",
		};
	}
}

export async function testAiClientAvailability(input: {
	type: AiClientRecord["type"];
	config?: Record<string, unknown>;
}): Promise<{ available: boolean; reason: string }> {
	return checkClientHealth({
		id: "test-client",
		name: "Test Client",
		type: input.type,
		config: (input.config ?? {}) as unknown as AiClientRecord["config"],
		isDefault: false,
		enabled: true,
	});
}

// eslint-disable-next-line complexity -- JSON extraction handles provider prose, fenced payloads, and malformed fallbacks.
export function extractJSON(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* fall through to regex extraction */
	}

	const fencedStart = trimmed.indexOf("```");
	const fencedEnd =
		fencedStart >= 0 ? trimmed.indexOf("```", fencedStart + 3) : -1;
	const candidate =
		fencedStart >= 0 && fencedEnd > fencedStart
			? trimmed
					.slice(fencedStart + 3, fencedEnd)
					.replace(/^json\s*/i, "")
					.trim()
			: trimmed
					.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)
					.trim();
	if (!candidate) return null;
	try {
		const parsed = JSON.parse(candidate);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* ignore */
	}
	return null;
}

export type ProviderFeatureRequest = StartRunInput;

export const CHRONA_FEATURE_TERMINAL_TOOL_NAME = "chrona_feature_complete";

export function buildFeatureTerminalTool(
	schema: ProviderStructuredOutputSchema,
) {
	return {
		name: CHRONA_FEATURE_TERMINAL_TOOL_NAME,
		description:
			"Submit the authoritative structured result for the current Chrona feature run.",
		inputSchema: {
			type: "object",
			properties: { result: schema.schema },
			required: ["result"],
			additionalProperties: false,
		},
	} as unknown as NonNullable<StartRunInput["tools"]>[number];
}

async function providerFeaturePayload(
	client: EngineAiClient,
	request: StartRunInput,
): Promise<string> {
	const providerClient =
		aiClientRegistry.requireProviderClient(client).providerClient;
	const result = await runProviderRequest(providerClient, request);
	if (result.error) {
		throw new AiClientError(result.error, client.record.type, "internal");
	}
	return result.outputText ?? "";
}

export type ProviderRunRequestOptions = {
	onEvent?: (event: ProviderRunEvent) => void | Promise<void>;
};

export async function runProviderRequest(
	providerClient: NonNullable<EngineAiClient["providerClient"]>,
	request: StartRunInput,
	options?: ProviderRunRequestOptions,
): Promise<ProviderRunSnapshot> {
	assertProviderStartSupported(
		await providerClient.getCapabilities(),
		request,
		providerClient.provider,
	);
	const run = await providerClient.startRun(request);
	let finalSnapshot: ProviderRunSnapshot | null = null;
	const boundary = createProviderStreamEventBoundary(run);
	try {
		for await (const value of providerClient.streamRun({
			runId: run.runId,
			sessionId: run.sessionId,
		})) {
			const event = boundary.accept(value);
			await options?.onEvent?.(event);
			if (event.type === "run_completed") {
				finalSnapshot = providerRunCompletedSnapshot(
					providerClient.provider,
					event,
				);
			}
			if (event.type === "run_failed") {
				finalSnapshot = providerRunFailedSnapshot(
					providerClient.provider,
					request,
					event,
				);
			}
		}
		boundary.finish();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new AiClientError(message, providerClient.provider, "internal");
	}
	if (!finalSnapshot) {
		throw new AiClientError(
			"Provider run finished without a provider snapshot",
			providerClient.provider,
			"invalid_response",
		);
	}
	return finalSnapshot;
}

function completedStructuredPayload(
	event: Extract<ProviderRunEvent, { type: "run_completed" }>,
): ProviderRunSnapshot["structuredPayload"] {
	if (event.terminalToolCall) {
		const input = event.terminalToolCall.input;
		const parsed =
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- provider payloads may be null at runtime.
			input &&
			typeof input === "object" &&
			!Array.isArray(input) &&
			"result" in input
				? (input as Record<string, unknown>).result
				: input;
		return { parsed } as ProviderRunSnapshot["structuredPayload"];
	}
	return event.structuredPayload;
}

function providerRunCompletedSnapshot(
	provider: AiClientRecord["type"],
	event: Extract<ProviderRunEvent, { type: "run_completed" }>,
): ProviderRunSnapshot {
	return {
		provider,
		runId: event.run.runId,
		nativeRunId: event.run.nativeRunId,
		sessionId: event.run.sessionId,
		status: event.run.status ?? "completed",
		outputText: event.outputText,
		structuredPayload: completedStructuredPayload(event),
		terminalToolCall: event.terminalToolCall,
		usage: event.usage,
		error: null,
		raw: event.raw,
	};
}

function providerRunFailedSnapshot(
	provider: AiClientRecord["type"],
	request: StartRunInput,
	event: Extract<ProviderRunEvent, { type: "run_failed" }>,
): ProviderRunSnapshot {
	return {
		provider,
		runId: event.run?.runId ?? crypto.randomUUID(),
		nativeRunId: event.run?.nativeRunId,
		sessionId: event.run?.sessionId ?? request.sessionId,
		status: "failed",
		error: event.error,
		raw: event.raw,
	};
}

// eslint-disable-next-line complexity -- LLM feature payloads preserve provider-specific request and response contracts.
async function llmFeaturePayload(
	client: AiClientRecord,
	systemPrompt: string,
	userMessage: string,
	options?: { jsonMode?: boolean; temperature?: number },
): Promise<string> {
	const config = client.config as LLMClientConfig;
	const model = config.model ?? "gpt-4o-mini";
	const url = `${trimTrailingSlashes(config.baseUrl)}/chat/completions`;

	const body: Record<string, unknown> = {
		model,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
		temperature: options?.temperature ?? config.temperature ?? 0.7,
		max_tokens: 4096,
	};
	if (options?.jsonMode) body.response_format = { type: "json_object" };

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(60_000),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new AiClientError(
			`LLM returned ${res.status}: ${errText.slice(0, 300)}`,
			client.type,
			"internal",
		);
	}

	const json = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		error?: { message?: string };
	};

	if (json.error?.message) {
		throw new AiClientError(json.error.message, client.type, "internal");
	}

	return json.choices?.[0]?.message?.content ?? "";
}

export async function llmCall(
	config: LLMClientConfig,
	systemPrompt: string,
	userMessage: string,
	options?: { jsonMode?: boolean; temperature?: number },
): Promise<string> {
	return llmFeaturePayload(
		{ type: "llm", config, enabled: true } as AiClientRecord,
		systemPrompt,
		userMessage,
		options,
	);
}

export function buildProviderFeatureRequest(input: {
	sessionKey: string;
	input: ProviderRunInput;
	instructions?: string;
	timeoutMs?: number;
	stream?: boolean;
	maxOutputTokens?: number;
	terminalToolName?: string;
	structuredOutputSchema?: ProviderStructuredOutputSchema;
	tools?: StartRunInput["tools"];
	toolPolicy?: "full" | "read_only" | "terminal_only";
	signal?: AbortSignal;
}): StartRunInput {
	const instructions =
		input.instructions ??
		(typeof input.input === "string"
			? input.input
			: JSON.stringify(input.input));
	const tools =
		input.tools ??
		(input.terminalToolName && input.structuredOutputSchema
			? [buildFeatureTerminalTool(input.structuredOutputSchema)]
			: undefined);

	return {
		clientOperationId: `chrona-feature:${input.sessionKey}`,
		sessionId: input.sessionKey,
		sessionKey: input.sessionKey,
		instructions,
		input: input.input,
		structuredOutputSchema: input.structuredOutputSchema,
		terminalToolName: input.terminalToolName,
		tools,
		toolPolicy:
			input.toolPolicy ??
			(input.terminalToolName && input.structuredOutputSchema
				? "terminal_only"
				: undefined),
		stream: input.stream,
		maxOutputTokens: input.maxOutputTokens,
		timeoutMs: input.timeoutMs,
		signal: input.signal,
	};
}

// ────────────────────────────────────────────────────────────────────
// Dispatch helpers (used by feature-normalizers)
// ────────────────────────────────────────────────────────────────────

type ProviderPayloadDebug = {
	rawOutput?: string;
	error?: string | null;
	source?: string;
	feature?: string | null;
	toolName?: string | null;
	sessionId?: string;
	runId?: string;
	validationIssues?: unknown[];
};

type FeaturePayloadResult<T> = {
	parsed: T;
	rawText: string;
	debug?: ProviderPayloadDebug;
};

async function providerFeaturePayloadFull<T>(
	client: EngineAiClient,
	feature: AiFeature,
	request: StartRunInput,
	options?: ProviderRunRequestOptions,
): Promise<FeaturePayloadResult<T>> {
	const providerClient =
		aiClientRegistry.requireProviderClient(client).providerClient;
	const result = await runProviderRequest(providerClient, request, options);

	if (result.error) {
		throw new AiClientError(result.error, client.record.type, "internal");
	}

	const providerPayload = unknownRecord(result.structuredPayload);
	const parsedPayload =
		providerPayload && "parsed" in providerPayload
			? providerPayload.parsed
			: providerPayload;
	const rawPayload = parsedPayload;

	if (rawPayload == null) {
		throw new AiClientError(
			`Feature '${feature}' did not return a parsed payload`,
			client.record.type,
			"invalid_response",
		);
	}

	return {
		parsed: rawPayload as T,
		rawText: result.outputText ?? "",
		debug: {
			rawOutput:
				getPayloadString(result.structuredPayload, "rawOutput") ??
				result.outputText,
			error:
				getPayloadString(result.structuredPayload, "error") ?? result.error,
			source: getPayloadString(result.structuredPayload, "source"),
			feature: getPayloadString(result.structuredPayload, "feature") ?? feature,
			toolName: getPayloadString(result.structuredPayload, "toolName") ?? null,
			sessionId:
				getPayloadString(result.structuredPayload, "sessionId") ??
				result.sessionId,
			runId:
				getPayloadString(result.structuredPayload, "runId") ?? result.runId,
			validationIssues: getPayloadIssues(result.structuredPayload),
		},
	};
}

function getPayloadField(payload: unknown, field: string): unknown {
	return payload && typeof payload === "object" && field in payload
		? (payload as Record<string, unknown>)[field]
		: undefined;
}

function getPayloadString(payload: unknown, field: string): string | undefined {
	const value = getPayloadField(payload, field);
	return typeof value === "string" ? value : undefined;
}

function getPayloadIssues(payload: unknown): unknown[] | undefined {
	const value = getPayloadField(payload, "validationIssues");
	return Array.isArray(value) ? value : undefined;
}

export async function dispatch(
	client: EngineAiClient,
	feature: AiFeature,
	input: unknown,
	scope = "default",
): Promise<string> {
	if (client.providerClient) {
		return providerFeaturePayload(
			client,
			buildProviderFeatureRequest({
				sessionKey: scope,
				instructions: `Feature: ${feature}`,
				input: input as ProviderRunInput,
				stream: true,
			}),
		);
	}
	const llmClient = aiClientRegistry.requireLlmClient(client);
	const userMessage = typeof input === "string" ? input : JSON.stringify(input);
	return llmCall(llmClient.record.config, `Feature: ${feature}`, userMessage, {
		jsonMode: feature !== "chat",
	});
}

export async function dispatchFeaturePayload<T = unknown>(
	client: EngineAiClient,
	feature: AiFeature,
	input: unknown,
	scope = "default",
): Promise<FeaturePayloadResult<T>> {
	if (client.providerClient) {
		return providerFeaturePayloadFull<T>(
			client,
			feature,
			buildProviderFeatureRequest({
				sessionKey: scope,
				instructions: `Feature: ${feature}`,
				input: input as ProviderRunInput,
				stream: true,
			}),
		);
	}

	const llmClient = aiClientRegistry.requireLlmClient(client);
	const userMessage = typeof input === "string" ? input : JSON.stringify(input);
	const text = await llmCall(
		llmClient.record.config,
		`Feature: ${feature}`,
		userMessage,
		{ jsonMode: feature !== "chat" },
	);

	return {
		parsed: extractJSON(text) as T,
		rawText: text,
	};
}
