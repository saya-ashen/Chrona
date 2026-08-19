import type {
	TaskActivityEvent,
	WorkspaceActivityTimelineItem,
} from "./task-activity-types";
import {
	executionActivityMetadata,
	numberPayloadValue,
	payloadRecord,
	runtimePayloadEvent,
	stringPayloadValue,
} from "./task-activity-types";

const SENSITIVE_PROVIDER_KEY =
	/api[-_]?key|token|secret|password|authorization|credential/i;
const SAFE_TOOL_DISPLAY_KEYS = new Set([
	"action", "alreadyAccepted", "args", "call", "code", "command",
	"count", "cwd", "end", "file", "filename", "format", "intent",
	"kind", "language", "limit", "line", "message", "method", "offset",
	"ok", "options", "params", "path", "pattern", "query", "queries",
	"recorded", "result", "scope", "selector", "start", "status",
	"summary", "target", "title", "tool", "url",
]);

function redactSensitiveText(value: string) {
	return value
		.replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
		.replace(
			/(["']?(?:api[-_]?key|token|secret|password|credential)["']?\s*[:=]\s*["']?)[^"',\s}&]+/gi,
			"$1[redacted]",
		)
		.replace(
			/((?:--)(?:api[-_]?key|token|secret|password|credential)(?:\s+|=))[^\s'"]+/gi,
			"$1[redacted]",
		)
		.replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[redacted]@");
}

function safeDisplayText(value: string) {
	const redacted = redactSensitiveText(value);
	return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

function safeToolDisplayPayload(value: unknown, depth = 0): unknown {
	if (depth > 4) return "[omitted]";
	if (typeof value === "string") return safeDisplayText(value);
	if (Array.isArray(value))
		return value.slice(0, 20).map((item) => safeToolDisplayPayload(item, depth + 1));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(
				([key]) =>
					SAFE_TOOL_DISPLAY_KEYS.has(key) || SENSITIVE_PROVIDER_KEY.test(key),
			)
			.map(([key, entry]) => [
				key,
				SENSITIVE_PROVIDER_KEY.test(key)
					? "[redacted]"
					: safeToolDisplayPayload(entry, depth + 1),
			]),
	);
}

function optionalStringEventValue(event: Record<string, unknown>, key: string) {
	return typeof event[key] === "string" && event[key].trim()
		? (event[key] as string)
		: undefined;
}

function optionalNumberEventValue(event: Record<string, unknown>, key: string) {
	return typeof event[key] === "number" ? (event[key] as number) : undefined;
}

function providerActivityEventType(
	event: TaskActivityEvent,
	payloadEvent: Record<string, unknown> | null,
) {
	return typeof payloadEvent?.type === "string"
		? payloadEvent.type
		: event.eventType.replace(/^provider\./, "");
}

export function isDisplayableProviderEvent(
	eventType: string,
	payload?: Record<string, unknown> | null,
) {
	if (eventType === "raw_event") {
		return payload?.raw !== undefined;
	}
	return new Set([
		"text_delta",
		"reasoning_delta",
		"raw_event",
		"run_started",
		"tool_call",
		"tool_progress",
		"tool_started",
		"tool_completed",
		"tool_result",
		"approval_required",
		"run_completed",
		"run_failed",
		"run_cancelled",
	]).has(eventType);
}

function providerBase(event: TaskActivityEvent) {
	const payloadEvent = runtimePayloadEvent(event.payload);
	const payload = payloadEvent ?? payloadRecord(event.payload) ?? {};
	const eventType = providerActivityEventType(event, payloadEvent);
	const timestamp = (event.occurredAt ?? event.createdAt).toISOString();
	const base = {
		provider:
			stringPayloadValue(event.payload, "providerLabel") ?? "AI provider",
		runtimeName:
			stringPayloadValue(event.payload, "runtimeLabel") ?? "Execution runtime",
		executionScope:
			stringPayloadValue(event.payload, "executionScope") ?? undefined,
		sequence: numberPayloadValue(event.payload, "sequence") ?? undefined,
		...executionActivityMetadata(event.payload),
		...(event.nodeId ? { sourceNodeId: event.nodeId } : {}),
		...(event.nodeTitle ? { sourceNodeTitle: event.nodeTitle } : {}),
	};
	return { payload, eventType, timestamp, base };
}

type ProviderItemInput = {
	kind: WorkspaceActivityTimelineItem["kind"];
	title: string;
	description: string;
	tone: WorkspaceActivityTimelineItem["tone"];
	extras?: Partial<WorkspaceActivityTimelineItem>;
};

function providerItem(event: TaskActivityEvent, input: ProviderItemInput) {
	const { base, timestamp, payload } = providerBase(event);
	const providerInput = payload.input !== undefined
		? safeToolDisplayPayload(payload.input)
		: undefined;
	const providerOutput = safeToolDisplayPayload(
		payload.output ??
			payload.result ??
			(typeof payload.error === "string" ? { message: payload.error } : undefined),
	);
	return {
		id: event.id,
		kind: input.kind,
		title: input.title,
		summary: input.description,
		description: input.description,
		tone: input.tone,
		timestamp,
		...input.extras,
		...(providerInput !== undefined ? { providerInput } : {}),
		...(providerOutput !== undefined ? { providerOutput } : {}),
		...base,
	};
}

function toolPresentation(
	state: "started" | "progress" | "completed",
	failed: boolean,
) {
	if (state === "started")
		return { title: "Tool started", description: "Provider tool started." };
	if (state === "progress")
		return {
			title: "Tool in progress",
			description: "Provider tool is running.",
		};
	return failed
		? { title: "Tool failed", description: "Provider tool failed." }
		: { title: "Tool completed", description: "Provider tool completed." };
}

function providerToolName(payload: Record<string, unknown>) {
	return (
		optionalStringEventValue(payload, "tool") ??
		optionalStringEventValue(payload, "toolName") ??
		optionalStringEventValue(payload, "toolLabel") ??
		"Runtime tool"
	);
}

function toolItem(
	event: TaskActivityEvent,
	state: "started" | "progress" | "completed",
) {
	const { payload } = providerBase(event);
	const failed =
		state === "completed" &&
		(typeof payload.error === "string" ||
			payloadRecord(payload.error) !== null);
	const presentation = toolPresentation(state, failed);
	return providerItem(event, {
		kind:
			state === "started"
				? "tool_started"
				: state === "progress"
					? "tool_progress"
					: "tool_completed",
		title: presentation.title,
		description: presentation.description,
		tone: failed ? "danger" : state === "completed" ? "success" : "info",
		extras: {
			tool: {
				name: providerToolName(payload),
				...(state === "completed"
					? { durationMs: optionalNumberEventValue(payload, "durationMs") }
					: {}),
				state: failed ? "failed" : state,
			},
		},
	});
}

export function mapProviderEventToActivity(
	event: TaskActivityEvent,
): WorkspaceActivityTimelineItem {
	const { eventType, base, payload } = providerBase(event);
	switch (eventType) {
		case "text_delta":
			return providerItem(event, {
				kind: "provider_run",
				title: "Assistant output",
				description: safeDisplayText(
					optionalStringEventValue(payload, "text") ??
						"Assistant output chunk.",
				),
				tone: "info",
			});
		case "reasoning_delta":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider reasoning",
				description: safeDisplayText(
					optionalStringEventValue(payload, "text") ??
						"Provider reasoning chunk.",
				),
				tone: "neutral",
			});
		case "tool_result":
			return providerItem(event, {
				kind: "tool_completed",
				title: "Tool result",
				description: "Provider tool returned a result.",
				tone: "success",
				extras: {
					tool: {
						name: optionalStringEventValue(payload, "tool") ?? "Runtime tool",
						state: "completed",
					},
				},
			});
		case "raw_event": {
			const raw = payloadRecord(payload.raw);
			if (raw?.kind === "provider_request")
				return providerItem(event, {
					kind: "provider_run",
					title: "Provider request sent",
					description: base.provider,
					tone: "info",
				});
			if (raw?.kind === "provider_response")
				return providerItem(event, {
					kind: "provider_run",
					title: "Provider response received",
					description: base.provider,
					tone: "success",
				});
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider event",
				description:
					optionalStringEventValue(payload, "rawEventType") ??
					raw?.type?.toString() ??
					"Provider event received",
				tone: "neutral",
			});
		}
		case "run_started":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider run started",
				description: base.provider,
				tone: "info",
			});
		case "tool_started":
			return toolItem(event, "started");
		case "tool_progress":
			return toolItem(event, "progress");
		case "tool_completed":
			return toolItem(event, "completed");
		case "approval_required":
			return providerItem(event, {
				kind: "approval",
				title: "Approval required",
				description: "Provider approval required.",
				tone: "warning",
			});
		case "run_completed":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider run completed",
				description: base.provider,
				tone: "success",
			});
		case "run_failed":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider run failed",
				description: base.provider,
				tone: "danger",
			});
		case "run_cancelled":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider run cancelled",
				description: base.provider,
				tone: "warning",
			});
		default:
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider event received",
				description: base.provider,
				tone: "neutral",
			});
	}
}

export function providerActivityMergeKey(
	event: TaskActivityEvent,
	eventType: string,
) {
	return [
		eventType,
		stringPayloadValue(event.payload, "executionScope") ?? "execution",
		stringPayloadValue(event.payload, "runtimeName") ?? "runtime",
		stringPayloadValue(event.payload, "provider") ?? "provider",
		event.nodeId ?? "task",
		event.nodeAttemptId ??
			stringPayloadValue(event.payload, "nodeAttemptId") ??
			"attempt",
		event.providerRunId ??
			stringPayloadValue(event.payload, "providerRunId") ??
			"provider-run",
	].join(":");
}

function providerToolCallMergeKey(
	event: TaskActivityEvent,
	payloadEvent: Record<string, unknown>,
	fallback: string,
) {
	return [
		providerActivityMergeKey(event, "tool_call"),
		optionalStringEventValue(payloadEvent, "callId") ?? fallback,
	].join(":");
}

export function providerToolProgressMergeKey(
	event: TaskActivityEvent,
	payloadEvent: Record<string, unknown>,
) {
	return providerToolCallMergeKey(
		event,
		payloadEvent,
		optionalStringEventValue(payloadEvent, "toolName") ?? "tool",
	);
}

export function providerToolCompletionMergeKey(
	event: TaskActivityEvent,
	payloadEvent: Record<string, unknown>,
) {
	const rawEventType = optionalStringEventValue(payloadEvent, "rawEventType");
	const sequence = optionalNumberEventValue(payloadEvent, "sequence");
	if (
		sequence !== undefined &&
		(rawEventType === "tool_execution_end" ||
			rawEventType === "tool_execution_end:result")
	) {
		const sourceSequence =
			rawEventType === "tool_execution_end:result" ? sequence - 1 : sequence;
		return [
			providerActivityMergeKey(event, "tool_call"),
			providerToolName(payloadEvent),
			sourceSequence,
		].join(":");
	}
	return optionalStringEventValue(payloadEvent, "callId")
		? providerToolCallMergeKey(event, payloadEvent, "tool")
		: null;
}

export { providerActivityEventType };
