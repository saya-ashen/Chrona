import { createHash } from "node:crypto";
import type {
	CheckpointActionKind,
	ExecutionActionType,
	PlanExecutionSSEEvent,
} from "@chrona/contracts";
import {
	publicProviderDescriptor,
	publicRuntimeDescriptor,
	publicToolDescriptor,
} from "@chrona/contracts";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine";

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

function publicToolCallId(value: string | undefined) {
	return value
		? createHash("sha256").update(value).digest("hex").slice(0, 16)
		: undefined;
}

function sanitizeProviderDisplayEvent(
	event: Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>["event"],
) {
	return exposeProviderPayload(event) as Extract<
		PlanExecutionSSEEvent,
		{ type: "runtime_event" }
	>["event"];
}

export function summarizeRuntimeEvent(
	action: ExecutionActionType,
	event: PlanExecutionRuntimeEvent,
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> | null {
	const providerEvent = event.event;
	const provider = publicProviderDescriptor(providerEvent.provider);
	const displayEvent = summarizeProviderRuntimePayload(providerEvent);
	if (!displayEvent) return null;
	return {
		type: "runtime_event",
		action,
		executionScope: event.executionScope,
		nodeId: event.nodeId,
		nodeTitle: event.nodeTitle,
		runtime: publicRuntimeDescriptor(event.runtimeName),
		provider,
		sequence: providerEvent.sequence,
		timestamp: providerEvent.timestamp ?? new Date().toISOString(),
		event: sanitizeProviderDisplayEvent(displayEvent),
	};
}
export function checkpointActionToExecutionAction(
	action: CheckpointActionKind,
): ExecutionActionType {
	switch (action) {
		case "submit_input":
			return "resume_with_input";
		case "approve_result":
		case "reject_result":
		case "request_changes":
		case "accept_replan":
		case "reject_replan":
		case "request_replan":
			return "resume_with_approval";
		case "retry_node":
			return "retry_node";
		case "resume_after_unblock":
			return "resume_after_unblock";
		case "mark_node_completed":
		case "mark_node_skipped":
			return "complete_manual_node";
		case "fail_task":
			return "fail_current_node";
		case "cancel_session":
			return "cancel_session";
	}
}

function summarizeProviderRuntimePayload(
	providerEvent: PlanExecutionRuntimeEvent["event"],
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>["event"] | null {
	switch (providerEvent.type) {
		case "text_delta":
			return {
				type: "text_delta",
				text: safeDisplayText(providerEvent.text),
			};
		case "reasoning_delta":
			return {
				type: "reasoning_delta",
				text: safeDisplayText(providerEvent.text),
			};
		case "tool_call":
			return {
				type: "tool_started",
				tool: publicToolDescriptor(providerEvent.tool),
				label: publicToolDescriptor(providerEvent.tool).label,
				callId: publicToolCallId(providerEvent.callId),
				input: safeToolDisplayPayload(providerEvent.input),
			};
		case "tool_started":
			return {
				type: "tool_started",
				tool: publicToolDescriptor(providerEvent.toolName),
				label: publicToolDescriptor(providerEvent.toolName).label,
				...(providerEvent.callId
					? { callId: publicToolCallId(providerEvent.callId) }
					: {}),
				...(providerEvent.input !== undefined
					? { input: safeToolDisplayPayload(providerEvent.input) }
					: {}),
			};
		case "tool_progress":
			return {
				type: "tool_progress",
				tool: publicToolDescriptor(providerEvent.toolName),
				label: publicToolDescriptor(providerEvent.toolName).label,
				callId: publicToolCallId(providerEvent.callId),
				...(providerEvent.preview !== undefined
					? { output: safeToolDisplayPayload(providerEvent.preview) }
					: {}),
			};
		case "tool_result":
			return {
				type: "tool_completed",
				...(providerEvent.callId
					? { callId: publicToolCallId(providerEvent.callId) }
					: {}),
				tool: providerEvent.tool
					? publicToolDescriptor(providerEvent.tool)
					: undefined,
				label: providerEvent.tool
					? publicToolDescriptor(providerEvent.tool).label
					: "Tool result",
				output: safeToolDisplayPayload(providerEvent.result),
			};
		case "tool_completed":
			return {
				type: "tool_completed",
				tool: publicToolDescriptor(providerEvent.toolName),
				label: publicToolDescriptor(providerEvent.toolName).label,
				...(providerEvent.callId
					? { callId: publicToolCallId(providerEvent.callId) }
					: {}),
				durationMs: providerEvent.durationMs,
				...(providerEvent.error
					? {
							error: {
								code: providerEvent.error.code,
								message: safeDisplayText(providerEvent.error.message),
							},
						}
					: {}),
			};
		case "approval_required": {
			const { id, riskLevel, choices, defaultChoice, recommendedChoice } =
				providerEvent.approval;
			return {
				type: "approval_required",
				approval: {
					id,
					provider: publicProviderDescriptor(providerEvent.approval.provider),
					kind: "execution_approval",
					title: "Approval required",
					summary: "Execution is waiting for confirmation.",
					riskLevel,
					choices,
					defaultChoice,
					recommendedChoice,
				},
			};
		}
		case "run_started":
			return { type: "run_status", status: "started" };
		case "run_completed":
			return {
				type: "run_status",
				status: "completed",
				output: {
					...(providerEvent.outputText !== undefined
						? { text: safeDisplayText(providerEvent.outputText) }
						: {}),
				},
			};
		case "run_failed":
			return {
				type: "run_status",
				status: "failed",
				error: safeDisplayText(providerEvent.error),
			};
		case "run_cancelled":
			return {
				type: "run_status",
				status: "cancelled",
			};
		case "raw_event": {
			const raw = providerEvent.raw;
			const kind =
				raw && typeof raw === "object"
					? (raw as { kind?: unknown }).kind
					: undefined;
			if (kind === "provider_request") {
				return { type: "run_status", status: "started" };
			}
			if (kind !== "provider_response") {
				return {
					type: "raw_event",
					rawEventType: providerEvent.rawEventType ?? "provider_event",
				};
			}
			const output = (raw as { output?: { status?: unknown } }).output;
			const status =
				output?.status === "failed"
					? "failed"
					: output?.status === "cancelled"
						? "cancelled"
						: output?.status === "completed"
							? "completed"
							: "started";
			return { type: "run_status", status };
		}
		default:
			return null;
	}
}
