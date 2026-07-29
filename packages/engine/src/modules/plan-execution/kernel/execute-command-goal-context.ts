import type { KernelCallbacksInput } from "./kernel-types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function operationalBrief(value: unknown) {
  const brief = record(value);
  const outcome = optionalText(brief?.outcome);
  const currentFocus = optionalText(brief?.currentFocus);
  const strategy = typeof brief?.strategy === "string" ? brief.strategy : undefined;
  const constraints = Array.isArray(brief?.constraints)
    ? brief.constraints.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  return outcome && currentFocus && strategy !== undefined && constraints
    ? { outcome, currentFocus, strategy, constraints }
    : undefined;
}

function acceptedResults(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const result = record(item);
    if (!result) return [];
    const ref = optionalText(result.ref);
    const taskTitle = optionalText(result.taskTitle);
    const summary = optionalText(result.summary);
    const artifactCount = typeof result.artifactCount === "number" && Number.isFinite(result.artifactCount)
      ? Math.max(0, Math.trunc(result.artifactCount))
      : null;
    if (!ref || !taskTitle || !summary || artifactCount === null) return [];
    return [{
      ref,
      taskTitle,
      ...(typeof result.acceptedAt === "string" || result.acceptedAt === null
        ? { acceptedAt: result.acceptedAt }
        : {}),
      summary,
      artifactCount,
    }];
  });
}

export function frozenGoalContext(value: unknown): KernelCallbacksInput["goalContext"] {
  const context = record(value);
  const goal = record(context?.goal);
  const title = optionalText(goal?.title);
  if (!context || !goal || !title) return undefined;
  const brief = operationalBrief(goal.operationalBrief);
  const additionalContext = optionalText(goal.additionalContext);
  const capturedAt = optionalText(goal.capturedAt);
  return {
    goal: {
      title,
      ...(additionalContext ? { additionalContext } : {}),
      ...(brief ? { operationalBrief: brief } : {}),
      ...(capturedAt ? { capturedAt } : {}),
    },
    acceptedResults: acceptedResults(context.acceptedResults),
  };
}
