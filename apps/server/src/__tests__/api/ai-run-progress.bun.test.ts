import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine, startAiRunProgress } from "@chrona/engine";

import { createApiRouter } from "../../routes/api";

function app() {
  return new Hono().route("/api", createApiRouter(createChronaEngine()));
}

describe("AI run progress SSE route", () => {
  it("returns 404 for an unknown operation", async () => {
    const response = await app().request(`/api/ai/runs/missing-${crypto.randomUUID()}/events`);

    expect(response.status).toBe(404);
  });

  it("replays a terminal progress session and closes the stream", async () => {
    const operationId = `progress-${crypto.randomUUID()}`;
    const reporter = startAiRunProgress({ operationId, feature: "goal_review" });
    reporter.emitPhase("connecting");
    reporter.emitPhase("thinking");
    reporter.complete();

    const response = await app().request(`/api/ai/runs/${operationId}/events`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: progress");
    expect(body).toContain('"phase":"queued"');
    expect(body).toContain('"phase":"connecting"');
    expect(body).toContain('"phase":"thinking"');
    expect(body.indexOf('"phase":"queued"')).toBeLessThan(body.indexOf('"phase":"connecting"'));
    expect(body.indexOf('"phase":"connecting"')).toBeLessThan(body.indexOf('"phase":"thinking"'));
    expect(body.indexOf('"phase":"thinking"')).toBeLessThan(body.indexOf('"phase":"completed"'));
    expect(body).toContain('"phase":"completed"');
  });
});
