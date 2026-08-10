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

function exposeProviderPayload(value: unknown, key?: string): unknown {
	if (key && SENSITIVE_PROVIDER_KEY.test(key)) return "[redacted]";
	if (Array.isArray(value))
		return value.map((item) => exposeProviderPayload(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(
				([entryKey, entryValue]) => [
					entryKey,
					exposeProviderPayload(entryValue, entryKey),
				],
			),
		);
	}
	return value;
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
	const raw = payloadRecord(payload.raw);
	const providerInput =
		payload.input !== undefined
			? exposeProviderPayload(payload.input)
			: raw?.kind === "provider_request"
				? exposeProviderPayload(raw.input)
				: undefined;
	const providerOutput = exposeProviderPayload(
		payload.output ??
			payload.result ??
			payload.outputText ??
			payload.text ??
			payload.structuredPayload ??
			(typeof payload.error === "string" ? payload.error : undefined) ??
			(raw?.kind === "provider_response" ? raw.output : undefined),
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
		...(payload.raw !== undefined
			? { providerRaw: exposeProviderPayload(payload.raw) }
			: {}),
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
				name: optionalStringEventValue(payload, "toolLabel") ?? "Runtime tool",
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
				description:
					optionalStringEventValue(payload, "text") ??
					"Assistant output chunk.",
				tone: "info",
			});
		case "reasoning_delta":
			return providerItem(event, {
				kind: "provider_run",
				title: "Provider reasoning",
				description:
					optionalStringEventValue(payload, "text") ??
					"Provider reasoning chunk.",
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
	].join(":");
}

export function providerToolProgressMergeKey(
	event: TaskActivityEvent,
	payloadEvent: Record<string, unknown>,
) {
	return [
		providerActivityMergeKey(event, "tool_progress"),
		optionalStringEventValue(payloadEvent, "toolName") ?? "tool",
	].join(":");
}

export { providerActivityEventType };
