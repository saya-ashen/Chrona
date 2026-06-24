import { describe, expect, it } from "bun:test";
import {
  submitNodeResultActionFromControl,
  submitNodeResultActionFromTool,
  toolNameFromControlKind,
} from "./node-result-action";

describe("node result action mapping", () => {
  it("maps MCP terminal tool and control kind through the same submit action", () => {
    const payload = { summary: "done" };

    expect(submitNodeResultActionFromTool({
      toolName: "chrona.node.complete",
      sessionId: "session-1",
      payload,
    })).toEqual(submitNodeResultActionFromControl({
      sessionId: "session-1",
      body: { kind: "complete", payload },
    }));
  });

  it("maps every terminal control kind to its MCP tool", () => {
    expect(toolNameFromControlKind("plan_output")).toBe("chrona.plan.output");
    expect(toolNameFromControlKind("complete")).toBe("chrona.node.complete");
    expect(toolNameFromControlKind("condition_select")).toBe("chrona.node.condition_select");
    expect(toolNameFromControlKind("wait_complete")).toBe("chrona.node.wait_complete");
    expect(toolNameFromControlKind("block")).toBe("chrona.node.block");
    expect(toolNameFromControlKind("fail")).toBe("chrona.node.fail");
  });
});
