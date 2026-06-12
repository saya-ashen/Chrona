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

type SpecPatchEvent = TaskProjectionEvent & {
  document: string;
  patches: Array<{ op: string; path: string; value?: unknown; from?: string }>;
};

function isSpecPatch(event: TaskProjectionEvent): event is SpecPatchEvent {
  return (
    event.type === "spec.patch"
    && (event as TaskProjectionEvent & { document?: string }).document === "header"
    && Array.isArray((event as TaskProjectionEvent & { patches?: unknown[] }).patches)
  );
}

describe("POST /work/:taskId/commands — plan.generate spec.patch lifecycle", () => {
  it("emits a reset spec.patch after the plan generation stream finishes successfully", async () => {
    const taskId = "task-1";

    const disableReceived = waitForEventMatching(taskId, (event) => {
      if (!isSpecPatch(event)) return false;
      return event.patches.some((patch) =>
        patch.path === "/elements/action:generate-plan/props/disabled" && patch.value === true
      );
    });
    const resetReceived = waitForEventMatching(taskId, (event) => {
      if (!isSpecPatch(event)) return false;
      return event.patches.some((patch) =>
        patch.path === "/elements/action:generate-plan/props/label" && patch.value === "Generate plan"
      );
    });

    const res = await postCommand(taskId, { type: "plan.generate", forceRefresh: true });
    expect(res.status).toBe(202);

    // Wait until the route's for-await is parked on the fake stream before
    // driving events into it.
    await disableReceived;

    const stream = state.currentStream;
    if (!stream) throw new Error("fake plan stream was never registered");

    stream.emit({ type: "status", phase: "completed", message: "Plan generated." });
    stream.emit({ type: "done" });
    stream.finish();

    const resetEvent = await resetReceived;
    expect(resetEvent).toBeDefined();
    const patches = (resetEvent as SpecPatchEvent).patches;
    expect(patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan" }),
        expect.objectContaining({ op: "remove", path: "/elements/action:generate-plan/props/disabled" }),
      ]),
    );
  });
});
