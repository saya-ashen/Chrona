import { describe, expect, it } from "bun:test";
import { buildGatewayBody } from "./gateway";

describe("buildGatewayBody", () => {
  it("maps generic request fields into an OpenResponses body", () => {
    const body = buildGatewayBody(
      {
        sessionId: "sess-1",
        sessionKey: "sess-1",
        instructions: "Return one execute_task_node_result call.",
        input: {
          nodeId: "node-1",
          objective: "Produce a hello world message",
        },
        structuredOutputSchema: {
          name: "execute_task_node_result",
          description: "Return the minimal task node execution result.",
          schema: {
            type: "object",
            properties: {
              outcome: { type: "string" },
            },
          },
        },
        stream: false,
        maxOutputTokens: 512,
      },
      {
        gatewayHttpUrl: "http://gateway.local",
        gatewayToken: "secret",
        agentId: "main",
        model: "openclaw",
      },
    );

    expect(body).toEqual({
      model: "openclaw",
      user: "sess-1",
      instructions: "Return one execute_task_node_result call.",
      input: [
        {
          type: "message",
          role: "user",
          content: JSON.stringify(
            {
              nodeId: "node-1",
              objective: "Produce a hello world message",
            },
            null,
            2,
          ),
        },
      ],
      tools: [
        {
          type: "function",
          name: "execute_task_node_result",
          description: "Return the minimal task node execution result.",
          parameters: {
            type: "object",
            properties: {
              outcome: { type: "string" },
            },
          },
        },
      ],
      tool_choice: "auto",
      stream: false,
      max_output_tokens: 512,
    });
  });
});
