import { describe, expect, it } from "bun:test";
import {
  agentControlActionBodySchema,
  agentControlActionPayloadSchemas,
  chronaToolInputSchema,
  chronaToolOperationSchema,
  describeChronaPlanOutputPublicTool,
  chronaToolResultSchema,
  isChronaToolMutating,
  parseChronaToolPayload,
} from "./mcp-task-tools.schema";

describe("MCP task tool contracts", () => {
  it("validates common request and result envelopes", () => {
    expect(
      chronaToolOperationSchema.parse({
        toolName: "chrona.task.read",
        input: { sessionId: "chrona:task:task-1:execute" },
      }),
    ).toMatchObject({ toolName: "chrona.task.read" });

    expect(
      chronaToolResultSchema.parse({
        operationId: "op-1",
        toolName: "chrona.task.read",
        status: "accepted",
        reasonCode: null,
        message: "Task read.",
        affected: { workspaceId: "workspace-1", taskId: "task-1" },
        state: { taskStatus: "Ready" },
        idempotency: "not_applicable",
        auditRef: null,
        recovery: null,
        completedAt: new Date().toISOString(),
      }),
    ).toMatchObject({ status: "accepted" });
  });

  it("classifies mutating tools and preserves idempotency fields", () => {
    const input = chronaToolInputSchema.parse({
      workspaceId: "workspace-1",
      taskId: "task-1",
      idempotencyKey: "agent:task:update:1",
      expectedState: { taskStatus: "Ready", planRevision: 3 },
    });

    expect(input.idempotencyKey).toBe("agent:task:update:1");
    expect(isChronaToolMutating("chrona.task.read")).toBe(false);
    expect(isChronaToolMutating("chrona.task.update")).toBe(true);
  });

  it("accepts session-scoped tool input before Chrona resolves task context", () => {
    expect(
      chronaToolInputSchema.parse({
        sessionId: "chrona:task:task-1:execute",
        payload: {},
      }),
    ).toMatchObject({ sessionId: "chrona:task:task-1:execute" });

    expect(() => chronaToolInputSchema.parse({ payload: {} })).toThrow(
      "sessionId or resolved taskId is required",
    );
  });

  it("accepts provider evidence without making it authoritative state", () => {
    const input = chronaToolInputSchema.parse({
      workspaceId: "workspace-1",
      taskId: "task-1",
      evidence: {
        providerText: "Final JSON says Done",
        toolCalls: [{ tool: "chrona.task.update", callId: "call-1" }],
        toolOutputs: [{ callId: "call-1", status: "accepted" }],
        structuredOutput: { taskStatus: "Done" },
      },
    });

    expect(input.evidence?.structuredOutput).toEqual({ taskStatus: "Done" });
    expect(input.evidence?.toolCalls?.[0]).toMatchObject({ tool: "chrona.task.update" });
  });

  it("validates task, plan, schedule, and execution payloads through reused schemas", () => {
    expect(parseChronaToolPayload("chrona.task.read", undefined)).toEqual({});
    expect(
      parseChronaToolPayload("chrona.task.create", {
        title: "Write release notes",
        priority: "High",
      }),
    ).toMatchObject({ title: "Write release notes" });

    expect(
      parseChronaToolPayload("chrona.task.update", {
        title: "Updated release notes",
      }),
    ).toMatchObject({ title: "Updated release notes" });

    expect(parseChronaToolPayload("chrona.plan.read", undefined)).toEqual({});

    expect(
      parseChronaToolPayload("chrona.plan.generate", {
        title: "Generated MCP plan",
        goal: "Persist a complete graph",
        nodes: [
          {
            id: "first_step",
            type: "task",
            title: "First step",
          },
        ],
        edges: [],
      }),
    ).toMatchObject({ title: "Generated MCP plan", nodes: [{ id: "first_step" }] });

    expect(() => parseChronaToolPayload("chrona.plan.generate", undefined)).toThrow();

    expect(() =>
      parseChronaToolPayload("chrona.plan.mutate", {
        reason: "missing operations",
        operations: [],
      }),
    ).toThrow();

    expect(parseChronaToolPayload("chrona.schedule.read", undefined)).toEqual({});

    expect(
      parseChronaToolPayload("chrona.schedule.propose", {
        dueAt: "2026-05-14T12:00:00.000Z",
      }),
    ).toMatchObject({ dueAt: "2026-05-14T12:00:00.000Z" });

    expect(
      parseChronaToolPayload("chrona.schedule.set", {
        scheduledStartAt: "2026-05-14T12:00:00.000Z",
        scheduledEndAt: "2026-05-14T13:00:00.000Z",
      }),
    ).toMatchObject({ scheduleSource: "system" });

    expect(parseChronaToolPayload("chrona.schedule.clear", undefined)).toEqual({});
    expect(parseChronaToolPayload("chrona.execution.read", undefined)).toEqual({});

    expect(
      parseChronaToolPayload("chrona.execution.dispatch", {
        action: "start_manual",
        idempotencyKey: "agent:start:1",
      }),
    ).toMatchObject({ action: "start_manual" });

    expect(
      parseChronaToolPayload("chrona.execution.dispatch", {
        action: "complete_manual_node",
        summary: "Completed without model-supplied node id",
      }),
    ).toMatchObject({ action: "complete_manual_node" });

    expect(
      parseChronaToolPayload("chrona.execution.dispatch", {
        action: "complete_manual_node",
        terminalKind: "condition",
        branchRef: "B20260524-08-A",
        summary: "Condition selected the pass branch",
      }),
    ).toMatchObject({
      action: "complete_manual_node",
      terminalKind: "condition",
      branchRef: "B20260524-08-A",
    });

    expect(parseChronaToolPayload("chrona.node.read", undefined)).toEqual({});
    expect(parseChronaToolPayload("chrona.dashboard.brief", {
      summaryText: "Needs review",
      spec: { root: "root", elements: { root: { type: "Text", props: { text: "One task needs review." }, children: [] } } },
    })).toMatchObject({ summaryText: "Needs review" });
    expect(() => parseChronaToolPayload("chrona.plan.output", { outputs: [{ kind: "markdown", content: "Done" }] })).toThrow();
    expect(() => parseChronaToolPayload("chrona.plan.output", { outputs: [{ kind: "json", value: { foo: "bar" } }] })).toThrow();
    expect(parseChronaToolPayload("chrona.plan.output", {
      patches: [
        { op: "add", path: "/root", value: "root" },
        { op: "add", path: "/elements/root", value: { type: "Card", props: { title: "Done" }, children: [] } },
      ],
      summary: "Updated plan output",
    })).toEqual({
      patches: [
        { op: "add", path: "/root", value: "root" },
        { op: "add", path: "/elements/root", value: { type: "Card", props: { title: "Done" }, children: [] } },
      ],
      summary: "Updated plan output",
    });
    expect(() => parseChronaToolPayload("chrona.plan.output", { spec: { root: "root", elements: {} }, mode: "replace" })).toThrow();
    expect(() => parseChronaToolPayload("chrona.plan.output", {
      outputs: [{ kind: "json", title: "Wrong wrapper", value: { root: "root", elements: {} } }],
    })).toThrow();
    expect(parseChronaToolPayload("chrona.node.complete", { summary: "Done" })).toEqual({ summary: "Done" });
    expect(parseChronaToolPayload("chrona.node.condition_select", { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Condition met" })).toEqual({ nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Condition met" });
    expect(() => parseChronaToolPayload("chrona.node.block", { reason: "Waiting on API" })).toThrow();
    expect(parseChronaToolPayload("chrona.node.block", {
      reason: "Waiting on API",
      actionForm: {
        instructions: "Provide API access details so the node can continue.",
        submitLabel: "Submit API details",
        inputFields: [{ name: "apiKey", label: "API key", type: "text", required: true }],
      },
    })).toEqual({
      reason: "Waiting on API",
      actionForm: {
        instructions: "Provide API access details so the node can continue.",
        submitLabel: "Submit API details",
        inputFields: [{ name: "apiKey", label: "API key", type: "text", required: true }],
      },
    });
    expect(parseChronaToolPayload("chrona.node.request_input", {
      title: "Confirm channels",
      instructions: "Choose channels for the next stage.",
      fields: [
        {
          kind: "choice",
          name: "channels",
          label: "Channels",
          selection: "multiple",
          options: [
            { value: "europe", label: "Europe", recommended: true },
            { value: "germany", label: "Germany" },
          ],
          required: true,
        },
        { kind: "boolean", name: "excludeSelfFunded", label: "Exclude self-funded", defaultValue: true },
        { kind: "text", name: "notes", label: "Notes", multiline: true },
      ],
      submitLabel: "Confirm and continue",
    })).toMatchObject({
      title: "Confirm channels",
      fields: [{ kind: "choice", selection: "multiple" }, { kind: "boolean" }, { kind: "text" }],
    });
    expect(() => parseChronaToolPayload("chrona.node.request_input", {
      title: "Invalid",
      instructions: "Invalid concrete component",
      fields: [{ kind: "checkboxGroup", name: "channels", label: "Channels" }],
    })).toThrow();
    expect(parseChronaToolPayload("chrona.node.fail", { error: "Command failed" })).toEqual({ error: "Command failed" });
    expect(parseChronaToolPayload("chrona.node.wait_complete", { summary: "Event observed" })).toEqual({ summary: "Event observed" });
    expect(() => parseChronaToolPayload("chrona.node.complete", { nodeId: "node-1", summary: "Done" })).toThrow();
    expect(() => parseChronaToolPayload("chrona.node.condition_select", { summary: "Missing ref" })).toThrow();
    expect(() => parseChronaToolPayload("chrona.node.condition_select", { branchRef: "B20260516-01-A", summary: "Missing node" })).toThrow();
    expect(() => parseChronaToolPayload("chrona.node.condition_select", { nodeId: "condition-node", branchRef: "B20260516-01-A", nextNodeId: "node-2", summary: "No extra ids" })).toThrow();
  });

  it("rejects legacy plan output payloads", () => {
    expect(() => parseChronaToolPayload("chrona.plan.output", {
      spec: {
        root: "root",
        elements: [
          { id: "root", type: "Stack", props: {}, children: ["table"] },
          { id: "table", type: "Table", props: { columns: ["A"], rows: [["A"]] }, children: [] },
        ],
      },
    })).toThrow();

    expect(() => parseChronaToolPayload("chrona.plan.output", {
      spec: { root: "root", elements: { root: { type: "Stack", props: {}, children: [] } } },
      mode: "replace",
    })).toThrow();
  });
  it("describes plan output against summarized runtime context", () => {
    const description = describeChronaPlanOutputPublicTool().description;

    expect(description).toContain("planOutput.hasSpec is false");
    expect(description).toContain("planOutput.root");
    expect(description).toContain("planOutput.elementIds");
    expect(description).toContain("planOutput.rootChildren");
    expect(description).not.toContain("planOutput.spec is null");
    expect(description).not.toContain("planOutput.spec is not null");
  });
  it("defines agent control actions from public MCP payload contracts", () => {
    expect(agentControlActionPayloadSchemas.plan_output).toBeDefined();
    expect(agentControlActionBodySchema.parse({
      kind: "fail",
      payload: { error: "Command failed" },
    })).toEqual({ kind: "fail", payload: { error: "Command failed" } });
    expect(agentControlActionBodySchema.parse({
      kind: "condition_select",
      payload: { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Condition met" },
    })).toEqual({
      kind: "condition_select",
      payload: { nodeId: "condition-node", branchRef: "B20260516-01-A", summary: "Condition met" },
    });
    expect(() => agentControlActionBodySchema.parse({
      kind: "complete",
      payload: { nodeId: "node-1", summary: "Done" },
    })).toThrow();
  });
});
