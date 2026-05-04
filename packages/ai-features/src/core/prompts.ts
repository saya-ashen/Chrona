/**
 * AI Client — System prompts for each feature.
 */

import type { AiFeature } from "./types";
import {
  CONFLICTS_SYSTEM_PROMPT,
  DISPATCH_TASK_SYSTEM_PROMPT,
  GENERATE_PLAN_SYSTEM_PROMPT,
  SUGGEST_SYSTEM_PROMPT,
  TIMESLOTS_SYSTEM_PROMPT,
} from "@chrona/contracts";

export const SYSTEM_PROMPTS: Record<AiFeature, string> = {
  suggest: SUGGEST_SYSTEM_PROMPT,

  generate_plan: GENERATE_PLAN_SYSTEM_PROMPT,

  conflicts: CONFLICTS_SYSTEM_PROMPT,

  timeslots: TIMESLOTS_SYSTEM_PROMPT,

  chat: `You are a helpful scheduling assistant with access to the user's task and schedule data.
Respond in the same language as the user.`,

  dispatch_task: DISPATCH_TASK_SYSTEM_PROMPT,
};
