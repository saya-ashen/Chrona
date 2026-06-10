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
};

function makeFakeEngine(): ChronaEngine {
  return {
    pages: {
      getWork: async () => ({
        taskShell: { workspaceId: "ws-1" },
      }),
    },
    tasks: {
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
                      return { value: undefined, done: true } as IteratorResult<GeneratePlanSSEEvent>;
                    }
                    await new Promise<void>((resolve) => {
                      resolveWait = resolve;
                    });
                  }
                  const value = queue.shift()!;
                  return { value, done: false } as IteratorResult<GeneratePlanSSEEvent>;
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
        accept: async () => ({ savedPlan: null }),
        materialize: async () => {
          throw new Error("not used in this test");
        },
        mutate: async () => {
          throw new Error("not used in this test");
        },
        patch: async () => {
          throw new Error("not used in this test");
        },
        getState: async () => ({
          taskId: "task-1",
          aiPlanGenerationStatus: "idle" as const,
          savedPlan: null,
          generationSession: null,
        }),
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
        dispatch: async () => {
          throw new Error("not used in this test");
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

beforeEach(() => {
  state.currentStream = null;
});

afterEach(() => {
  state.currentStream = null;
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

    const snapshotEvent = events.find((event) => event.event === "state.snapshot");
    expect(snapshotEvent).toBeDefined();
    const payload = JSON.parse(snapshotEvent!.data) as TaskProjectionEvent & { state: Record<string, unknown> };
    expect(payload.type).toBe("state.snapshot");
    expect(payload.state).toMatchObject({
      "/plan/status": "idle",
      "/plan/saved/id": null,
      "/plan/generation/id": null,
    });
  });
});

describe("POST /work/:taskId/commands plan.generate — state.update alongside plan.generation.event", () => {
  it("emits a state.update per plan stream event in addition to the legacy trigger", async () => {
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
      const res = await honoApp.request(`http://local/api/work/${taskId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "plan.generate", forceRefresh: true }),
      });
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
          stateUpdates.push((event as TaskProjectionEvent & { updates: Record<string, unknown> }).updates);
        }
      });

      const stream = state.currentStream!;
      stream.emit({ type: "status", phase: "requesting_provider", message: "Contacting LLM" });
      stream.emit({
        type: "tool_call",
        tool: "chrona_plan_generate",
        input: {
          title: "Test plan",
          goal: "Test plan",
          nodes: [],
          edges: [],
        },
      });
      stream.emit({ type: "partial", text: "drafting plan" });
      stream.emit({
        type: "result",
        result: {
          id: "plan-test",
          taskId: "task-1",
          status: "draft",
          revision: 1,
          summary: "Test plan",
          prompt: "Test plan",
          blueprint: {
            title: "Test plan",
            goal: "Test plan",
            nodes: [],
            edges: [],
          },
          generatedBy: null,
          generatedAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          compiledPlan: null,
        } as unknown as Extract<GeneratePlanSSEEvent, { type: "result" }>["result"],
      });
      stream.emit({ type: "done" });
      stream.finish();

      await terminalReceived;

      // Verify state.update fired per stream event.
      expect(stateUpdates.length).toBeGreaterThanOrEqual(4);
      const phases = stateUpdates.flatMap((updates) => {
        const v = updates["/plan/generation/phase"];
        return typeof v === "string" ? [v] : [];
      });
      expect(phases).toContain("requesting_provider");

      // Result event should land plan saved fields + completed status.
      // (The terminal `done` event overwrites the last state.update slot,
      // so we search the array for the result update.)
      const resultUpdate = stateUpdates.find((updates) =>
        typeof updates["/plan/saved/id"] === "string"
      );
      expect(resultUpdate).toBeDefined();
      expect(resultUpdate!["/plan/saved/id"]).toBe("plan-test");
      expect(resultUpdate!["/plan/generation/status"]).toBe("completed");
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
      const res = await honoApp.request(`http://local/api/work/${taskId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "plan.generate", forceRefresh: true }),
      });
      expect(res.status).toBe(202);

      await new Promise<void>((resolve) => {
        const check = () => {
          if (state.currentStream) resolve();
          else setTimeout(check, 5);
        };
        check();
      });

      const stream = state.currentStream!;
      stream.emit({ type: "status", phase: "requesting_provider", message: "Contacting LLM" });
      stream.emit({ type: "tool_call", tool: "chrona_plan_generate", input: { title: "T", goal: "G", nodes: [], edges: [] } });
      stream.emit({ type: "partial", text: "draft" });
      stream.emit({
        type: "result",
        result: {
          id: "plan-test",
          taskId: "task-1",
          status: "draft",
          revision: 1,
          summary: "T",
          prompt: "T",
          blueprint: { title: "T", goal: "G", nodes: [], edges: [] },
          generatedBy: null,
          generatedAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          compiledPlan: null,
        } as unknown as Extract<GeneratePlanSSEEvent, { type: "result" }>["result"],
      });
      stream.emit({ type: "done" });
      stream.finish();

      // Give the route handler a moment to publish the terminal event.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // The `plan.generation.event` legacy trigger was dropped in favor of
      // the `state.update` channel — there should be none in the stream.
      const planGenerationTriggers = allEvents.filter((type) => type === "plan.generation.event");
      expect(planGenerationTriggers).toHaveLength(0);

      // The terminal `task_workspace_updated` is broadcast exactly once
      // (a refresh trigger so the client picks up the new savedPlan).
      const workspaceUpdates = allEvents.filter((type) => type === "task_workspace_updated");
      expect(workspaceUpdates).toHaveLength(1);
      expect(workspaceUpdates[0]).toBe("task_workspace_updated");

      // `state.update` is the primary state-push channel — one per
      // significant stream event.
      const stateUpdates = allEvents.filter((type) => type === "state.update");
      expect(stateUpdates.length).toBeGreaterThanOrEqual(4);
    } finally {
      sub.unsubscribe();
    }
  });
});
