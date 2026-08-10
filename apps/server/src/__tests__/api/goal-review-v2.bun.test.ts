import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { GoalReviewProgressEvent } from "@chrona/contracts/api";
import type { ChronaEngine } from "@chrona/engine";

import { createGoalRoutes } from "../../routes/goals.routes";

const operationId = "00000000-0000-4000-8000-000000000001";
const goalId = "goal-1";
const proposalId = "proposal-1";

type ProgressSubscription = { unsubscribe(): void };
type ProgressListener = (event: GoalReviewProgressEvent) => void;

function app(goals: Record<string, unknown>) {
  return new Hono().route("/api", createGoalRoutes({ goals } as ChronaEngine));
}

function post(server: Hono, path: string, body: unknown) {
  return server.request(`http://local/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Goal Review v2 API contract", () => {
  it("accepts generation, answers, and retries through their proposal-scoped v2 routes", async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const response = { proposalId, status: "Generating", version: 2 };
    const server = app({
      generateReview: async (input: unknown) => {
        calls.push({ operation: "generate", input });
        return response;
      },
      answerReviewProposal: async (input: unknown) => {
        calls.push({ operation: "answer", input });
        return { ...response, version: 3 };
      },
      retryReviewProposal: async (input: unknown) => {
        calls.push({ operation: "retry", input });
        return { ...response, version: 4 };
      },
      applyReviewProposal: async (input: unknown) => {
        calls.push({ operation: "apply", input });
        return { ...response, status: "Applied", version: 5 };
      },
      rejectReviewProposal: async (input: unknown) => {
        calls.push({ operation: "reject", input });
        return { ...response, status: "Rejected", version: 6 };
      },
    });

    const generated = await post(server, `/goals/${goalId}/review-proposals/generate`, {
      idempotencyKey: "review-generate-1",
      operationId,
      mode: "initial",
    });
    const answered = await post(server, `/goals/${goalId}/review-proposals/${proposalId}/answers`, {
      operationId,
      expectedVersion: 2,
      answers: [{ questionId: "scope", answer: "Keep the review bounded." }],
    });
    const retried = await post(server, `/goals/${goalId}/review-proposals/${proposalId}/retry`, {
      operationId,
      expectedVersion: 3,
    });
    const applied = await post(server, `/goals/${goalId}/review-proposals/${proposalId}/apply`, {
      idempotencyKey: "review-apply-1",
      decisions: [{ itemId: "focus", action: "accept" }],
      expectedVersion: 4,
      expectedGoalUpdatedAt: "2026-07-22T00:00:00.000Z",
      dependencyHashes: { focus: "sha256:focus" },
    });
    const rejected = await post(server, `/goals/${goalId}/review-proposals/${proposalId}/reject`, {
      idempotencyKey: "review-reject-1",
    });

    expect(generated.status).toBe(202);
    expect(await generated.json()).toEqual(response);
    expect(answered.status).toBe(202);
    expect(await answered.json()).toEqual({ ...response, version: 3 });
    expect(retried.status).toBe(202);
    expect(await retried.json()).toEqual({ ...response, version: 4 });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({ ...response, status: "Applied", version: 5 });
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ ...response, status: "Rejected", version: 6 });
    expect(calls).toEqual([
      {
        operation: "generate",
        input: { goalId, command: { idempotencyKey: "review-generate-1", operationId, mode: "initial" } },
      },
      {
        operation: "answer",
        input: {
          goalId,
          proposalId,
          command: { operationId, expectedVersion: 2, answers: [{ questionId: "scope", answer: "Keep the review bounded." }] },
        },
      },
      {
        operation: "retry",
        input: { goalId, proposalId, command: { operationId, expectedVersion: 3 } },
      },
      {
        operation: "apply",
        input: {
          goalId,
          proposalId,
          command: {
            idempotencyKey: "review-apply-1",
            expectedVersion: 4,
            expectedGoalUpdatedAt: "2026-07-22T00:00:00.000Z",
            dependencyHashes: { focus: "sha256:focus" },
            decisions: [{ itemId: "focus", action: "accept" }],
          },
        },
      },
      {
        operation: "reject",
        input: { goalId, proposalId, command: { idempotencyKey: "review-reject-1" } },
      },
    ]);
  });

  it("preserves terminal states without exposing domain or provider payloads", async () => {
    const events: GoalReviewProgressEvent[] = [
      { proposalId, status: "Ready", version: 5, message: "Review ready." },
      { proposalId, status: "CannotComplete", version: 6, message: "Review cannot complete." },
      { proposalId, status: "Failed", version: 7, message: "Review generation failed." },
    ];
    const server = app({
      subscribeReviewProgress: async (input: { onEvent: ProgressListener }): Promise<ProgressSubscription> => {
        for (const event of events) input.onEvent(event);
        return { unsubscribe() {} };
      },
    });

    const response = await server.request(`http://local/api/goals/${goalId}/review-proposals/${proposalId}/progress`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"status":"Ready"');
    expect(body).toContain('"status":"CannotComplete"');
    expect(body).not.toContain("cannotCompleteReason");
    expect(body).toContain('"status":"Failed"');
    expect(body).toContain('"version":7');
  });

  it("rejects malformed v2 commands before they reach the engine and leaves legacy review URLs unavailable", async () => {
    let answersCalled = 0;
    const server = app({
      answerReviewProposal: async () => {
        answersCalled += 1;
        return { proposalId, status: "Generating", version: 1 };
      },
    });

    const invalid = await post(server, `/goals/${goalId}/review-proposals/${proposalId}/answers`, {
      operationId: "not-a-uuid",
      expectedVersion: -1,
      answers: [],
    });
    const legacy = await post(server, `/goals/${goalId}/reviews/generate`, {
      idempotencyKey: "review-generate-1",
      operationId,
    });

    expect(invalid.status).toBe(400);
    expect(answersCalled).toBe(0);
    expect(legacy.status).toBe(404);
  });

  it("returns 404 instead of opening a stream when the review proposal is unknown", async () => {
    const server = app({
      subscribeReviewProgress: async () => null,
    });

    const response = await server.request(`http://local/api/goals/${goalId}/review-proposals/${proposalId}/progress`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "Goal review proposal not found" });
  });

  it("replays a terminal public progress event, closes the SSE response, and unsubscribes exactly once", async () => {
    let unsubscribeCount = 0;
    const terminalEvent = {
      proposalId,
      status: "NeedsInput",
      version: 4,
      message: "Please clarify the rollout scope.",
      questions: [{ id: "scope", prompt: "What is in scope?", required: true }],
      providerDiagnostic: "must never cross the SSE boundary",
    } as GoalReviewProgressEvent & { providerDiagnostic: string };
    const server = app({
      subscribeReviewProgress: async (input: { onEvent: ProgressListener }): Promise<ProgressSubscription> => {
        input.onEvent(terminalEvent);
        return { unsubscribe: () => { unsubscribeCount += 1; } };
      },
    });

    const response = await server.request(`http://local/api/goals/${goalId}/review-proposals/${proposalId}/progress`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: progress");
    expect(body).toContain('"proposalId":"proposal-1"');
    expect(body).toContain('"status":"NeedsInput"');
    expect(body).not.toContain("questions");
    expect(body).not.toContain("providerDiagnostic");
    expect(body).not.toContain("must never cross the SSE boundary");
    expect(unsubscribeCount).toBe(1);
  });
});
