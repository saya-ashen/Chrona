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
    expect(events.some((event) => event.event === "tool_call")).toBe(true);
    const suggestions = events.find((event) => event.event === "suggestions");
    expect(suggestions?.data.isFinal).toBe(true);
    expect(suggestions?.data.suggestions).toEqual([
      expect.objectContaining({
        summary: "A deterministic provider-backed suggestion.",
        action: expect.objectContaining({
          type: "create_task",
          title: "Review suggested task",
        }),
      }),
    ]);
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
