import { afterAll, beforeEach, mock } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import type { CheckpointConfig, CompiledPlan, ConditionConfig, TaskConfig, WaitConfig } from "@chrona/contracts/ai";
import type { NodeAiCapabilityInput } from "./node-ai-capabilities";
import type { NodeExecutionResult } from "./node-executors/types";

type NodeCapabilityMock = (input: NodeAiCapabilityInput) => Promise<NodeExecutionResult>;

export const executeTaskNodeCapabilityMock = mock<NodeCapabilityMock>();
export const reviewCheckpointNodeCapabilityMock = mock<NodeCapabilityMock>();
export const evaluateConditionNodeCapabilityMock = mock<NodeCapabilityMock>();

mock.module("@/modules/plan-execution/node-ai-capabilities", () => ({
  executeTaskNodeCapability: executeTaskNodeCapabilityMock,
  reviewCheckpointNodeCapability: reviewCheckpointNodeCapabilityMock,
  evaluateConditionNodeCapability: evaluateConditionNodeCapabilityMock,
}));

export const { taskPlanExecution } = await import("@/modules/plan-execution");

export function setupPlanRunnerTaskExecutorTest() {
  beforeEach(async () => {
    executeTaskNodeCapabilityMock.mockReset();
    reviewCheckpointNodeCapabilityMock.mockReset();
    evaluateConditionNodeCapabilityMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });
}

export async function resetDb() {
  await db.taskAssistantMessage.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

export async function seedWorkspaceAndTask(title: string) {
  const workspace = await db.workspace.create({
    data: {
      name: `${title} Workspace`,
      status: "Active",
      defaultRuntime: "openclaw",
    },
  });

  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title,
      status: TaskStatus.Ready,
      priority: "Medium",
      executionRuntime: "openclaw",
      executionConfig: {},
    },
  });

  return { workspace, task };
}

export function makeSingleTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Task plan ${editablePlanId}`,
    goal: "Exercise task executor path",
    assumptions: [],
    nodes: [
      {
        id: "task_node",
        localId: "task_node",
        type: "task",
        title: "Execute mocked task node",
        description: "Mocked runtime-backed task executor",
        config: {
          expectedOutput: "Produce runner-side result",
        } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: ["task_node"],
    terminalNodeIds: ["task_node"],
    topologicalOrder: ["task_node"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export function makeManualThenTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Manual task handoff ${editablePlanId}`,
    goal: "Complete manual node, then continue automatic work",
    assumptions: [],
    nodes: [
      {
        id: "manual_task",
        localId: "manual_task",
        type: "condition",
        title: "Manual condition",
        description: "Agent-submitted branch result",
        config: {
          condition: "Choose whether to continue",
          evaluationBy: "user",
          branches: [{ label: "continue", nextNodeId: "auto_task" }],
        } satisfies ConditionConfig,
        dependencies: [],
        dependents: ["auto_task"],
      },
      {
        id: "auto_task",
        localId: "auto_task",
        type: "task",
        title: "Automatic follow-up",
        description: "Should run after terminal result is acknowledged",
        config: { expectedOutput: "Automatic output" } satisfies TaskConfig,
        dependencies: ["manual_task"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_manual_to_auto", from: "manual_task", to: "auto_task" }],
    entryNodeIds: ["manual_task"],
    terminalNodeIds: ["auto_task"],
    topologicalOrder: ["manual_task", "auto_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export function makeFullExecutionPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Full execution plan ${editablePlanId}`,
    goal: "Exercise task, condition, checkpoint, and wait execution end-to-end",
    assumptions: [],
    nodes: [
      {
        id: "prepare_task",
        localId: "prepare_task",
        type: "task",
        title: "Prepare execution context",
        description: "Initial automatic task node",
        config: { expectedOutput: "Preparation complete" } satisfies TaskConfig,
        dependencies: [],
        dependents: ["route_condition"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "route_condition",
        localId: "route_condition",
        type: "condition",
        title: "Choose execution route",
        description: "User selects the approval path",
        config: {
          condition: "Which route should the plan take?",
          evaluationBy: "user",
          branches: [
            { label: "approve", nextNodeId: "approval_checkpoint" },
            { label: "skip", nextNodeId: "skipped_task" },
          ],
        } satisfies ConditionConfig,
        dependencies: ["prepare_task"],
        dependents: ["approval_checkpoint", "skipped_task"],
      },
      {
        id: "approval_checkpoint",
        localId: "approval_checkpoint",
        type: "checkpoint",
        title: "Approve prepared work",
        description: "Human approval before continuing",
        config: {
          checkpointType: "approve",
          prompt: "Approve prepared work",
          required: true,
        } satisfies CheckpointConfig,
        dependencies: ["route_condition"],
        dependents: ["cooldown_wait"],
      },
      {
        id: "cooldown_wait",
        localId: "cooldown_wait",
        type: "wait",
        title: "Wait for external readiness",
        description: "Wait node that completes in the main execution path",
        config: {
          waitFor: "external readiness signal",
          timeout: { minutes: 0, onTimeout: "continue" },
        } satisfies WaitConfig,
        dependencies: ["approval_checkpoint"],
        dependents: ["final_task"],
      },
      {
        id: "final_task",
        localId: "final_task",
        type: "task",
        title: "Finalize execution",
        description: "Final automatic task node",
        config: { expectedOutput: "Final result" } satisfies TaskConfig,
        dependencies: ["cooldown_wait"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "skipped_task",
        localId: "skipped_task",
        type: "task",
        title: "Skipped alternate branch",
        description: "This node should not execute when approval branch is selected",
        config: { expectedOutput: "Should not run" } satisfies TaskConfig,
        dependencies: ["route_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [
      { id: "edge_prepare_to_condition", from: "prepare_task", to: "route_condition" },
      { id: "edge_condition_to_approval", from: "route_condition", to: "approval_checkpoint", label: "approve" },
      { id: "edge_condition_to_skipped", from: "route_condition", to: "skipped_task", label: "skip" },
      { id: "edge_approval_to_wait", from: "approval_checkpoint", to: "cooldown_wait" },
      { id: "edge_wait_to_final", from: "cooldown_wait", to: "final_task" },
    ],
    entryNodeIds: ["prepare_task"],
    terminalNodeIds: ["final_task", "skipped_task"],
    topologicalOrder: [
      "prepare_task",
      "route_condition",
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
      "skipped_task",
    ],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export async function seedAcceptedCompiledPlan(workspaceId: string, taskId: string, compiledPlan: CompiledPlan) {
  await saveCompiledPlan({
    workspaceId,
    taskId,
    compiledPlan,
    status: "accepted",
    prompt: compiledPlan.title,
    summary: compiledPlan.goal,
    generatedBy: "plan-runner-task-executor-test",
  });
}
