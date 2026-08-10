/**
 * AI Features — Streaming support (provider SSE + LLM SSE).
 */

import { createHash, randomUUID } from "node:crypto";

import type {
	AiFeature,
	LLMClientConfig,
	SmartSuggestRequest,
	StreamEvent,
} from "@chrona/contracts";
import { createLogger } from "@chrona/logging";
import {
	parseJsonServerEventStream,
	type ProviderRunEvent,
	type ProviderRunInput,
	type ProviderStructuredOutputSchema,
	type StartRunInput,
} from "@chrona/providers-foundation";
import { normalizeSuggestResponse } from "./feature-normalizers";
import {
	buildProviderFeatureRequest,
	CHRONA_FEATURE_TERMINAL_TOOL_NAME,
} from "./providers";
import { createProviderStreamEventBoundary } from "./provider-stream-contract";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";
import { buildSessionIdentity } from "./session";

function trimTrailingSlashes(value: string) {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
	return value.slice(0, end);
}

function summarizeText(value: string, maxLength: number) {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1)}…`;
}

const SUGGEST_TASK_COMPLETIONS_TOOL_NAME = CHRONA_FEATURE_TERMINAL_TOOL_NAME;
const SUGGEST_SYSTEM_PROMPT = `
You are a smart scheduling assistant for a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.
You MUST return JSON with a suggestions array. Each suggestion needs a title and may include description, priority, estimatedMinutes, tags, and suggestedSlot.
Respond in the same language as the input.`;
const suggestResponseSchema: ProviderStructuredOutputSchema = {
	name: SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
	description: "Return Chrona task suggestions as structured JSON.",
	schema: {
		type: "object",
		additionalProperties: true,
		properties: {
			suggestions: {
				type: "array",
				minItems: 2,
				maxItems: 4,
				items: {
					type: "object",
					additionalProperties: true,
					properties: {
						title: { type: "string", minLength: 1 },
						description: { type: "string" },
						priority: { type: "string" },
						estimatedMinutes: { type: "number" },
						tags: { type: "array", items: { type: "string" } },
						suggestedSlot: {
							type: "object",
							additionalProperties: true,
							properties: {
								startAt: { type: "string" },
								endAt: { type: "string" },
							},
						},
					},
					required: ["title"],
				},
			},
		},
		required: ["suggestions"],
	},
};

const logger = createLogger("ai-features.provider.streaming");

export type ProviderStreamRequest = {
	scope: string;
	instructions: string;
	input: ProviderRunInput;
	userMessage?: string;
	responseSchema?: ProviderStructuredOutputSchema;
	terminalToolName?: string;
	signal?: AbortSignal;
};

function toLlmStreamRequest(
	feature: AiFeature,
	input: ProviderStreamRequest,
): {
	systemPrompt: string;
	userMessage: string;
	options: { jsonMode: boolean };
} {
	return {
		systemPrompt: input.instructions || `Feature: ${feature}`,
		userMessage: input.userMessage ?? JSON.stringify(input.input),
		options: { jsonMode: feature !== "chat" },
	};
}
function isValidSuggestPayload(
	value: unknown,
): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const suggestions = (value as Record<string, unknown>).suggestions;
	return (
		Array.isArray(suggestions) &&
		suggestions.length >= 2 &&
		suggestions.length <= 4 &&
		suggestions.every((suggestion) => {
			if (
				!suggestion ||
				typeof suggestion !== "object" ||
				Array.isArray(suggestion)
			)
				return false;
			const title = (suggestion as Record<string, unknown>).title;
			return typeof title === "string" && title.trim().length > 0;
		})
	);
}
function unwrapProviderStructuredPayload(value: unknown): unknown {
	const payload = asRecord(value);
	return "parsed" in payload ? payload.parsed : value;
}

function asToolCallInput(
	evt: Extract<ProviderRunEvent, { type: "tool_started" }>,
) {
	if (evt.input !== undefined) return asRecord(evt.input);
	if (evt.preview !== undefined) return { preview: evt.preview };
	return {};
}

function convertProviderEvent(evt: ProviderRunEvent): StreamEvent | null {
	switch (evt.type) {
		case "text_delta":
			return { type: "partial", text: evt.text };
		case "tool_call":
			return {
				type: "tool_call",
				tool: evt.tool,
				input: evt.input,
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool: evt.tool ?? "unknown",
				result:
					typeof evt.result === "string"
						? evt.result
						: JSON.stringify(evt.result),
			};
		case "tool_started":
			return {
				type: "tool_call",
				tool: evt.toolName,
				input: asToolCallInput(evt),
			};
		case "tool_completed":
			return {
				type: "tool_result",
				tool: evt.toolName ?? "unknown",
				result: evt.error?.message ?? "completed",
				error: Boolean(evt.error),
			};
		case "run_failed":
			return { type: "error", message: evt.error };
		case "run_completed":
			return {
				type: "done",
				text: evt.outputText ?? "",
				structured: isProviderPayloadDebug(evt.structuredPayload)
					? evt.structuredPayload
					: null,
			};
		case "reasoning_delta":
		case "approval_required":
		case "run_cancelled":
		case "raw_event":
			return null;
		case "run_started":
		default:
			return null;
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function isProviderPayloadDebug(
	value: unknown,
): value is NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function previewLogValue(value: unknown, maxLength = 1200): unknown {
	if (typeof value === "string") {
		return value.length > maxLength
			? `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)`
			: value;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 20).map((item) => previewLogValue(item, maxLength));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
				key,
				previewLogValue(nested, maxLength),
			]),
		);
	}
	return value;
}

export function summarizeStreamEvent(event: StreamEvent | null) {
	if (!event) return null;
	switch (event.type) {
		case "partial":
			return {
				type: event.type,
				textLength: event.text.length,
				text: previewLogValue(event.text, 300),
			};
		case "tool_call":
			return {
				type: event.type,
				tool: event.tool,
				input: previewLogValue(event.input, 800),
			};
		case "tool_result":
			return {
				type: event.type,
				tool: event.tool,
				result: previewLogValue(event.result, 800),
				error: event.error ?? false,
			};
		case "result":
			return { type: event.type, value: previewLogValue(event, 1200) };
		case "done":
			return {
				type: event.type,
				textLength: event.text?.length ?? 0,
				structured: previewLogValue(event.structured, 1200),
			};
		case "error":
		case "status":
		default:
			return { ...event };
	}
}

async function* agentProviderStream(
	client: EngineAiClient,
	feature: AiFeature,
	input: ProviderStreamRequest,
): AsyncGenerator<StreamEvent> {
	const agentClient = aiClientRegistry.requireProviderClient(client);
	const timeoutMs = (agentClient.record.config.timeoutSeconds ?? 120) * 1000;
	const { sessionId, sessionKey } = buildSessionIdentity(feature, input.scope);
	const providerInput: StartRunInput = buildProviderFeatureRequest({
		sessionKey,
		input: input.input,
		instructions: input.instructions,
		structuredOutputSchema: input.responseSchema,
		terminalToolName: input.terminalToolName,
		timeoutMs,
		stream: true,
		signal: input.signal,
	});

	logger.info("provider.stream.start", {
		feature,
		scope: input.scope,
		sessionId,
		timeout: timeoutMs / 1000,
		inputSummary: summarizeText(JSON.stringify(input.input), 160),
	});

	yield { type: "status", message: "Connecting to AI service..." };

	try {
		yield { type: "status", message: "AI is thinking..." };
		let fullText = "";
		const run = await agentClient.providerClient.startRun({
			...providerInput,
			clientOperationId: `chrona-stream:${feature}:${input.scope}:${sessionKey}`,
			sessionId,
		});
		const boundary = createProviderStreamEventBoundary(run);
		let cancelled = false;
		const cancelProviderRun = async () => {
			if (cancelled) return;
			cancelled = true;
			await agentClient.providerClient
				.cancelRun?.({
					runId: run.runId,
					sessionId: run.sessionId,
					reason: "Provider stream aborted",
				})
				.catch(() => undefined);
		};

		for await (const value of agentClient.providerClient.streamRun({
			runId: run.runId,
			sessionId: run.sessionId,
			signal: input.signal,
		})) {
			if (input.signal?.aborted) {
				await cancelProviderRun();
				return;
			}
			const parsed = convertProviderEvent(boundary.accept(value));
			if (!parsed) continue;
			if (parsed.type === "partial") fullText += parsed.text;
			yield parsed;
			if (input.signal?.aborted) {
				await cancelProviderRun();
				return;
			}
			if (parsed.type === "error" || parsed.type === "done") return;
		}
		boundary.finish();

		logger.info("provider.stream.done", {
			feature,
			scope: input.scope,
			sessionId,
			ok: true,
			textLength: fullText.length,
		});
		yield { type: "done", text: fullText, structured: null };
	} catch (error) {
		logger.warn("provider.stream.failed", {
			feature,
			scope: input.scope,
			sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
		yield {
			type: "error",
			message:
				error instanceof Error ? error.message : "Unknown streaming error",
		};
	}
}

async function* llmStream(
	config: LLMClientConfig,
	systemPrompt: string,
	userMessage: string,
	signal?: AbortSignal,
	options?: { jsonMode?: boolean; temperature?: number; maxTokens?: number },
): AsyncGenerator<StreamEvent> {
	const model = config.model ?? "gpt-4o-mini";
	const url = `${trimTrailingSlashes(config.baseUrl)}/chat/completions`;

	yield { type: "status", message: "Connecting to LLM..." };

	const body: Record<string, unknown> = {
		model,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
		temperature: options?.temperature ?? config.temperature ?? 0.7,
		stream: true,
	};
	if (options?.maxTokens) body.max_tokens = options.maxTokens;
	if (options?.jsonMode) body.response_format = { type: "json_object" };

	const requestSignal = signal
		? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
		: AbortSignal.timeout(60_000);

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify(body),
		signal: requestSignal,
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		yield {
			type: "error",
			message: `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
		};
		return;
	}

	if (!res.body) {
		yield { type: "error", message: "No response body" };
		return;
	}

	yield { type: "status", message: "AI is generating..." };

	let fullText = "";

	try {
		for await (const value of parseJsonServerEventStream(res.body, {
			signal: requestSignal,
			doneSentinel: "[DONE]",
		})) {
			const chunk = value as {
				choices?: Array<{ delta?: { content?: string } }>;
			};
			const content = chunk.choices?.[0]?.delta?.content;
			if (content) {
				fullText += content;
				yield { type: "partial", text: content };
			}
		}
	} catch (error) {
		yield {
			type: "error",
			message:
				error instanceof Error ? error.message : "LLM event stream failed",
		};
		return;
	}

	yield { type: "done", text: fullText, structured: null };
}

export function dispatchStream(
	client: EngineAiClient,
	feature: AiFeature,
	input: ProviderStreamRequest,
): AsyncGenerator<StreamEvent> {
	if (client.providerClient) {
		return agentProviderStream(client, feature, input);
	}
	const llmClient = aiClientRegistry.requireLlmClient(client);
	const request = toLlmStreamRequest(feature, input);
	return llmStream(
		llmClient.record.config,
		request.systemPrompt,
		request.userMessage,
		input.signal,
		request.options,
	);
}

function asciiSlug(value: string, maxLength: number): string {
	const normalized = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, maxLength)
		.replace(/^-|-$/g, "");
	return normalized || "input";
}

function buildSuggestScope(request: SmartSuggestRequest): string {
	if (request.sessionKey?.trim()) {
		return request.sessionKey.trim();
	}
	if (request.taskId?.trim()) {
		return `chrona:task:${request.taskId.trim()}:default`;
	}
	const workspace = asciiSlug(request.workspaceId ?? "default", 24);
	const normalizedInput = request.input.trim();
	const inputSlug = asciiSlug(normalizedInput, 24);
	const inputHash = createHash("sha256")
		.update(normalizedInput)
		.digest("hex")
		.slice(0, 8);
	const nonce = randomUUID().slice(0, 8);
	return `${workspace}-${request.kind}-${inputSlug}-${inputHash}-${nonce}`;
}

export async function* suggestStream(
	client: EngineAiClient,
	request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
	const generator = dispatchStream(client, "suggest", {
		scope: buildSuggestScope(request),
		instructions: SUGGEST_SYSTEM_PROMPT,
		input: { type: "text", text: JSON.stringify(request) },
		userMessage: JSON.stringify(request),
		responseSchema: suggestResponseSchema,
		terminalToolName: CHRONA_FEATURE_TERMINAL_TOOL_NAME,
	});

	let finalText = "";
	let latestToolInput: Record<string, unknown> | null = null;
	let latestStructured: NonNullable<
		Extract<StreamEvent, { type: "done" }>["structured"]
	> | null = null;

	for await (const event of generator) {
		if (
			event.type === "tool_call" &&
			event.tool === SUGGEST_TASK_COMPLETIONS_TOOL_NAME
		) {
			latestToolInput =
				event.input &&
				typeof event.input === "object" &&
				!Array.isArray(event.input) &&
				"result" in event.input
					? ((event.input as Record<string, unknown>).result as Record<
							string,
							unknown
						>)
					: event.input;
			yield event;
			continue;
		}

		if (event.type === "partial") {
			finalText += event.text;
			yield event;
			continue;
		}

		if (event.type === "done") {
			const text = event.text ?? finalText;
			latestStructured = event.structured ?? null;
			const structuredPayload = unwrapProviderStructuredPayload(
				event.structured,
			);
			const parsed =
				latestToolInput ??
				(isValidSuggestPayload(structuredPayload) ? structuredPayload : null);
			if (!isValidSuggestPayload(parsed)) {
				yield {
					type: "error",
					message:
						"Suggestion response must include an array of titled suggestions",
				};
				return;
			}
			const suggestions = normalizeSuggestResponse({
				parsed,
				source: client.record.type,
				structured: event.structured,
			});
			yield { type: "result", suggestions };
			yield { type: "done", text, structured: latestStructured ?? null };
			return;
		}

		yield event;
	}
}
