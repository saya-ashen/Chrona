import type { PlanBlueprint, TaskPlanReadModel } from "@chrona/contracts/ai";
import { resolveScopeWorkBlockId } from "@/modules/plan-execution/persistence/execution-scope";
import { requireTaskId, requireWorkspaceId } from "./input-guards";

export type PlanGenerateToolContext = {
  actorId?: string;
  actorType: "agent" | "human" | "system";
  sessionId?: string;
  taskId?: string;
  workspaceId?: string;
};

export type PlanGenerateToolMaterializeInput = {
  taskId: string;
  workspaceId: string;
  workBlockId?: string | null;
  blueprint: PlanBlueprint;
  userInstruction?: string | null;
  generatedBy?: string | null;
};

export type PlanGenerateToolMaterializer = (input: PlanGenerateToolMaterializeInput) => Promise<TaskPlanReadModel>;

export async function executePlanGenerateTool(input: {
  context: PlanGenerateToolContext;
  blueprint: PlanBlueprint;
  materialize: PlanGenerateToolMaterializer;
  workBlockId?: string | null;
  userInstruction?: string | null;
  generatedBy?: string | null;
}) {
  const taskId = requireTaskId(input.context);
  const workspaceId = requireWorkspaceId(input.context);
  const workBlockId = input.workBlockId === undefined
    ? await resolveScopeWorkBlockId(taskId, { sessionId: input.context.sessionId })
    : input.workBlockId;
  const savedPlan = await input.materialize({
    taskId,
    workspaceId,
    workBlockId,
    blueprint: input.blueprint,
    generatedBy: input.generatedBy ?? input.context.actorId ?? "hermes",
    userInstruction: input.userInstruction,
  });
  return {
    taskId,
    savedPlan,
    workBlockId,
  };
}
