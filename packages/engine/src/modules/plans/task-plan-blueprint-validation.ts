import { planBlueprintSchema, type PlanBlueprint } from "@chrona/contracts";
import { validatePlanBlueprint } from "@chrona/domain";

export type TaskPlanBlueprintValidation = {
  ok: boolean;
  issues: Array<{ code: string; path?: string; message: string }>;
};

/**
 * Validates provider output at the engine boundary, then delegates graph semantics
 * to the domain compiler's shared blueprint validation path.
 */
export function validateTaskPlanBlueprint(blueprint: PlanBlueprint): TaskPlanBlueprintValidation {
  const parsed = planBlueprintSchema.safeParse(blueprint);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const validation = validatePlanBlueprint(parsed.data);
  return {
    ok: validation.ok,
    issues: validation.errors.map((issue) => ({
      code: "plan_invalid",
      path: `/${issue.path.replaceAll(".", "/")}`,
      message: issue.message,
    })),
  };
}
