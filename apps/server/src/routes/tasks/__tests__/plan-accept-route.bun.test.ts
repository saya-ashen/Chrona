/**
 * Spec 019 — Server-side plan-accept route test (mocked engine).
 *
 * Verifies the `POST /api/tasks/:taskId/plan/accept` route contract:
 *   - It calls `engine.tasks.plan.accept` with the validated args.
 *   - It returns the engine's response on success.
 *   - It returns 500 with the canonical error message on engine
 *     rejection.
 *
 * The engine is mocked at the function boundary (not the import
 * boundary) — we build a `ChronaEngine`-shaped object that captures
 * the call and returns a canned response. This keeps the test fast
 * (no real DB / no real plan state) and asserts the route's contract
 * in isolation.
 *
 * Plan: specs/019-plan-card-and-accept-tests/plan.md §3 (test E).
 */
import { describe, expect, it } from "bun:test";

import { createPlansRoutes } from "../plan.routes";
import type { ChronaEngine } from "@chrona/engine";

function makeEngineMock(options: {
  acceptImpl: (args: { taskId: string; planId: string; workspaceId: string; workBlockId: string | null; expectedHeadStateVersion: number; idempotencyKey: string }) => Promise<unknown>;
}): ChronaEngine {
  return {
    tasks: {
      plan: {
        accept: options.acceptImpl,
      },
    },
  } as unknown as ChronaEngine;
}

describe("POST /api/tasks/:taskId/plan/accept", () => {
  it("E1. happy path: route forwards the validated args to engine.tasks.plan.accept and returns the engine's response", async () => {
    const acceptCalls: Array<{ taskId: string; planId: string; workspaceId: string; workBlockId: string | null; expectedHeadStateVersion: number; idempotencyKey: string }> = [];
    const engine = makeEngineMock({
      acceptImpl: async (args) => {
        acceptCalls.push(args);
        return { status: "accepted", acceptedAt: "2026-06-13T00:00:00.000Z" };
      },
    });

    const app = createPlansRoutes(engine);
    const res = await app.request(
      "/tasks/task-1/plan/accept",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: "plan-1",
          workspaceId: "workspace-1",
          workBlockId: "wb-1",
          expectedHeadStateVersion: 4,
          idempotencyKey: "accept-1",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; acceptedAt: string };
    expect(body).toEqual({ status: "accepted", acceptedAt: "2026-06-13T00:00:00.000Z" });

    expect(acceptCalls).toHaveLength(1);
    expect(acceptCalls[0]).toEqual({
      taskId: "task-1",
      planId: "plan-1",
      workspaceId: "workspace-1",
      workBlockId: "wb-1",
      expectedHeadStateVersion: 4,
      idempotencyKey: "accept-1",
    });
  });

  it("E2. engine rejection: route returns 500 with the canonical error message", async () => {
    const engine = makeEngineMock({
      acceptImpl: async () => {
        throw new Error("engine boom");
      },
    });

    const app = createPlansRoutes(engine);

    const res = await app.request(
      "/tasks/task-1/plan/accept",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: "plan-1",
          workspaceId: "workspace-1",
          workBlockId: null,
          expectedHeadStateVersion: 0,
          idempotencyKey: "accept-fail-1",
        }),
      },
    );

    expect(res.status).toBe(500);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe("Failed to accept task AI plan");
  });
});
