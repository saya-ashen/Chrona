import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createMcpRoutes } from "../mcp/mcp.routes";

type CapturedToolOperation = {
  toolName: string;
  input: {
    sessionId?: string;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
    taskId?: string;
  };
};

const hiddenContextFieldNames = [
  "workspaceId",
  "taskId",
  "sessionId",
  "actorType",
  "actorId",
  "idempotencyKey",
  "expectedState",
  "expectedRevision",
  "evidence",
] as const;

const hiddenContextArguments = {
  sessionId: "chrona:task:task-1:plan-graph",
  actorType: "agent",
  actorId: "hermes",
  evidence: { providerText: "generated plan" },
};

function app(rejected = false, operations: CapturedToolOperation[] = []) {
  const engine = {
    agentTools: {
      registry: () => ({
        tools: [
          { name: "chrona.execution.read", mutates: false, description: "Read execution." },
          { name: "chrona.node.task_complete", mutates: true, description: "Complete task node." },
        ],
      }),
      resolveInputContext: async (input: unknown) => ({
        ...(input as Record<string, unknown>),
        workspaceId: (input as { workspaceId?: string }).workspaceId ?? "workspace-from-session",
        taskId: (input as { taskId?: string }).taskId ?? "task-from-session",
      }),
      execute: async (operation: unknown) => {
        operations.push(operation as CapturedToolOperation);
        const toolName = (operation as { toolName: string }).toolName;
        const input = (operation as { input: { idempotencyKey?: string; taskId?: string } }).input;
        return {
          operationId: rejected ? "op-rejected" : "op-1",
          toolName,
          status: rejected ? "rejected" : "accepted",
          reasonCode: rejected
            ? "STALE_STATE"
            : null,
          message: rejected
            ? "Expected state is stale."
            : "Tool executed.",
          affected: { taskId: input.taskId ?? "task-1" },
          state: { taskStatus: "Ready", idempotencyKey: input.idempotencyKey },
          idempotency: rejected ? "new" : "not_applicable",
          auditRef: rejected ? "op-rejected" : null,
          recovery: rejected ? { nextTool: "chrona.execution.read" } : null,
          completedAt: new Date().toISOString(),
        };
      },
    },
  };
  const a = new Hono();
  a.route("/api", createMcpRoutes(engine as unknown as Parameters<typeof createMcpRoutes>[0]));
  return a;
}

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

async function postRpc(body: unknown, rejected = false) {
  return app(rejected).request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

async function postRpcWithOperations(body: unknown) {
  const operations: CapturedToolOperation[] = [];
  const response = await app(false, operations).request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  return { response, operations };
}

describe("MCP routes", () => {
  it("responds to standard MCP initialize", async () => {
    const response = await postRpc(
      rpc("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "chrona-test", version: "1.0.0" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      result: { capabilities: { tools: {} }, serverInfo: { name: "chrona" } },
    });
  });

  it("lists Chrona tools through tools/list", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_execution_read");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_condition_select");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("chrona_plan_generate");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("chrona_checkpoint_submit");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("chrona_node_result");
  });

  it("lists minimal external tool schemas with descriptions", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const conditionSelect = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_condition_select",
    );

    expect(conditionSelect.description).toBe("Select the current condition branch by branchRef. Does not accept backend node IDs.");
    expect(conditionSelect.inputSchema.required).toEqual(["branchRef", "summary"]);
    expect(conditionSelect.inputSchema.properties.branchRef).toMatchObject({ type: "string" });
    expect(conditionSelect.inputSchema.properties.nodeId).toBeUndefined();
    expect(conditionSelect.inputSchema.properties.nextNodeId).toBeUndefined();
    expect(conditionSelect.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(conditionSelect.inputSchema.properties.evidence).toBeUndefined();
  });

  it("does not expose hidden context fields in plan generation schema", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const planGenerate = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_plan_generate",
    );

    expect(planGenerate.inputSchema.required).toEqual(["title", "goal", "nodes"]);
    expect(planGenerate.inputSchema.properties.title).toMatchObject({ type: "string" });
    expect(planGenerate.inputSchema.properties.goal).toMatchObject({ type: "string" });
    expect(planGenerate.inputSchema.properties.nodes).toMatchObject({ type: "array" });
    expect(planGenerate.inputSchema.properties.sessionId).toBeUndefined();
    expect(planGenerate.inputSchema.properties.actorType).toBeUndefined();
    expect(planGenerate.inputSchema.properties.actorId).toBeUndefined();
    expect(planGenerate.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(planGenerate.inputSchema.properties.evidence).toBeUndefined();
    expect(planGenerate.inputSchema.properties.expectedRevision).toBeUndefined();
  });

  it("does not expose hidden context fields in any public tool schema", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const tool of body.result.tools as { inputSchema: { properties: Record<string, unknown> } }[]) {
      for (const fieldName of hiddenContextFieldNames) {
        expect(tool.inputSchema.properties[fieldName]).toBeUndefined();
      }
    }
  });

  it("registers the minimal external Chrona MCP tool surface", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "chrona_condition_select",
      "chrona_execution_read",
      "chrona_node_block",
      "chrona_node_fail",
      "chrona_node_read",
      "chrona_plan_generate",
      "chrona_plan_read",
      "chrona_task_complete",
      "chrona_wait_complete",
    ]);
  });

  it("dispatches Chrona tools through tools/call", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_execution_read",
        arguments: {},
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        content: [{ type: "text", text: "Tool executed." }],
        structuredContent: { status: "accepted", message: "Tool executed.", state: { taskStatus: "Ready" } },
      },
    });
  });

  it("returns slim accepted mutating tool results to the model", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_complete",
        arguments: { summary: "Done" },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent).toEqual({
      status: "accepted",
      message: "Tool executed.",
      next: "stop",
    });
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("operationId");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("affected");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("auditRef");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("idempotency");
  });

  it("dispatches every exposed Chrona MCP tool to the expected internal operation", async () => {
    const sessionId = "chrona:task:task-1:execute";
    const cases = [
      ["chrona_execution_read", "chrona.execution.read", {}, {}],
      ["chrona_plan_read", "chrona.plan.read", {}, {}],
      ["chrona_plan_generate", "chrona.plan.generate", {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }],
      ["chrona_node_read", "chrona.node.read", {}, {}],
      ["chrona_task_complete", "chrona.node.task_complete", { summary: "Done" }, { summary: "Done" }],
      ["chrona_condition_select", "chrona.node.condition_select", { branchRef: "B20260516-01-A", summary: "Yes" }, { branchRef: "B20260516-01-A", summary: "Yes" }],
      ["chrona_node_block", "chrona.node.block", { reason: "Waiting on API" }, { reason: "Waiting on API" }],
      ["chrona_node_fail", "chrona.node.fail", { error: "Command failed" }, { error: "Command failed" }],
      ["chrona_wait_complete", "chrona.node.wait_complete", { summary: "Event observed" }, { summary: "Event observed" }],
    ] as const;

    for (const [externalName, internalName, args, expectedPayload] of cases) {
      const { response, operations } = await postRpcWithOperations(
        rpc("tools/call", {
          name: externalName,
          arguments: args,
          _meta: { sessionId },
        }),
      );

      expect(response.status).toBe(200);
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        toolName: internalName,
        input: {
          sessionId,
          taskId: "task-from-session",
          payload: expectedPayload,
        },
      });
      expect(operations[0].input.payload).toEqual(expectedPayload);
    }
  });

  it("generates idempotency keys for mutating tools without exposing them to the model", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_complete",
        arguments: { summary: "Done" },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent.status).toBe("accepted");
    expect(body.result.structuredContent.next).toBe("stop");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("idempotencyKey");
  });

  it("accepts hidden context injected into plan generation arguments", async () => {
    const blueprint = {
      title: "Generated MCP plan",
      goal: "Persist a complete graph",
      nodes: [{ id: "first_step", type: "task", title: "First step" }],
      edges: [],
    };
    const { response, operations } = await postRpcWithOperations(
      rpc("tools/call", {
        name: "chrona_plan_generate",
        arguments: {
          ...blueprint,
          ...hiddenContextArguments,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      toolName: "chrona.plan.generate",
      input: {
        sessionId: "chrona:task:task-1:plan-graph",
        taskId: "task-from-session",
        payload: blueprint,
      },
    });
    expect(operations[0].input.payload).toEqual(blueprint);
  });

  it("accepts hidden context injected into every public tool call", async () => {
    const cases = [
      ["chrona_execution_read", "chrona.execution.read", {}, {}],
      ["chrona_plan_read", "chrona.plan.read", {}, {}],
      ["chrona_plan_generate", "chrona.plan.generate", {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }, {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [{ id: "first_step", type: "task", title: "First step" }],
        edges: [],
      }],
      ["chrona_node_read", "chrona.node.read", {}, {}],
      ["chrona_task_complete", "chrona.node.task_complete", { summary: "Done" }, { summary: "Done" }],
      ["chrona_condition_select", "chrona.node.condition_select", { branchRef: "B20260516-01-A", summary: "Yes" }, { branchRef: "B20260516-01-A", summary: "Yes" }],
      ["chrona_node_block", "chrona.node.block", { reason: "Waiting on API" }, { reason: "Waiting on API" }],
      ["chrona_node_fail", "chrona.node.fail", { error: "Command failed" }, { error: "Command failed" }],
      ["chrona_wait_complete", "chrona.node.wait_complete", { summary: "Event observed" }, { summary: "Event observed" }],
    ] as const;

    for (const [externalName, internalName, args, expectedPayload] of cases) {
      const { response, operations } = await postRpcWithOperations(
        rpc("tools/call", {
          name: externalName,
          arguments: { ...args, ...hiddenContextArguments },
        }),
      );

      expect(response.status).toBe(200);
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        toolName: internalName,
        input: {
          sessionId: hiddenContextArguments.sessionId,
          taskId: "task-from-session",
          payload: expectedPayload,
        },
      });
      expect(operations[0].input.payload).toEqual(expectedPayload);
    }
  });

  it("resolves injected sessionId before dispatching Chrona tools", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_execution_read",
        arguments: {},
        _meta: { sessionId: "chrona:task:task-1:plan-graph" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          status: "accepted",
          message: "Tool executed.",
          state: { taskStatus: "Ready" },
        },
      },
    });
  });

  it("returns rejected Chrona results as MCP tool errors with structured content", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_execution_read",
        arguments: {},
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
      true,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          status: "rejected",
          reasonCode: "STALE_STATE",
          recovery: { nextTool: "chrona.execution.read" },
        },
      },
    });
  });

  it("does not expose idempotency fields in mutating tool schemas", async () => {
    const response = await postRpc(
      rpc("tools/list"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const taskComplete = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_task_complete",
    );
    expect(taskComplete.inputSchema.properties.idempotencyKey).toBeUndefined();
    expect(taskComplete.inputSchema.properties.evidence).toBeUndefined();
    expect(taskComplete.inputSchema.properties.expectedRevision).toBeUndefined();
  });

  it("exposes the same structured output contract used to validate task completion", async () => {
    const response = await postRpc(rpc("tools/list"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const taskComplete = body.result.tools.find(
      (tool: { name: string }) => tool.name === "chrona_task_complete",
    );

    expect(taskComplete.inputSchema.properties.outputs).toMatchObject({
      type: "array",
      items: {
        oneOf: expect.arrayContaining([
          expect.objectContaining({
            required: expect.arrayContaining(["kind", "value"]),
            properties: expect.objectContaining({
              kind: expect.objectContaining({ const: "json" }),
              value: expect.any(Object),
            }),
          }),
          expect.objectContaining({
            required: expect.arrayContaining(["kind", "content"]),
            properties: expect.objectContaining({
              kind: expect.objectContaining({ const: "text" }),
              content: expect.objectContaining({ type: "string" }),
            }),
          }),
        ]),
      },
    });
  });

  it("rejects task completion outputs that pass the old loose public schema", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_task_complete",
        arguments: {
          summary: "Done",
          outputs: [{ type: "script_spec", value: { ok: true } }],
        },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("kind");
    expect(JSON.stringify(body)).toContain("Invalid discriminator value");
  });

  it("rejects backend IDs in public condition terminal schema", async () => {
    const response = await postRpc(
      rpc("tools/call", {
        name: "chrona_condition_select",
        arguments: { branchRef: "B20260516-01-A", nextNodeId: "node-2", summary: "No ids" },
        _meta: { sessionId: "chrona:task:task-1:execute" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("nextNodeId");
  });

  it("removes the obsolete custom task-tools endpoint", async () => {
    const response = await app().request("/api/mcp/task-tools");
    expect(response.status).toBe(404);
  });
});
