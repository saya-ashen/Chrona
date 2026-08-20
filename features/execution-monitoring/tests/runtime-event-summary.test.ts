import { describe, expect, it } from "vitest";
import { summarizeRuntimeEvent } from "@features/execution-monitoring/server";
import type { PlanExecutionRuntimeEvent } from "@chrona/engine/modules/plan-execution";

describe("summarizeRuntimeEvent", () => {
	it("projects a safe tool lifecycle event", () => {
		const event = summarizeRuntimeEvent("start_manual", {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Node A",
			runtimeName: "hermes",
			event: {
				type: "tool_started",
				provider: "anthropic",
				runId: "run-1",
				nativeRunId: "native-1",
				sequence: 7,
				timestamp: "2026-05-22T00:00:03.000Z",
				toolName: "chrona_task_read",
				callId: "call-safe-1",
				preview: "Read task",
				input: {
					taskId: "task-1",
					apiKey: "sk-secret",
					path: "README.md",
					message: '{"apiKey":"sk-live"}',
				},
			},
		} satisfies PlanExecutionRuntimeEvent);

		expect(event).toMatchObject({
			type: "runtime_event",
			nodeId: "node-a",
			executionScope: "scope-a",
			runtime: { category: "runtime", label: "Execution runtime" },
			provider: { category: "ai_provider", label: "AI provider" },
			sequence: 7,
			event: {
				type: "tool_started",
				tool: { category: "tool", label: "chrona_task_read" },
				label: "chrona_task_read",
				callId: expect.any(String),
				input: {
					apiKey: "[redacted]",
					path: "README.md",
					message: '{"apiKey":"[redacted]"}',
				},
			},
		});
		expect(JSON.stringify(event)).not.toContain("run-1");
		expect(JSON.stringify(event)).not.toContain("call-safe-1");
		expect(JSON.stringify(event)).not.toContain("Read task");
		expect(JSON.stringify(event)).not.toContain("sk-secret");
		expect(JSON.stringify(event)).not.toContain("sk-live");
	});

	it("preserves completion metadata without raw provider output", () => {
		const event = summarizeRuntimeEvent("start_manual", {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Inspect repository",
			runtimeName: "omp",
			event: {
				type: "tool_completed",
				provider: "omp",
				runId: "run-1",
				sequence: 8,
				toolName: "read",
				callId: "call-safe-2",
				durationMs: 42,
				raw: { text: "export const secret = true" },
			},
		} satisfies PlanExecutionRuntimeEvent);

		expect(event?.event).toMatchObject({
			type: "tool_completed",
			callId: expect.any(String),
			durationMs: 42,
		});
		expect(JSON.stringify(event)).not.toContain("export const secret");
		expect(JSON.stringify(event)).not.toContain("call-safe-2");
	});

	it("preserves provider error details for the live trace", () => {
		const event = summarizeRuntimeEvent("start_manual", {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Inspect repository",
			runtimeName: "omp",
			event: {
				type: "tool_completed",
				provider: "omp",
				runId: "run-1",
				sequence: 9,
				toolName: "read",
				error: {
					message: "Authorization: Bearer top-secret",
					code: "permission_denied",
				},
			},
		} satisfies PlanExecutionRuntimeEvent);

		expect(event?.event).toMatchObject({
			type: "tool_completed",
			error: {
				code: "permission_denied",
				message: "Authorization: Bearer [redacted]",
			},
		});
		expect(JSON.stringify(event)).not.toContain("top-secret");
	});

	it("projects lifecycle status without provider request or structured response payloads", () => {
		const request = summarizeRuntimeEvent("start_manual", {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Node A",
			runtimeName: "hermes",
			event: {
				type: "raw_event",
				provider: "anthropic",
				runId: "run-1",
				raw: {
					kind: "provider_request",
					input: {
						instructions: "Inspect the repository",
						input: { target: "src" },
					},
				},
			},
		} satisfies PlanExecutionRuntimeEvent);
		const response = summarizeRuntimeEvent("start_manual", {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Node A",
			runtimeName: "hermes",
			event: {
				type: "run_completed",
				provider: "anthropic",
				runId: "run-1",
				run: {
					provider: "anthropic",
					runId: "run-1",
					sessionId: "session-1",
					status: "completed",
				},
				outputText: "Repository inspected",
				structuredPayload: { files: 12 },
			},
		} satisfies PlanExecutionRuntimeEvent);

		expect(request?.event).toEqual({
			type: "run_status",
			status: "started",
		});
		expect(response?.event).toMatchObject({
			type: "run_status",
			status: "completed",
			output: { text: "Repository inspected" },
		});
		expect(JSON.stringify(response)).not.toContain("files");
	});

	it("preserves text and reasoning while dropping raw provider events", () => {
		const runtimeBase = {
			nodeId: "node-a",
			executionScope: "scope-a",
			nodeTitle: "Node A",
			runtimeName: "hermes",
		};

		const text = summarizeRuntimeEvent("start_manual", {
			...runtimeBase,
			event: {
				type: "text_delta",
				provider: "anthropic",
				runId: "run-1",
				text: "original response token",
			},
		});
		expect(text?.event).toEqual({
			type: "text_delta",
			text: "original response token",
		});

		const reasoning = summarizeRuntimeEvent("start_manual", {
			...runtimeBase,
			event: {
				type: "reasoning_delta",
				provider: "anthropic",
				runId: "run-1",
				text: "inspect the repository",
				raw: { channel: "analysis" },
			},
		});
		expect(reasoning?.event).toEqual({
			type: "reasoning_delta",
			text: "inspect the repository",
		});

		const raw = summarizeRuntimeEvent("start_manual", {
			...runtimeBase,
			event: {
				type: "raw_event",
				provider: "anthropic",
				runId: "run-1",
				rawEventType: "turn.started",
				raw: { phase: "analysis" },
			},
		});
		expect(raw?.event).toEqual({
			type: "raw_event",
			rawEventType: "turn.started",
		});
	});
});
