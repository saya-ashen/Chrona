import { planBlueprintSchema, type PlanBlueprint } from "./ai-plan-blueprint";

export const CHRONA_PLAN_GENERATE_TOOL_NAME = "chrona_plan_generate";
export const CHRONA_PLAN_GENERATE_INTERNAL_TOOL_NAME = "chrona.plan.generate";
export const CHRONA_PLAN_GENERATE_CLAUDE_CODE_TOOL_NAME = "mcp__chrona__chrona_plan_generate";

export const CHRONA_PLAN_GENERATE_TOOL_TITLE = "Chrona Plan Generate";
export const CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION = "Generate a draft plan for the session task from a complete plan blueprint.";

export const planGenerateToolPayloadSchema = planBlueprintSchema;

export type PlanGenerateToolPayload = PlanBlueprint;

export function isChronaPlanGenerateToolName(tool: string | undefined): boolean {
  return tool === CHRONA_PLAN_GENERATE_TOOL_NAME ||
    tool === CHRONA_PLAN_GENERATE_INTERNAL_TOOL_NAME ||
    tool === CHRONA_PLAN_GENERATE_CLAUDE_CODE_TOOL_NAME;
}

export function parsePlanGenerateToolPayload(value: unknown): PlanGenerateToolPayload {
  return planGenerateToolPayloadSchema.parse(value);
}

export function safeParsePlanGenerateToolPayload(value: unknown): PlanGenerateToolPayload | null {
  const parsed = planGenerateToolPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function acceptedPlanGenerateToolResult(): {
  content: Array<{ type: "text"; text: string }>;
  details: { accepted: boolean };
} {
  return {
    content: [{ type: "text", text: "accepted" }],
    details: { accepted: true },
  };
}
