/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Provider plan output is validated defensively beyond its static transport type. */

import { z } from "zod";
import {
  aiFeatureSubjectSchema,
  createAiJsonObjectSchema,
  type AiJsonObject,
  type AiObservationEnvelope,
  type CompletionValidation,
  planBlueprintSchema,
  type PlanBlueprint,
} from "@chrona/contracts";
import { defineAiFeature, stableJsonHash } from "@/modules/ai";
import { commitTaskPlanGeneration } from "../task-plan-generation-persistence";
import { validateTaskPlanBlueprint } from "../task-plan-blueprint-validation";

const frozenGoalAssetSchema = z.object({
  ref: z.string().regex(/^GA[0-9A-F]{12}$/),
  title: z.string().max(160),
  description: z.string().max(400),
  kind: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(128),
  version: z.number().int().min(1).max(1_000_000),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
const frozenGoalAcceptedResultSchema = z.object({
  ref: z.string().regex(/^GR[0-9A-F]{12}$/),
  taskTitle: z.string().max(512),
  acceptedAt: z.string().datetime({ offset: true }).nullable(),
  summary: z.string().max(400),
  artifactCount: z.number().int().min(0).max(1_000),
}).strict();
const frozenGoalTaskContextSchema = z.object({
  assets: z.array(frozenGoalAssetSchema).max(64),
  acceptedResults: z.array(frozenGoalAcceptedResultSchema).max(8),
}).strict();
const taskSnapshotSchema = createAiJsonObjectSchema({
  id: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(512),
  description: z.string().trim().max(4_000).nullable(),
  goalContext: frozenGoalTaskContextSchema.nullable(),
  workBlockId: z.string().min(1).max(128).nullable(),
  estimatedMinutes: z.number().int().positive().nullable(),
  executionRuntime: z.string().trim().min(1).max(128),
});

const headSnapshotSchema = createAiJsonObjectSchema({
  stateVersion: z.number().int().nonnegative(),
  currentPlanId: z.string().nullable(),
  currentPlanRevision: z.number().int().nonnegative().nullable(),
  currentPlanStatus: z.string().nullable(),
  currentPlanContentHash: z.string().nullable(),
  baselinePlanId: z.string().nullable(),
  baselinePlanRevision: z.number().int().nonnegative().nullable(),
  baselinePlanStatus: z.string().nullable(),
  baselinePlanContentHash: z.string().nullable(),
  baselineHash: z.string().nullable(),
});

export const taskPlanGenerateInputSchema = createAiJsonObjectSchema({
  task: taskSnapshotSchema,
  currentHead: headSnapshotSchema,
  userInstruction: z.string().trim().max(4_000).nullable(),
  selectedNodeId: z.string().trim().min(1).max(128).nullable(),
});

export const taskPlanGenerateOutputSchema = createAiJsonObjectSchema({
  blueprint: planBlueprintSchema,
});

export type TaskPlanGenerateInput = z.infer<typeof taskPlanGenerateInputSchema>;
export type TaskPlanGenerateOutput = z.infer<typeof taskPlanGenerateOutputSchema>;

export const TASK_PLAN_GENERATE_FEATURE = { id: "task.plan.generate", version: 1 } as const;
export const TASK_PLAN_GENERATE_PROPOSE_ACTION = { id: "task.plan.blueprint.propose", version: 1 } as const;

function envelope(input: {
  observationId: string;
  type: { id: string; version: number };
  key: string;
  revision: string;
  data: AiJsonObject;
}): AiObservationEnvelope {
  return {
    ...input,
    observedAt: new Date().toISOString(),
    canonicalizerId: "chrona.stable-json.v1",
    hashAlgorithm: "sha256",
    contentHash: stableJsonHash(input.data),
  };
}

/**
 * The plan domain owns this feature contract. Its only action is a proposal;
 * its completion hook atomically commits the validated proposal and feature run.
 */
export const taskPlanGenerateFeature = defineAiFeature({
  manifest: {
    schemaVersion: 1,
    feature: TASK_PLAN_GENERATE_FEATURE,
    description: "Generate one structurally valid task-plan blueprint from frozen task and plan-head observations.",
    input: { id: "task.plan.generate.input", version: 1 },
    observations: [
      { observation: { id: "task.plan.generate.task", version: 1 }, delivery: { kind: "seed" }, required: true, maxBytes: 512 * 1024 },
      { observation: { id: "task.plan.generate.current-head", version: 1 }, delivery: { kind: "seed" }, required: true, maxBytes: 128 * 1024 },
    ],
    actions: [{ action: TASK_PLAN_GENERATE_PROPOSE_ACTION, mode: "propose", maxCalls: 1 }],
    artifacts: [],
    output: { id: "task.plan.generate.output", version: 1 },
    completion: { id: "task.plan.generate.completion", version: 1 },
    supportedTerminalStatuses: ["completed"],
  },
  providerBindingFeature: "task.plan",
  inputSchema: taskPlanGenerateInputSchema,
  outputSchema: taskPlanGenerateOutputSchema,
  subjectSchema: aiFeatureSubjectSchema,
  resolveSubject: ({ subject }) => subject,
  buildObjective: (input) => {
    const featureInput = taskPlanGenerateInputSchema.parse(input);
    return {
      statement: `Produce a task plan for ${featureInput.task.title}.`,
      expectedOutcome: "One structurally valid PlanBlueprint proposal.",
      successCriteria: ["Return exactly one proposal containing a structurally valid PlanBlueprint."],
      constraints: ["Use only frozen task and current-head observations."],
    };
  },
  buildInstructions: ({ input, objective, observations }) => {
    taskPlanGenerateInputSchema.parse(input);
    return [
      objective.statement,
      "Use only the frozen observations below.",
      "Return a completed terminal result whose output is { blueprint }, and exactly one task.plan.blueprint.propose action whose input is exactly { blueprint } with no taskId, expectedStateVersion, or other fields.",
      "Every node must be reachable from an entry node; use only task, checkpoint, condition, or wait nodes with their required configuration.",
      JSON.stringify(observations),
    ].join("\n");
  },
  observations: [
    {
      binding: { observation: { id: "task.plan.generate.task", version: 1 } },
      build: ({ input }) => {
        const featureInput = taskPlanGenerateInputSchema.parse(input);
        return envelope({
          observationId: "task-plan-task",
          type: { id: "task.plan.generate.task", version: 1 },
          key: featureInput.task.id,
          revision: stableJsonHash(featureInput.task),
          data: featureInput.task,
        });
      },
    },
    {
      binding: { observation: { id: "task.plan.generate.current-head", version: 1 } },
      build: ({ input }) => {
        const featureInput = taskPlanGenerateInputSchema.parse(input);
        return envelope({
          observationId: "task-plan-current-head",
          type: { id: "task.plan.generate.current-head", version: 1 },
          key: featureInput.task.id,
          revision: String(featureInput.currentHead.stateVersion),
          data: featureInput.currentHead,
        });
      },
    },
  ],
  actions: [{
    binding: { action: TASK_PLAN_GENERATE_PROPOSE_ACTION, mode: "propose", maxCalls: 1 },
    inputSchema: createAiJsonObjectSchema({ blueprint: planBlueprintSchema }),
  }],
  validateCompletion: ({ input, result, observations }): CompletionValidation => {
    const featureInput = taskPlanGenerateInputSchema.safeParse(input);
    const validation = validateTaskPlanBlueprint(result.output.blueprint);
    const proposal = result.proposedActions[0];
    const actionValid = result.proposedActions.length === 1
      && proposal?.action.id === TASK_PLAN_GENERATE_PROPOSE_ACTION.id
      && proposal.action.version === TASK_PLAN_GENERATE_PROPOSE_ACTION.version
      && stableJsonHash(proposal.input) === stableJsonHash({ blueprint: result.output.blueprint });
    return {
      valid: featureInput.success && validation.ok && actionValid && observations.length === 2,
      validator: { id: "task.plan.generate.structural-validator", version: 1 },
      issues: [
        ...(featureInput.success ? [] : [{ code: "input_invalid", path: "/input", message: "Generation requires a valid frozen task-plan input." }]),
        ...validation.issues,
        ...(actionValid ? [] : [{ code: "proposal_invalid", path: "/proposedActions", message: "Generation must return exactly one matching plan proposal." }]),
      ],
    };
  },
  commitResult: async (context) => {
    if (context.terminal.result.status !== "completed" || !context.terminal.completion) {
      return undefined;
    }
    const featureInput = taskPlanGenerateInputSchema.parse(context.input);
    const commit = await commitTaskPlanGeneration({
      candidate: {
        runId: context.runId,
        expectedRunStateVersion: context.expectedStateVersion,
        leaseOwner: context.leaseOwner,
        finishedAt: context.terminal.finishedAt,
        terminalResult: context.terminal.result,
        completion: context.terminal.completion,
        proposedActions: context.terminal.proposedActions,
        snapshot: {
          task: { ...featureInput.task, workspaceId: context.workspaceId, executionRuntime: "ai" },
          head: featureInput.currentHead,
          workBlockId: featureInput.task.workBlockId,
        },
        userInstruction: featureInput.userInstruction,
        selectedNodeId: featureInput.selectedNodeId,
        blueprint: context.terminal.result.output.blueprint,
      },
      generatedBy: "ai",
    });
    return {
      commitReference: {
        planId: commit.planId,
        revision: commit.revision,
        headStateVersion: commit.headStateVersion,
      },
    };
  },
});


export function taskPlanGenerateCandidate(blueprint: PlanBlueprint, observations: readonly AiObservationEnvelope[]) {
  return {
    status: "completed" as const,
    output: { blueprint },
    artifacts: [],
    proposedActions: [{
      proposalId: "task-plan-proposal",
      action: TASK_PLAN_GENERATE_PROPOSE_ACTION,
      input: { blueprint },
      rationale: "Generated task plan blueprint.",
      evidence: observations.map(({ observationId }) => ({ observationId })),
    }],
    evidence: observations.map(({ observationId }) => ({ observationId })),
  };
}
