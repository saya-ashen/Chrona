import { describe, expect, it } from "bun:test";
import {
  chronaToolInputSchema,
  chronaToolOperationSchema,
  chronaToolResultSchema,
  isChronaToolMutating,
  parseChronaToolPayload,
} from "./mcp-task-tools.schema";

describe("MCP task tool contracts", () => {
  it("validates common request and result envelopes", () => {
    expect(
      chronaToolOperationSchema.parse({
        toolName: "chrona.task.read",
        input: { sessionId: "chrona:hermes:task:task-1:execute" },
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
        sessionId: "chrona:hermes:task:task-1:execute",
        payload: {},
      }),
    ).toMatchObject({ sessionId: "chrona:hermes:task:task-1:execute" });

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

    expect(parseChronaToolPayload("chrona.node.result", { status: "complete", summary: "Done" })).toEqual({ status: "complete", summary: "Done" });
    expect(parseChronaToolPayload("chrona.node.result", { status: "blocked", reason: "Waiting on API" })).toEqual({ status: "blocked", reason: "Waiting on API" });
    expect(parseChronaToolPayload("chrona.node.result", { status: "failed", error: "Command failed" })).toEqual({ status: "failed", error: "Command failed" });
    expect(() => parseChronaToolPayload("chrona.node.result", { status: "blocked" })).toThrow("reason is required");
    expect(() => parseChronaToolPayload("chrona.node.result", { status: "failed" })).toThrow("error is required");
  });
});
