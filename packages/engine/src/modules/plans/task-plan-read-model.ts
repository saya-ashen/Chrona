/* eslint-disable complexity -- Plan read projection explicitly handles all durable generation states. */
import type {
  CheckpointConfig,
  CompiledPlan,
  ConditionConfig,
  EditablePlan,
  EffectivePlanGraph,
  PlanBlueprint,
  PlanBlueprintCheckpointNode,
  PlanBlueprintConditionNode,
  PlanBlueprintNode,
  PlanBlueprintTaskNode,
  PlanBlueprintWaitNode,
  TaskConfig,
  TaskPlanReadModel,
  WaitConfig,
  CheckpointType,
  ConditionEvaluator,
  WaitTimeoutAction,
} from "@chrona/contracts";
import { projectPublicEffectivePlanGraph } from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { getAcceptedCompiledPlan, getLatestCompiledPlan, type SavedCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { resolveScopeWorkBlockId } from "@/modules/plan-execution/persistence/execution-scope";
import { createPlanGraphFromCompiledPlan, getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import { db } from "@/lib/db";

/**
 * Builds the canonical frontend-facing read model from persisted plan data.
 * Reused by both fresh generation result and plan-state queries.
 */
export function buildTaskPlanReadModel(input: {
  compiledPlan: CompiledPlan;
  effectivePlanGraph: EffectivePlanGraph;
  blueprint: PlanBlueprint;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
  updatedAt: string;
}): TaskPlanReadModel {
  return {
    id: input.compiledPlan.editablePlanId,
    status: input.status,
    revision: input.compiledPlan.sourceVersion,
    prompt: input.prompt,
    summary: input.summary,
    updatedAt: input.updatedAt,
    generatedBy: publicGeneratedBy(input.generatedBy),
    blueprint: input.blueprint,
    compiledPlan: input.compiledPlan,
    effectivePlan: projectPublicEffectivePlanGraph(input.effectivePlanGraph),
  };
}

function publicGeneratedBy(generatedBy: string | null) {
  if (!generatedBy) return null;
  return generatedBy === "user" ? "User" : "AI";
}

function editablePlanToBlueprint(editablePlan: EditablePlan): PlanBlueprint {
  return {
    title: editablePlan.title,
    goal: editablePlan.goal,
    assumptions: editablePlan.assumptions,
    nodes: editablePlan.nodes.map((node) => {
      switch (node.type) {
        case "task":
          return {
            id: node.id,
            type: "task",
            title: node.title,
            executor: node.executor,
            mode: node.mode,
            expectedOutput: node.expectedOutput,
            completionCriteria: node.completionCriteria,
            userInteraction: node.userInteraction,
            estimatedMinutes: node.estimatedMinutes,
          };
        case "checkpoint":
          return {
            id: node.id,
            type: "checkpoint",
            title: node.title,
            checkpointType: node.checkpointType,
            prompt: node.prompt,
            required: node.required,
            options: node.options,
            inputFields: node.inputFields?.map((field) => ({
              key: field.name,
              label: field.label,
              inputType: field.type ?? "text",
              required: field.required,
              options: field.options,
            })),
            interaction: node.interaction,
          };
        case "condition":
          return {
            id: node.id,
            type: "condition",
            title: node.title,
            condition: node.condition,
            evaluationBy: node.evaluationBy,
            branches: node.branches,
            defaultNextNodeId: node.defaultNextNodeId,
          };
        case "wait":
          return {
            id: node.id,
            type: "wait",
            title: node.title,
            waitFor: node.waitFor,
            estimatedMinutes: node.estimatedMinutes,
            timeout: node.timeout,
          };
      }
    }),
    edges: editablePlan.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
    })),
  };
}

function compiledPlanToBlueprint(compiledPlan: CompiledPlan): PlanBlueprint {
  const nodes: PlanBlueprintNode[] = compiledPlan.nodes.map((node) => {
    switch (node.type) {
      case "task": {
        const config = node.config as TaskConfig;
        return {
          id: node.id,
          type: "task",
          title: node.title,
          executor: node.executor,
          mode: node.mode,
          expectedOutput:
            typeof config.expectedOutput === "string"
              ? config.expectedOutput
              : undefined,
          completionCriteria:
            typeof config.completionCriteria === "string"
              ? config.completionCriteria
              : undefined,
          userInteraction: config.userInteraction ?? { level: "not_expected" },
          estimatedMinutes: node.estimatedMinutes,
        } satisfies PlanBlueprintTaskNode;
      }
      case "checkpoint": {
        const config = node.config as CheckpointConfig;
        return {
          id: node.id,
          type: "checkpoint",
          title: node.title,
          checkpointType: config.checkpointType as CheckpointType,
          prompt: config.prompt,
          required: config.required,
          options: config.options,
          inputFields: config.inputFields?.map((field) => ({
            key: field.name,
            label: field.label,
            inputType: (field.type ?? "text") as NonNullable<
              PlanBlueprintCheckpointNode["inputFields"]
            >[number]["inputType"],
            required: field.required,
            options: field.options,
          })),
          interaction: config.interaction,
        } satisfies PlanBlueprintCheckpointNode;
      }
      case "condition": {
        const config = node.config as ConditionConfig;
        return {
          id: node.id,
          type: "condition",
          title: node.title,
          condition: config.condition,
          evaluationBy: config.evaluationBy as ConditionEvaluator,
          branches: config.branches,
          defaultNextNodeId: config.defaultNextNodeId,
        } satisfies PlanBlueprintConditionNode;
      }
      case "wait": {
        const config = node.config as WaitConfig;
        return {
          id: node.id,
          type: "wait",
          title: node.title,
          waitFor: config.waitFor,
          estimatedMinutes: node.estimatedMinutes,
          timeout: config.timeout
            ? {
                minutes: config.timeout.minutes,
                onTimeout: config.timeout.onTimeout as WaitTimeoutAction,
              }
            : undefined,
        } satisfies PlanBlueprintWaitNode;
      }
    }
  });

  return {
    title: compiledPlan.title,
    goal: compiledPlan.goal,
    assumptions: compiledPlan.assumptions,
    nodes,
    edges: compiledPlan.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
    })),
  };
}

export async function resolveSavedPlanEffectiveGraph(
  savedPlan: SavedCompiledPlan,
): Promise<EffectivePlanGraph> {
  const persistedRun = await getPlanRun(
    savedPlan.taskId,
    savedPlan.compiledPlan.editablePlanId,
    savedPlan.workBlockId,
  );

  if (persistedRun?.graph) {
    return resolveEffectivePlanGraph({
      graph: persistedRun.graph,
      attempts: persistedRun.attempts,
      results: persistedRun.results,
      resolvedAt: savedPlan.updatedAt,
    });
  }

  return resolveEffectivePlanGraph({
    graph: createPlanGraphFromCompiledPlan({
      taskId: savedPlan.taskId,
      compiledPlan: savedPlan.compiledPlan,
    }),
    resolvedAt: savedPlan.updatedAt,
  });
}

async function buildSavedTaskPlanReadModel(
  savedPlan: SavedCompiledPlan,
): Promise<TaskPlanReadModel> {
  const effectivePlanGraph = await resolveSavedPlanEffectiveGraph(savedPlan);

  return buildTaskPlanReadModel({
    compiledPlan: savedPlan.compiledPlan,
    effectivePlanGraph,
    blueprint: savedPlan.editablePlan
      ? editablePlanToBlueprint(savedPlan.editablePlan)
      : compiledPlanToBlueprint(savedPlan.compiledPlan),
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    summary: savedPlan.summary,
    generatedBy: savedPlan.generatedBy,
    updatedAt: savedPlan.updatedAt,
  });
}

export async function getLatestTaskPlanReadModel(
  taskId: string,
  workBlockId?: string | null,
): Promise<TaskPlanReadModel | null> {
  const scopedWorkBlockId = await resolveScopeWorkBlockId(taskId, { workBlockId });
  const head = await db.taskPlanGenerationHead.findUnique({
    where: {
      taskId_workBlockScopeKey: {
        taskId,
        workBlockScopeKey: scopedWorkBlockId ?? "",
      },
    },
    include: { currentPlan: true },
  });
  if (head) {
    if (!head.currentPlan) return null;
    return buildSavedTaskPlanReadModel({
      recordId: head.currentPlan.id,
      workspaceId: head.currentPlan.workspaceId,
      taskId: head.currentPlan.taskId,
      workBlockId: head.currentPlan.workBlockId,
      compiledPlan: head.currentPlan.compiledPlan as unknown as CompiledPlan,
      editablePlan: (head.currentPlan.editablePlan as unknown as EditablePlan | null) ?? null,
      status: head.currentPlan.status === "Accepted" ? "accepted" : head.currentPlan.status === "Draft" ? "draft" : head.currentPlan.status === "Superseded" ? "superseded" : "archived",
      prompt: head.currentPlan.prompt,
      summary: head.currentPlan.summary,
      generatedBy: head.currentPlan.generatedBy,
      changeSummary: null,
      createdAt: head.currentPlan.createdAt.toISOString(),
      updatedAt: head.currentPlan.updatedAt.toISOString(),
    });
  }

  const savedPlan =
    (await getAcceptedCompiledPlan(taskId, scopedWorkBlockId))
    ?? (await getLatestCompiledPlan(taskId, scopedWorkBlockId))
    ?? (scopedWorkBlockId ? (await getAcceptedCompiledPlan(taskId, null)) : null)
    ?? (scopedWorkBlockId ? (await getLatestCompiledPlan(taskId, null)) : null);
  return savedPlan ? buildSavedTaskPlanReadModel(savedPlan) : null;
}
