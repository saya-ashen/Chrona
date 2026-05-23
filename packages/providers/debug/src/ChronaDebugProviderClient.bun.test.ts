import { describe, expect, it } from "bun:test";
import { planBlueprintSchema } from "@chrona/contracts";

import { ChronaDebugProviderClient } from "./ChronaDebugProviderClient";

describe("ChronaDebugProviderClient", () => {
  it("emits a schema-valid boundary debug plan", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      sessionId: "debug-test-session",
      instructions: "Use chrona_plan_generate to create a test plan.",
      input: "Generate boundary debug plan.",
      stream: true,
    })) {
      events.push(event);
    }

    const toolCall = events.find(
      (event) => event.type === "tool_call" && event.tool === "chrona_plan_generate",
    );
    expect(toolCall).toBeDefined();

    if (!toolCall || toolCall.type !== "tool_call") {
      throw new Error("Debug provider did not emit plan tool call");
    }

    const blueprint = planBlueprintSchema.parse(toolCall?.input);
    const nodeTypes = new Set(blueprint.nodes.map((node) => node.type));
    const incoming = new Map<string, number>();

    for (const edge of blueprint.edges) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }

    expect(blueprint.nodes).toHaveLength(10);
    expect(nodeTypes).toEqual(new Set(["task", "checkpoint", "condition", "wait"]));
    expect(blueprint.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id).sort()).toEqual([
      "debug_collect_context",
      "debug_load_fixture",
    ]);
    expect(blueprint.nodes.some((node) => node.type === "checkpoint" && node.checkpointType === "input")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "checkpoint" && node.checkpointType === "approve")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "wait" && node.timeout?.onTimeout === "notify_user")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "condition" && node.branches.length >= 2)).toBe(true);
    expect(blueprint.edges.some((edge) => edge.label === "slow wait")).toBe(true);
  });
});
