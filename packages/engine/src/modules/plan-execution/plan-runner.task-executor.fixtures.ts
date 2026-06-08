import { afterAll, beforeEach, mock } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import type { CheckpointConfig, CompiledPlan, ConditionConfig, TaskConfig, WaitConfig } from "@chrona/contracts/ai";
import { runTaskNodeFeature } from "./runtime/node-ai-capabilities";
import type { NodeAiCapabilityInput } from "./runtime/node-ai-capabilities";
import type { NodeExecutionResult } from "./node-executors/types";

type NodeCapabilityMock = (input: NodeAiCapabilityInput) => Promise<NodeExecutionResult>;

export const executeTaskNodeCapabilityMock = mock<NodeCapabilityMock>();
export const reviewCheckpointNodeCapabilityMock = mock<NodeCapabilityMock>();
export const evaluateConditionNodeCapabilityMock = mock<NodeCapabilityMock>();

mock.module("@/modules/plan-execution/runtime/node-ai-capabilities", () => ({
  executeTaskNodeCapability: executeTaskNodeCapabilityMock,
  reviewCheckpointNodeCapability: reviewCheckpointNodeCapabilityMock,
  evaluateConditionNodeCapability: evaluateConditionNodeCapabilityMock,
  runTaskNodeFeature,
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
  await db.toolInvocation.deleteMany();
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
      defaultRuntime: "hermes",
    },
  });

  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title,
      status: TaskStatus.Ready,
      priority: "Medium",
      executionRuntime: "hermes",
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

export function makeTwoTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Two task plan ${editablePlanId}`,
    goal: "Complete one runtime-backed task, then continue to the next runtime-backed task",
    assumptions: [],
    nodes: [
      {
        id: "first_task",
        localId: "first_task",
        type: "task",
        title: "Collect script requirements",
        description: "First runtime-backed task executor",
        config: { expectedOutput: "Requirements collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: ["second_task"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "second_task",
        localId: "second_task",
        type: "task",
        title: "Finalize script specification",
        description: "Should run after the first provider run completes",
        config: { expectedOutput: "Executable script specification" } satisfies TaskConfig,
        dependencies: ["first_task"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_first_to_second", from: "first_task", to: "second_task" }],
    entryNodeIds: ["first_task"],
    terminalNodeIds: ["second_task"],
    topologicalOrder: ["first_task", "second_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export function makeTwoEntryTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Two entry task plan ${editablePlanId}`,
    goal: "Run two independent runtime-backed entry tasks",
    assumptions: [],
    nodes: [
      {
        id: "first_entry",
        localId: "first_entry",
        type: "task",
        title: "Collect architecture facts",
        description: "First independent runtime-backed task executor",
        config: { expectedOutput: "Architecture facts collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "second_entry",
        localId: "second_entry",
        type: "task",
        title: "Collect documentation facts",
        description: "Second independent runtime-backed task executor",
        config: { expectedOutput: "Documentation facts collected" } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: ["first_entry", "second_entry"],
    terminalNodeIds: ["first_entry", "second_entry"],
    topologicalOrder: ["first_entry", "second_entry"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export function makeIndependentBranchesAfterManualPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Independent branch plan ${editablePlanId}`,
    goal: "Complete a manual gate, then run two independent provider-backed branches serially",
    assumptions: [],
    nodes: [
      {
        id: "manual_gate",
        localId: "manual_gate",
        type: "condition",
        title: "Manual branch gate",
        description: "Agent-submitted branch result unlocks independent branches",
        config: {
          condition: "Continue to independent branches",
          evaluationBy: "user",
          branches: [{ label: "continue", nextNodeId: "left_task" }],
        } satisfies ConditionConfig,
        dependencies: [],
        dependents: ["left_task", "right_task"],
      },
      {
        id: "left_task",
        localId: "left_task",
        type: "task",
        title: "Left provider branch",
        description: "First independent provider-backed task",
        config: { expectedOutput: "Left branch output" } satisfies TaskConfig,
        dependencies: ["manual_gate"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "right_task",
        localId: "right_task",
        type: "task",
        title: "Right provider branch",
        description: "Second independent provider-backed task",
        config: { expectedOutput: "Right branch output" } satisfies TaskConfig,
        dependencies: ["manual_gate"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [
      { id: "edge_gate_to_left", from: "manual_gate", to: "left_task" },
      { id: "edge_gate_to_right", from: "manual_gate", to: "right_task" },
    ],
    entryNodeIds: ["manual_gate"],
    terminalNodeIds: ["left_task", "right_task"],
    topologicalOrder: ["manual_gate", "left_task", "right_task"],
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

export function makeInputCheckpointThenTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Input checkpoint handoff ${editablePlanId}`,
    goal: "Complete input checkpoint, then continue automatic work",
    assumptions: [],
    nodes: [
      {
        id: "requirements_checkpoint",
        localId: "requirements_checkpoint",
        type: "checkpoint",
        title: "Confirm requirements",
        description: "Collect required user input before task execution",
        config: {
          checkpointType: "input",
          prompt: "Confirm script requirements",
          required: true,
          inputFields: [
            { name: "location_scope", label: "Location scope", type: "text", required: true },
            { name: "output_format", label: "Output format", type: "text", required: true },
          ],
        } satisfies CheckpointConfig,
        dependencies: [],
        dependents: ["spec_task"],
      },
      {
        id: "spec_task",
        localId: "spec_task",
        type: "task",
        title: "Finalize script specification",
        description: "Should run after checkpoint input is submitted",
        config: {
          expectedOutput: "Executable script specification",
          completionCriteria: "Scope, input, output, and constraints are documented",
        } satisfies TaskConfig,
        dependencies: ["requirements_checkpoint"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_checkpoint_to_spec", from: "requirements_checkpoint", to: "spec_task" }],
    entryNodeIds: ["requirements_checkpoint"],
    terminalNodeIds: ["spec_task"],
    topologicalOrder: ["requirements_checkpoint", "spec_task"],
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
