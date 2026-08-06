import { describe, expect, it } from "bun:test";
import type { EffectivePlanNode } from "@chrona/contracts/ai";
import type { NodeExecutorInput } from "./types";
import { WaitNodeExecutor } from "./wait-executor";

function input(overrides: Partial<NodeExecutorInput> = {}): NodeExecutorInput {
  const node = {
    id: "wait-1",
    nodeId: "wait-1",
    activeLayerId: null,
    semanticKey: "wait-1",
    definition: {
      title: "等待用户确认",
      objective: "等待用户确认",
      semantics: { type: "wait" },
    },
    invalidated: false,
    localId: "wait_for_user",
    type: "wait",
    title: "等待用户确认",
    config: { waitFor: "用户确认" },
    dependencies: [],
    dependents: [],
    status: "waiting_for_user",
    attempts: 1,
    metadata: {},
    dependenciesSatisfied: true,
    ready: false,
    reachable: true,
  } as unknown as EffectivePlanNode;

  return {
    taskId: "task-1",
    mainSession: {
      id: "session-1",
      taskId: "task-1",
      sessionKey: "session-key",
    },
    node,
    plan: {} as NodeExecutorInput["plan"],
    attempt: {} as NodeExecutorInput["attempt"],
    trigger: "manual",
    runtimeName: "hermes",
    ...overrides,
  };
}

describe("WaitNodeExecutor", () => {
  it("completes an external wait when the user submits input", async () => {
    const result = await new WaitNodeExecutor().execute(
      input({
        inputFields: { response: "approved" },
        userInput: "response: approved",
      }),
    );

    expect(result).toMatchObject({
      status: "done",
      summary: "Wait condition completed: 用户确认",
      output: {
        inputFields: { response: "approved" },
        userInput: "response: approved",
      },
    });
  });

  it("continues to wait when no resume input is supplied", async () => {
    const result = await new WaitNodeExecutor().execute(input());

    expect(result).toMatchObject({
      status: "waiting_for_user",
      reason: "Wait node wait-1 requires external completion",
    });
  });
});
