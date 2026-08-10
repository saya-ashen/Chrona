import { describe, expect, it } from "vitest";
import {
	getWorkspaceActivityIdentity,
	mergeWorkspaceActivity,
	orderWorkspaceActivity,
	runtimeEventToWorkspaceActivity,
	workspaceEventToWorkspaceActivity,
} from "./task-workspace-model";
import type {
	TaskWorkspaceSseEvent,
	WorkspaceRuntimeEvent,
} from "./task-workspace-model";
import type { WorkspaceActivityItem } from "./task-workspace-model";

function activity(
	overrides: Partial<WorkspaceActivityItem> &
		Pick<WorkspaceActivityItem, "id" | "kind">,
): WorkspaceActivityItem {
	return {
		title: overrides.title ?? overrides.id,
		summary: overrides.summary ?? overrides.id,
		description: overrides.description ?? overrides.summary ?? overrides.id,
		tone: overrides.tone ?? "neutral",
		...overrides,
	};
}

function runtimeEvent(
	overrides: Partial<WorkspaceRuntimeEvent>,
): WorkspaceRuntimeEvent {
	return {
		type: "runtime_event",
		action: "start_manual",
		executionScope: "scope-1",
		runtime: { category: "runtime", label: "Execution runtime" },
		provider: { category: "ai_provider", label: "AI provider" },
		sequence: 1,
		timestamp: "2026-05-21T00:00:00.000Z",
		event: { type: "run_status", status: "started" },
		...overrides,
	};
}

describe("workspace activity helpers", () => {
	it("builds stable identity from safe provider, node, and sequence fields", () => {
		expect(
			getWorkspaceActivityIdentity(
				activity({
					id: "event-1",
					kind: "tool_started",
					provider: { category: "ai_provider", label: "AI provider" },
					runtime: { category: "runtime", label: "Execution runtime" },
					executionScope: "scope-1",
					sourceNodeId: "node-1",
					sequence: 12,
				}),
			),
		).toBe("tool_started:AI provider:Execution runtime:scope-1:node-1:12");
	});

	it("orders newest activity first and uses sequence as a tie breaker", () => {
		expect(
			orderWorkspaceActivity([
				activity({
					id: "older",
					kind: "task",
					timestamp: "2026-05-21T00:00:00.000Z",
					sequence: 3,
				}),
				activity({
					id: "newer-low-sequence",
					kind: "task",
					timestamp: "2026-05-21T00:01:00.000Z",
					sequence: 1,
				}),
				activity({
					id: "newer-high-sequence",
					kind: "task",
					timestamp: "2026-05-21T00:01:00.000Z",
					sequence: 2,
				}),
			]).map((item) => item.id),
		).toEqual(["newer-high-sequence", "newer-low-sequence", "older"]);
	});

	it("projects tool lifecycle without provider inputs, results, IDs, or error text", () => {
		const started = runtimeEventToWorkspaceActivity(
			runtimeEvent({
				sequence: 1,
				event: {
					type: "tool_started",
					tool: { category: "tool", label: "Runtime tool" },
					label: "Read source",
				},
			}),
		);
		const progress = runtimeEventToWorkspaceActivity(
			runtimeEvent({
				sequence: 2,
				event: {
					type: "tool_progress",
					tool: { category: "tool", label: "Runtime tool" },
					label: "Read source",
				},
			}),
		);
		const completed = runtimeEventToWorkspaceActivity(
			runtimeEvent({
				sequence: 3,
				event: {
					type: "tool_completed",
					tool: { category: "tool", label: "Runtime tool" },
					label: "Read source",
					durationMs: 42,
				},
			}),
		);
		const failed = runtimeEventToWorkspaceActivity(
			runtimeEvent({
				sequence: 4,
				event: {
					type: "tool_completed",
					tool: { category: "tool", label: "Runtime tool" },
					label: "Read source",
					error: { code: "permission_denied" },
				},
			}),
		);

		expect(started?.tool).toMatchObject({
			name: "Runtime tool",
			label: "Read source",
			state: "started",
		});
		expect(progress?.tool).toMatchObject({
			name: "Runtime tool",
			label: "Read source",
			state: "progress",
		});
		expect(completed?.tool).toMatchObject({
			name: "Runtime tool",
			label: "Read source",
			durationMs: 42,
			state: "completed",
		});
		expect(failed).toMatchObject({
			title: "Tool failed",
			summary: "Provider tool failed.",
			tone: "danger",
			tool: { state: "failed" },
		});
		expect(
			JSON.stringify([started, progress, completed, failed]),
		).not.toContain("run-1");
	});

	it("keeps only the latest live progress update for one tool", () => {
		const progress = (id: string, sequence: number, timestamp: string) =>
			activity({
				id,
				kind: "tool_progress",
				provider: { category: "runtime", label: "Execution runtime" },
				runtime: { category: "runtime", label: "Execution runtime" },
				sourceNodeId: "node-1",
				sequence,
				timestamp,
				tool: { name: "job", label: "Job", state: "progress" },
			});

		const merged = mergeWorkspaceActivity(
			[
				progress("p1", 1, "2026-05-21T00:00:01.000Z"),
				progress("p2", 2, "2026-05-21T00:00:02.000Z"),
			],
			10,
		);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.id).toBe("p2");
	});

	it("keeps approval and run lifecycle status actionable", () => {
		expect(
			runtimeEventToWorkspaceActivity(
				runtimeEvent({
					event: {
						type: "approval_required",
						approval: {
							provider: { category: "ai_provider", label: "AI provider" },
							kind: "checkpoint",
							title: "Approve output",
							summary: "Execution is waiting for approval.",
							riskLevel: "medium",
							choices: ["approve_once", "deny"],
						},
					} satisfies WorkspaceRuntimeEvent["event"],
				}),
			),
		).toMatchObject({
			kind: "approval",
			title: "Approval required",
			tone: "warning",
		});

		expect(
			runtimeEventToWorkspaceActivity(
				runtimeEvent({
					event: { type: "run_status", status: "failed" },
				}),
			),
		).toMatchObject({
			kind: "provider_run",
			title: "Run status",
			summary: "failed",
			tone: "danger",
		});
	});

	it("preserves text, reasoning, and raw provider events", () => {
		expect(
			runtimeEventToWorkspaceActivity(
				runtimeEvent({
					event: { type: "text_delta", text: "assistant token" },
				}),
			),
		).toMatchObject({
			kind: "provider_run",
			title: "Assistant output",
			summary: "assistant token",
			providerOutput: "assistant token",
		});

		expect(
			runtimeEventToWorkspaceActivity(
				runtimeEvent({
					event: {
						type: "reasoning_delta",
						text: "provider reasoning",
						raw: { channel: "analysis" },
					},
				}),
			),
		).toMatchObject({
			kind: "provider_run",
			title: "Provider reasoning",
			summary: "provider reasoning",
			providerOutput: "provider reasoning",
			providerRaw: { channel: "analysis" },
		});

		expect(
			runtimeEventToWorkspaceActivity(
				runtimeEvent({
					event: {
						type: "raw_event",
						rawEventType: "turn.started",
						raw: { phase: "analysis" },
					},
				}),
			),
		).toMatchObject({
			kind: "provider_run",
			title: "Provider event: turn.started",
			providerRaw: { phase: "analysis" },
		});
	});

	it("drops canonical plan generation projection refreshes", () => {
		const projectionEvent: TaskWorkspaceSseEvent = {
			type: "task_workspace_updated",
			sequence: 3,
			reason: "plan_generation.completed",
		};
		expect(workspaceEventToWorkspaceActivity(projectionEvent)).toBeNull();
	});

	it("uses receive timestamp fallback for command activity without server timestamp", () => {
		const item = workspaceEventToWorkspaceActivity(
			{
				type: "command.accepted",
				sequence: 7,
				commandType: "execution.action",
			},
			7,
			"2026-05-21T00:02:00.000Z",
		);

		expect(item).toMatchObject({
			title: "Command accepted",
			timestamp: "2026-05-21T00:02:00.000Z",
			sequence: 7,
		});
	});
});
