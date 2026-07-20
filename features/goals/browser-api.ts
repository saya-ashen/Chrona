import { apiJson } from "@shared/http";
import type { GoalData } from "./model/goal-types";

export async function runGoalAction(
  goalId: string,
  action: "pause" | "resume" | "stop" | "review" | "achieve",
  confirmation?: string,
) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action === "achieve" ? { action, confirmation } : { action }),
  });
}
