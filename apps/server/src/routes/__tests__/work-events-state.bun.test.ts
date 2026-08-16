import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	subscribeToTaskProjectionEvents,
	type ChronaEngine,
	type TaskProjectionEvent,
} from "@chrona/engine";
import type { GeneratePlanSSEEvent } from "@chrona/contracts";

import { createWorkRoutes } from "../pages/work.routes";

type StreamHandle = {
	events: AsyncIterable<GeneratePlanSSEEvent>;
	emit: (event: GeneratePlanSSEEvent) => void;
	finish: () => void;
};

const state = {
	currentStream: null as StreamHandle | null,
	acceptedPlans: [] as Array<{
		taskId?: string;
		planId?: string;
		workBlockId?: string | null;
	}>,
	dispatchedActions: [] as Array<{ taskId?: string; action?: unknown }>,
	planState: {
		taskId: "task-1",
		aiPlanGenerationStatus: "idle" as "idle" | "accepted",
		savedPlan: null as {
			id: string;
			status: "draft" | "accepted";
			revision: number;
		} | null,
		generationSession: null,
	},
};

function makeFakeEngine(): ChronaEngine {
	return {
		tasks: {
			getBootstrap: async () => ({
				task: { workspaceId: "ws-1" },
			}),
			plan: {
				generate: (_input: unknown) => {
					const queue: GeneratePlanSSEEvent[] = [];
					let resolveWait: (() => void) | null = null;
					let closed = false;

					const notify = () => {
						const pending = resolveWait;
						resolveWait = null;
						pending?.();
					};

					const events: AsyncIterable<GeneratePlanSSEEvent> = {
						[Symbol.asyncIterator]() {
							return {
								async next(): Promise<IteratorResult<GeneratePlanSSEEvent>> {
									while (queue.length === 0) {
										if (closed) {
											return {
												value: undefined,
												done: true,
											} as IteratorResult<GeneratePlanSSEEvent>;
										}
										await new Promise<void>((resolve) => {
											resolveWait = resolve;
										});
									}
									const value = queue.shift()!;
									return {
										value,
										done: false,
									} as IteratorResult<GeneratePlanSSEEvent>;
								},
							};
						},
					};

					const handle: StreamHandle = {
						events,
						emit(event) {
							if (closed) return;
							queue.push(event);
							notify();
						},
						finish() {
							closed = true;
							notify();
						},
					};
					state.currentStream = handle;

					return {
						generationId: "gen-test",
						events,
						emit: handle.emit,
						finish: handle.finish,
					};
				},
				accept: async (input: {
					taskId?: string;
					planId?: string;
					workBlockId?: string | null;
				}) => {
					state.acceptedPlans.push(input);
					state.planState = {
						...state.planState,
						taskId: input.taskId ?? "task-1",
						aiPlanGenerationStatus: "accepted",
						savedPlan: {
							id: input.planId ?? "plan-1",
							status: "accepted",
							revision: 1,
						},
					};
					return { savedPlan: state.planState.savedPlan };
				},
				materialize: async () => {
					throw new Error("not used in this test");
				},
				mutate: async () => {
					throw new Error("not used in this test");
				},
				patch: async () => {
					throw new Error("not used in this test");
				},
				getState: async () => state.planState,
				getActiveGeneration: () => ({ generationSession: null }),
				getGenerationSession: () => ({ generationSession: null }),
				subscribeToActiveGeneration: () => ({
					unsubscribe: () => undefined,
				}),
				subscribeToGeneration: () => ({
					unsubscribe: () => undefined,
				}),
				stopGeneration: () => ({ stopped: false }),
			},
			execution: {
				current: async () => null,
				dispatch: async (input: {
					taskId?: string;
					action?: { action?: string };
					onGraphEvent?: (event: { type: string }) => void;
					onRuntimeEvent?: (event: {
						nodeId: string;
						nodeTitle: string;
						executionScope: string;
						runtimeName: string;
						event: {
							type: "tool_started";
							provider: string;
							runId: string;
							sequence: number;
							timestamp: string;
							toolName: string;
						};
					}) => void;
					onStateChange?: () => void;
				}) => {
					state.dispatchedActions.push(input);
					input.onGraphEvent?.({ type: "node_started" });
					input.onRuntimeEvent?.({
						nodeId: "node-1",
						nodeTitle: "Execute launch",
						executionScope: "scope-work-event",
						runtimeName: "default",
						event: {
							type: "tool_started",
							provider: "omp",
							runId: "provider-run-1",
							sequence: 1,
							timestamp: "2026-05-17T00:00:02.000Z",
							toolName: "browser",
						},
					});
					input.onStateChange?.();
					const statusByAction: Record<string, string> = {
						start_manual: "running",
						pause_session: "waiting_for_user",
						cancel_session: "cancelled",
					};
					const status =
						statusByAction[input.action?.action ?? ""] ?? "started";
					return {
						status,
						checkpoint: null,
						executedNodeIds: [],
					};
				},
				submitCheckpointAction: async () => {
					throw new Error("not used in this test");
				},
			},
		},
	} as unknown as ChronaEngine;
}

const honoApp = new Hono().route("/api", createWorkRoutes(makeFakeEngine()));

async function readSseUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	predicate: (event: { event: string; data: string }) => boolean,
): Promise<Array<{ event: string; data: string }>> {
	const decoder = new TextDecoder();
	let buffer = "";
	const events: Array<{ event: string; data: string }> = [];
	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			return events;
		}
		buffer += decoder.decode(value, { stream: true });
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const trimmed = block.trim();
			if (!trimmed) continue;
			const eventMatch = /^event:\s*(.+)$/m.exec(trimmed);
			const dataMatch = /^data:\s*(.+)$/m.exec(trimmed);
			if (eventMatch && dataMatch) {
				const event = { event: eventMatch[1]!, data: dataMatch[1]! };
				events.push(event);
				if (predicate(event)) return events;
			}
		}
	}
}

async function postCommand(taskId: string, body: Record<string, unknown>) {
	return honoApp.request(`http://local/api/work/${taskId}/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function waitForEventsMatching(
	taskId: string,
	predicate: (events: TaskProjectionEvent[]) => boolean,
): Promise<TaskProjectionEvent[]> {
	const events: TaskProjectionEvent[] = [];
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			subscription.unsubscribe();
			reject(
				new Error(
					`timed out waiting for task projection events; saw ${events.map((event) => event.type).join(", ")}`,
				),
			);
		}, 5000);
		const subscription = subscribeToTaskProjectionEvents(taskId, (event) => {
			events.push(event);
			if (!predicate(events)) return;
			clearTimeout(timeout);
			subscription.unsubscribe();
			resolve(events);
		});
	});
}

beforeEach(() => {
	state.currentStream = null;
	state.acceptedPlans = [];
	state.dispatchedActions = [];
	state.planState = {
		taskId: "task-1",
		aiPlanGenerationStatus: "idle",
		savedPlan: null,
		generationSession: null,
	};
});

afterEach(() => {
	state.currentStream = null;
});

describe("POST /work/:taskId/commands — action refresh events", () => {
	it("emits header state.update before task_workspace_updated after accepting a plan", async () => {
		const taskId = "task-1";
		const received = waitForEventsMatching(
			taskId,
			(events) =>
				events.some((event) => event.type === "state.update") &&
				events.some((event) => event.type === "task_workspace_updated"),
		);

		const response = await postCommand(taskId, {
			type: "plan.accept",
			planId: "plan-1",
			expectedHeadStateVersion: 2,
			idempotencyKey: "accept-plan-1",
		});
		expect(response.status).toBe(202);

		const events = await received;
		expect(state.acceptedPlans).toEqual([
			expect.objectContaining({ taskId, planId: "plan-1", workBlockId: null }),
		]);
		const stateUpdate = events.find(
			(event) => event.type === "state.update",
		) as TaskProjectionEvent & {
			updates?: Record<string, unknown>;
		};
		expect(stateUpdate.updates).toMatchObject({
			"/execution/show-accept-plan": false,
			"/execution/show-generate-plan": false,
			"/execution/can-start": true,
			"/execution/can-pause": false,
			"/execution/can-stop": false,
			"/execution/start-disabled": false,
			"/execution/has-accepted-plan": true,
		});

		const workspaceUpdate = events.find(
			(event) => event.type === "task_workspace_updated",
		) as TaskProjectionEvent & {
			reason?: string;
			taskId?: string;
			workspaceId?: string;
			workBlockId?: string | null;
		};
		expect(workspaceUpdate).toMatchObject({
			type: "task_workspace_updated",
			taskId,
			workspaceId: "ws-1",
			workBlockId: null,
			reason: "plan.accepted",
		});
		expect(
			events.findIndex((event) => event.type === "state.update"),
		).toBeLessThan(
			events.findIndex((event) => event.type === "task_workspace_updated"),
		);
	});

	it("emits scoped live runtime events and refresh state while execution runs", async () => {
		const taskId = "task-1";
		state.planState = {
			taskId,
			aiPlanGenerationStatus: "accepted",
			savedPlan: { id: "plan-1", status: "accepted", revision: 1 },
			generationSession: null,
		};

		const received = waitForEventsMatching(
			taskId,
			(events) =>
				events.some((event) => event.type === "state.update") &&
				events.filter((event) => event.type === "execution.runtime_event")
					.length >= 2 &&
				events.some((event) => event.type === "execution.result"),
		);

		const response = await postCommand(taskId, {
			type: "execution.action",
			action: "start_manual",
			idempotencyKey: "start-test",
		});
		expect(response.status).toBe(202);

		const events = await received;
		expect(state.dispatchedActions).toHaveLength(1);
		expect(state.dispatchedActions[0]).toMatchObject({
			taskId,
			action: expect.objectContaining({ action: "start_manual" }),
		});

		const stateUpdateIndex = events.findIndex(
			(event) => event.type === "state.update",
		);
		const resultIndex = events.findIndex(
			(event) => event.type === "execution.result",
		);
		expect(stateUpdateIndex).toBeGreaterThanOrEqual(0);
		expect(resultIndex).toBeGreaterThanOrEqual(0);
		expect(
			events.filter((event) => event.type === "state.update"),
		).toHaveLength(2);
		expect(stateUpdateIndex).toBeLessThan(resultIndex);

		const stateUpdate = events[stateUpdateIndex] as TaskProjectionEvent & {
			updates?: Record<string, unknown>;
		};
		expect(stateUpdate.updates).toMatchObject({
			"/execution/status": "running",
			"/execution/can-start": false,
			"/execution/can-pause": true,
			"/execution/can-stop": true,
			"/execution/has-plan": true,
			"/execution/has-accepted-plan": true,
		});

		const runtimeEvents = events.filter(
			(event) => event.type === "execution.runtime_event",
		);
		expect(runtimeEvents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					workBlockId: null,
					eventKind: "node_started",
				}),
				expect.objectContaining({
					workBlockId: null,
					eventKind: "tool_started",
					executionScope: "scope-work-event",
					providerLabel: "AI provider",
					runtimeLabel: "Execution runtime",
					provider: { category: "ai_provider", label: "AI provider" },
					runtime: { category: "runtime", label: "Execution runtime" },
					event: expect.objectContaining({
						type: "tool_started",
						label: "Runtime tool",
					}),
				}),
			]),
		);

		const result = events[resultIndex] as TaskProjectionEvent & {
			eventKind?: string;
			workBlockId?: string | null;
		};
		expect(result).toMatchObject({
			eventKind: "running",
			workBlockId: null,
		});
	});
	it("emits running header state immediately when retrying a node", async () => {
		const taskId = "task-1";
		state.planState = {
			taskId,
			aiPlanGenerationStatus: "accepted",
			savedPlan: { id: "plan-1", status: "accepted", revision: 1 },
			generationSession: null,
		};

		const received = waitForEventsMatching(taskId, (events) =>
			events.some((event) => event.type === "execution.result"),
		);
		const response = await postCommand(taskId, {
			type: "execution.action",
			action: "retry_node",
			nodeId: "node-1",
			idempotencyKey: "retry-test",
		});

		expect(response.status).toBe(202);
		const events = await received;
		const stateUpdates = events.filter(
			(event) => event.type === "state.update",
		) as Array<TaskProjectionEvent & { updates?: Record<string, unknown> }>;
		expect(stateUpdates[0]?.updates).toMatchObject({
			"/execution/status": "running",
			"/execution/can-start": false,
			"/execution/can-pause": true,
			"/execution/can-stop": true,
		});
		expect(state.dispatchedActions.at(-1)?.action).toMatchObject({
			action: "retry_node",
			nodeId: "node-1",
		});
	});

	it("emits pause-session header state with Stop visible and Start hidden", async () => {
		const taskId = "task-1";
		state.planState = {
			taskId,
			aiPlanGenerationStatus: "accepted",
			savedPlan: { id: "plan-1", status: "accepted", revision: 1 },
			generationSession: null,
		};

		const received = waitForEventsMatching(
			taskId,
			(events) =>
				events.some((event) => event.type === "state.update") &&
				events.some((event) => event.type === "execution.result"),
		);

		const response = await postCommand(taskId, {
			type: "execution.action",
			action: "pause_session",
			reason: "Pause from test",
			idempotencyKey: "pause-test",
		});
		expect(response.status).toBe(202);

		const events = await received;
		const stateUpdate = events.find(
			(event) => event.type === "state.update",
		) as TaskProjectionEvent & { updates?: Record<string, unknown> };
		expect(stateUpdate.updates).toMatchObject({
			"/execution/status": "waiting_for_user",
			"/execution/can-start": false,
			"/execution/can-pause": false,
			"/execution/can-stop": true,
			"/execution/show-accept-plan": false,
			"/execution/show-generate-plan": false,
			"/execution/has-accepted-plan": true,
		});
		expect(
			events.filter((event) => event.type === "state.update"),
		).toHaveLength(2);
	});

	it("emits cancel-session header state with all primary run controls hidden", async () => {
		const taskId = "task-1";
		state.planState = {
			taskId,
			aiPlanGenerationStatus: "accepted",
			savedPlan: { id: "plan-1", status: "accepted", revision: 1 },
			generationSession: null,
		};

		const received = waitForEventsMatching(
			taskId,
			(events) =>
				events.some((event) => event.type === "state.update") &&
				events.some((event) => event.type === "execution.result"),
		);

		const response = await postCommand(taskId, {
			type: "execution.action",
			action: "cancel_session",
			reason: "Stop from test",
			idempotencyKey: "stop-test",
		});
		expect(response.status).toBe(202);

		const events = await received;
		const stateUpdate = events.find(
			(event) => event.type === "state.update",
		) as TaskProjectionEvent & { updates?: Record<string, unknown> };
		expect(stateUpdate.updates).toMatchObject({
			"/execution/status": "cancelled",
			"/execution/can-start": false,
			"/execution/can-pause": false,
			"/execution/can-stop": false,
			"/execution/show-accept-plan": false,
			"/execution/show-generate-plan": false,
			"/execution/has-accepted-plan": true,
		});
		expect(
			events.filter((event) => event.type === "state.update"),
		).toHaveLength(2);
	});
});

describe("GET /work/:taskId/events — state.snapshot on connect", () => {
	it("emits a state.snapshot as the first event after the handshake", async () => {
		const res = await honoApp.request("http://local/api/work/task-1/events");
		expect(res.status).toBe(200);
		expect(res.body).not.toBeNull();

		const reader = res.body!.getReader();
		const events = await readSseUntil(
			reader,
			(event) => event.event === "state.snapshot",
		);

		const snapshotEvent = events.find(
			(event) => event.event === "state.snapshot",
		);
		if (!snapshotEvent) throw new Error("Missing state.snapshot event");
		const payload = JSON.parse(snapshotEvent.data) as TaskProjectionEvent & {
			state: Record<string, unknown>;
		};
		expect(payload.type).toBe("state.snapshot");
		expect(payload.state).toMatchObject({
			"/plan/status": "idle",
			"/plan/saved/id": null,
			"/plan/generation/id": null,
		});
	});
});

describe("POST /work/:taskId/commands plan.generate — durable state updates", () => {
	it("[PLAN-001] emits a state.update for each durable generation event", async () => {
		const taskId = "task-1";
		const stateUpdates: Array<Record<string, unknown>> = [];

		// Register the terminal listener BEFORE the POST. The route fires
		// `task_workspace_updated` synchronously after the plan stream closes,
		// so we cannot risk subscribing after the 202 response.
		const terminalReceived = new Promise<void>((resolve, reject) => {
			const sub = subscribeToTaskProjectionEvents(taskId, (event) => {
				if (event.type === "task_workspace_updated") {
					sub.unsubscribe();
					resolve();
				}
			});
			setTimeout(() => {
				sub.unsubscribe();
				reject(new Error("timed out waiting for task_workspace_updated"));
			}, 5000);
		});

		let trigger: { unsubscribe: () => void } | null = null;
		try {
			const res = await honoApp.request(
				`http://local/api/work/${taskId}/commands`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: "plan.generate",
						forceRefresh: true,
						idempotencyKey: "generation-state-1",
					}),
				},
			);
			expect(res.status).toBe(202);

			// Wait until the route is parked on the fake stream.
			await new Promise<void>((resolve) => {
				const check = () => {
					if (state.currentStream) resolve();
					else setTimeout(check, 5);
				};
				check();
			});

			trigger = subscribeToTaskProjectionEvents(taskId, (event) => {
				if (event.type === "state.update") {
					stateUpdates.push(
						(
							event as TaskProjectionEvent & {
								updates: Record<string, unknown>;
							}
						).updates,
					);
				}
			});

			const stream = state.currentStream!;
			stream.emit({
				type: "status",
				phase: "requesting_provider",
				message: "Contacting LLM",
			});
			stream.emit({
				type: "status",
				phase: "compiling",
				message: "Compiling plan",
			});
			stream.emit({
				type: "committed",
				planId: "plan-test",
				headStateVersion: 2,
			});
			stream.emit({ type: "done" });
			stream.finish();

			await terminalReceived;

			// Verify state.update fired for every durable stream event.
			expect(stateUpdates.length).toBeGreaterThanOrEqual(3);
			const phases = stateUpdates.flatMap((updates) => {
				const v = updates["/plan/generation/phase"];
				return typeof v === "string" ? [v] : [];
			});
			expect(phases).toContain("requesting_provider");

			const runningUpdate = stateUpdates.find(
				(updates) => updates["/plan/status"] === "generating",
			);
			expect(runningUpdate).toBeDefined();
			expect(runningUpdate!["/plan/generation/status"]).toBe("running");

			// A committed event identifies the durable saved-plan head. Header state
			// is refreshed from the canonical state snapshot after the terminal event.
			const committedUpdate = stateUpdates.find(
				(updates) => typeof updates["/plan/saved/id"] === "string",
			);
			expect(committedUpdate).toBeDefined();
			expect(committedUpdate!["/plan/saved/id"]).toBe("plan-test");
			expect(committedUpdate!["/plan/generation/status"]).toBe("completed");
			expect(committedUpdate!["/plan/status"]).toBe("waiting_acceptance");
			const doneUpdate = stateUpdates.at(-1);
			expect(doneUpdate?.["/plan/status"]).toBeUndefined();
			expect(doneUpdate?.["/plan/generation/is-running"]).toBe(false);
		} finally {
			trigger?.unsubscribe();
		}
	});
});

describe("POST /work/:taskId/commands plan.generate — event volume", () => {
	it("emits exactly one task_workspace_updated and zero plan.generation.event across a full stream", async () => {
		const taskId = "task-1";
		const allEvents: string[] = [];
		const sub = subscribeToTaskProjectionEvents(taskId, (event) => {
			allEvents.push(event.type);
		});

		try {
			const res = await honoApp.request(
				`http://local/api/work/${taskId}/commands`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: "plan.generate",
						forceRefresh: true,
						idempotencyKey: "generation-volume-1",
					}),
				},
			);
			expect(res.status).toBe(202);

			await new Promise<void>((resolve) => {
				const check = () => {
					if (state.currentStream) resolve();
					else setTimeout(check, 5);
				};
				check();
			});

			const stream = state.currentStream!;
			stream.emit({
				type: "status",
				phase: "requesting_provider",
				message: "Contacting LLM",
			});
			stream.emit({
				type: "status",
				phase: "compiling",
				message: "Compiling plan",
			});
			stream.emit({
				type: "committed",
				planId: "plan-test",
				headStateVersion: 2,
			});
			stream.emit({ type: "done" });
			stream.finish();

			// Give the route handler a moment to publish the terminal event.
			await new Promise<void>((resolve) => setTimeout(resolve, 50));

			// The `plan.generation.event` legacy trigger was dropped in favor of
			// the `state.update` channel — there should be none in the stream.
			const planGenerationTriggers = allEvents.filter(
				(type) => type === "plan.generation.event",
			);
			expect(planGenerationTriggers).toHaveLength(0);

			// The terminal `task_workspace_updated` is broadcast exactly once
			// (a refresh trigger so the client picks up the new savedPlan).
			const workspaceUpdates = allEvents.filter(
				(type) => type === "task_workspace_updated",
			);
			expect(workspaceUpdates).toHaveLength(1);
			expect(workspaceUpdates[0]).toBe("task_workspace_updated");

			// `state.update` is the primary state-push channel — one per durable
			// generation event that changes projection state.
			const stateUpdates = allEvents.filter((type) => type === "state.update");
			expect(stateUpdates.length).toBeGreaterThanOrEqual(3);
		} finally {
			sub.unsubscribe();
		}
	});
});

describe("POST /work/:taskId/commands plan.generate — error state.update", () => {
	it("emits a state.update with /plan/generation/error/* paths and keeps the terminal task_workspace_updated", async () => {
		const taskId = "task-1";
		const stateUpdates: Array<Record<string, unknown>> = [];
		const workspaceUpdates: string[] = [];
		let trigger: { unsubscribe: () => void } | null = null;
		const terminalReceived = new Promise<void>((resolve, reject) => {
			trigger = subscribeToTaskProjectionEvents(taskId, (event) => {
				if (event.type === "state.update") {
					stateUpdates.push(
						(
							event as TaskProjectionEvent & {
								updates: Record<string, unknown>;
							}
						).updates,
					);
					return;
				}
				if (event.type === "task_workspace_updated") {
					workspaceUpdates.push(event.type);
				}
				if (
					event.type === "task_workspace_updated" &&
					workspaceUpdates.length === 1
				) {
					trigger?.unsubscribe();
					resolve();
				}
				setTimeout(() => {
					trigger?.unsubscribe();
					reject(
						new Error("timed out waiting for terminal task_workspace_updated"),
					);
				}, 5000);
			});
		});

		try {
			const res = await honoApp.request(
				`http://local/api/work/${taskId}/commands`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: "plan.generate",
						forceRefresh: true,
						idempotencyKey: "generation-error-1",
					}),
				},
			);
			expect(res.status).toBe(202);

			await new Promise<void>((resolve) => {
				const check = () => {
					if (state.currentStream) resolve();
					else setTimeout(check, 5);
				};
				check();
			});

			const stream = state.currentStream!;
			stream.emit({
				type: "status",
				phase: "requesting_provider",
				message: "Contacting LLM",
			});
			stream.emit({
				type: "failed",
				code: "PROVIDER_ERROR",
				message: "provider returned 502",
			});
			stream.finish();

			await terminalReceived;

			const errorUpdate = stateUpdates.find(
				(updates) =>
					updates["/plan/generation/error/code"] === "PROVIDER_ERROR",
			);
			expect(errorUpdate).toBeDefined();
			expect(errorUpdate!["/plan/generation/error/message"]).toBe(
				"provider returned 502",
			);
			expect(errorUpdate!["/plan/status"]).toBe("idle");
			expect(errorUpdate).not.toHaveProperty(
				"/plan/generation/error/buttonRetry",
			);
			expect(errorUpdate).not.toHaveProperty(
				"/plan/generation/error/buttonEditInstruction",
			);
			expect(errorUpdate).not.toHaveProperty(
				"/plan/generation/error/buttonCancel",
			);
			expect(workspaceUpdates).toHaveLength(1);
		} finally {
			trigger!.unsubscribe();
		}
	});

	it("disables retry for non-retryable errors (TASK_NOT_FOUND)", async () => {
		const taskId = "task-1";
		const stateUpdates: Array<Record<string, unknown>> = [];
		const trigger = subscribeToTaskProjectionEvents(taskId, (event) => {
			if (event.type === "state.update") {
				stateUpdates.push(
					(event as TaskProjectionEvent & { updates: Record<string, unknown> })
						.updates,
				);
			}
		});

		try {
			const res = await honoApp.request(
				`http://local/api/work/${taskId}/commands`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: "plan.generate",
						forceRefresh: true,
						idempotencyKey: "generation-error-2",
					}),
				},
			);
			expect(res.status).toBe(202);

			await new Promise<void>((resolve) => {
				const check = () => {
					if (state.currentStream) resolve();
					else setTimeout(check, 5);
				};
				check();
			});

			const stream = state.currentStream!;
			stream.emit({
				type: "status",
				phase: "loading_task",
				message: "Loading task context",
			});
			stream.emit({
				type: "failed",
				code: "TASK_NOT_FOUND",
				message: "Task not found",
			});
			stream.finish();

			// Give the route handler time to publish the terminal state.update.
			await new Promise<void>((resolve) => setTimeout(resolve, 50));

			const errorUpdate = stateUpdates.find(
				(updates) =>
					updates["/plan/generation/error/code"] === "TASK_NOT_FOUND",
			);
			expect(errorUpdate).toBeDefined();
			expect(errorUpdate).not.toHaveProperty(
				"/plan/generation/error/buttonRetry",
			);
			expect(errorUpdate).not.toHaveProperty(
				"/plan/generation/error/buttonEditInstruction",
			);
		} finally {
			trigger.unsubscribe();
		}
	});
});
