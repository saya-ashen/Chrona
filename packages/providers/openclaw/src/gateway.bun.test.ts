import { describe, expect, it } from "bun:test";
import { buildGatewayBody, parseFunctionItems } from "./gateway";

describe("buildGatewayBody", () => {
  it("maps generic request fields into an OpenResponses body", () => {
    const body = buildGatewayBody(
      {
        sessionId: "sess-1",
        sessionKey: "sess-1",
        instructions: "Advance the current task node through Chrona MCP tools.",
        input: {
          nodeId: "node-1",
          objective: "Produce a hello world message",
        },
        structuredOutputSchema: {
          name: "chrona_plan_mutate",
          description: "Persist Chrona plan execution progress.",
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
      instructions: "Advance the current task node through Chrona MCP tools.",
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
          name: "chrona_plan_mutate",
          description: "Persist Chrona plan execution progress.",
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

  it("parses Chrona tool traces as evidence without applying lifecycle state", () => {
    const { toolCalls, toolCallOutputs } = parseFunctionItems({
      output: [
        {
          type: "function_call",
          name: "chrona.task.update",
          call_id: "call-1",
          arguments: JSON.stringify({
            workspaceId: "workspace-1",
            taskId: "task-1",
            payload: { title: "Agent title" },
          }),
        },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({ status: "accepted", state: { taskTitle: "Chrona title" } }),
        },
      ],
    });

    expect(toolCalls).toEqual([
      {
        tool: "chrona.task.update",
        callId: "call-1",
        input: {
          workspaceId: "workspace-1",
          taskId: "task-1",
          payload: { title: "Agent title" },
        },
        status: "completed",
      },
    ]);
    expect(toolCallOutputs).toEqual([
      {
        callId: "call-1",
        output: JSON.stringify({ status: "accepted", state: { taskTitle: "Chrona title" } }),
      },
    ]);
  });
});
