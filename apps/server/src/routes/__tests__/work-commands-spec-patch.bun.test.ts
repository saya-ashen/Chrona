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
  capturedEvents: [] as TaskProjectionEvent[],
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

async function postCommand(taskId: string, body: Record<string, unknown>) {
  return honoApp.request(`http://local/api/work/${taskId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForEventMatching(
  taskId: string,
  predicate: (event: TaskProjectionEvent) => boolean,
): Promise<TaskProjectionEvent> {
  const { promise, resolve } = Promise.withResolvers<TaskProjectionEvent>();
  const subscription = subscribeToTaskProjectionEvents(taskId, (event) => {
    state.capturedEvents.push(event);
    if (predicate(event)) resolve(event);
  });
  try {
    return await promise;
  } finally {
    subscription.unsubscribe();
  }
}

beforeEach(() => {
  state.capturedEvents = [];
  state.currentStream = null;
});

afterEach(() => {
  state.currentStream = null;
});

type StateUpdateEvent = TaskProjectionEvent & {
  updates: Record<string, unknown>;
};

function isStateUpdate(event: TaskProjectionEvent): event is StateUpdateEvent {
  return event.type === "state.update" && typeof (event as { updates?: unknown }).updates === "object";
}

describe("POST /work/:taskId/commands — plan.generate header state lifecycle", () => {
  it("toggles generation header actions through state updates", async () => {
    const taskId = "task-1";

    const runningReceived = waitForEventMatching(taskId, (event) => (
      isStateUpdate(event)
      && event.updates["/plan/generation/is-running"] === true
      && event.updates["/plan/generation/header-action-disabled"] === true
    ));
    const resetReceived = waitForEventMatching(taskId, (event) => (
      isStateUpdate(event)
      && event.updates["/plan/generation/is-running"] === false
      && event.updates["/plan/generation/header-action-disabled"] === false
    ));

    const res = await postCommand(taskId, { type: "plan.generate", forceRefresh: true });
    expect(res.status).toBe(202);

    await runningReceived;

    const stream = state.currentStream;
    if (!stream) throw new Error("fake plan stream was never registered");

    stream.emit({ type: "status", phase: "completed", message: "Plan generated." });
    stream.emit({ type: "done" });
    stream.finish();

    const resetEvent = await resetReceived;
    expect(resetEvent).toBeDefined();
    expect((resetEvent as StateUpdateEvent).updates).toMatchObject({
      "/plan/generation/is-running": false,
      "/plan/generation/header-action-disabled": false,
    });
  });
});
