import { beforeEach, describe, expect, it } from "bun:test";
import { aiClientRegistry, createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import { createApiRouter } from "../../routes/api";
import { resetTestDb } from "../bun-test-helpers";

function sseEvents(text: string) {
  return text
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((event): event is { event: string; data: Record<string, unknown> } => Boolean(event));
}

describe("AI suggestion API", () => {
  beforeEach(resetTestDb);

  it("streams provider-backed structured suggestions", async () => {
    const client = await db.aiClient.create({
      data: {
        name: "Suggestion debug provider",
        type: "debug",
        config: { profile: "deterministic" },
        isDefault: true,
        enabled: true,
      },
    });
    await db.aiFeatureBinding.create({ data: { feature: "suggest", clientId: client.id } });
    await aiClientRegistry.refresh();
    const app = createApiRouter(createChronaEngine());

    const response = await app.request("/ai/auto-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Review" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = sseEvents(await response.text());
    expect(events.every((event) => ["status", "suggestions", "done", "error"].includes(event.event))).toBe(true);
    const suggestions = events.find((event) => event.event === "suggestions");
    expect(suggestions?.data.isFinal).toBe(true);
    const suggestionItems = suggestions?.data.suggestions;
    expect(Array.isArray(suggestionItems)).toBe(true);
    if (!Array.isArray(suggestionItems)) throw new Error("suggestion payload must be an array");
    expect(suggestionItems.length).toBeGreaterThanOrEqual(2);
    expect(suggestionItems[0]).toEqual(expect.objectContaining({
      summary: expect.any(String),
      action: expect.objectContaining({
        type: "create_task",
        title: expect.any(String),
      }),
    }));
    expect(events.at(-1)?.event).toBe("done");
  });

  it("returns an explicit error when no suggestion provider is configured", async () => {
    await aiClientRegistry.refresh();
    const response = await createApiRouter(createChronaEngine()).request("/ai/auto-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Review" }),
    });
    expect(response.status).toBe(503);
  });
});
