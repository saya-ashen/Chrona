import { describe, expect, it } from "bun:test";
import {
  submitNodeResultActionFromControl,
  submitNodeResultActionFromTool,
  toolNameFromControlKind,
} from "./node-result-action";

describe("node result action mapping", () => {
  it("maps MCP terminal tool and control kind through the same public submit action while retaining private session", () => {
    const payload = { summary: "done" };

    const fromTool = submitNodeResultActionFromTool({
      toolName: "chrona.node.complete",
      sessionId: "session-1",
      payload,
    });
    const fromControl = submitNodeResultActionFromControl({
      sessionId: "session-1",
      body: { kind: "complete", payload },
    });
    expect(fromTool).not.toBeNull();
    expect(fromControl).not.toBeNull();
    const { sessionId: toolSessionId, ...toolAction } = fromTool!;
    const { sessionId: controlSessionId, ...controlAction } = fromControl!;

    expect(toolAction).toEqual(controlAction);
    expect(toolSessionId).toBe("session-1");
    expect(controlSessionId).toBe("session-1");
  });

  it("maps every terminal control kind to its MCP tool", () => {
    expect(toolNameFromControlKind("complete")).toBe("chrona.node.complete");
    expect(toolNameFromControlKind("condition_select")).toBe("chrona.node.condition_select");
    expect(toolNameFromControlKind("wait_complete")).toBe("chrona.node.wait_complete");
    expect(toolNameFromControlKind("block")).toBe("chrona.node.block");
    expect(toolNameFromControlKind("fail")).toBe("chrona.node.fail");
  });
});
