import { db } from "@/lib/db";
import { TaskPlanStatus } from "@/generated/prisma/client";
import { startAutoPlanGenerationForTask } from "@/modules/plans/auto-generate-task-plan";
import {
  AUTOMATION_TIMING_PRESETS,
  automationTimingOffsetMs,
  normalizeAutomationTiming,
} from "@chrona/contracts";

const MAX_AUTOMATION_TIMING_OFFSET_MS = Math.max(
  ...AUTOMATION_TIMING_PRESETS.map((preset) => automationTimingOffsetMs(preset)),
);

// createTask runs as a separate API call before applySchedule, so a task can
// briefly exist with no WorkBlock. Wait past this window before treating an
// unscheduled auto-plan task as "run immediately".
const NO_SCHEDULE_GRACE_MS = 60_000;

const PLAN_GENERATION_TASK_STATUSES = ["Draft", "Ready", "Scheduled", "Queued"] as const;
const ACTIVE_PLAN_STATUSES = [TaskPlanStatus.Draft, TaskPlanStatus.Accepted] as const;

export type AutoGenerateScheduledPlanResult = {
  triggered: Array<{ taskId: string; reason: "scheduled" | "no_schedule_fallback" }>;
  skipped: Array<{ taskId: string; reason: string }>;
  now: string;
};

export async function autoGenerateScheduledPlanTasks(input?: {
  now?: Date;
}): Promise<AutoGenerateScheduledPlanResult> {
  const now = input?.now ?? new Date();
  const result: AutoGenerateScheduledPlanResult = {
    triggered: [],
    skipped: [],
    now: now.toISOString(),
  };
  const fired = new Set<string>();

  await runScheduledPass({ now, result, fired });
  await runNoScheduleFallbackPass({ now, result, fired });

  return result;
}

type PassContext = {
  now: Date;
  result: AutoGenerateScheduledPlanResult;
  fired: Set<string>;
};

async function runScheduledPass({ now, result, fired }: PassContext): Promise<void> {
  const windowUpperBound = new Date(now.getTime() + MAX_AUTOMATION_TIMING_OFFSET_MS);
  const dueWorkBlocks = await db.workBlock.findMany({
    where: {
      status: "Scheduled",
      scheduledStartAt: { lte: windowUpperBound },
      task: {
        status: { in: [...PLAN_GENERATION_TASK_STATUSES] },
        autoPlanGeneration: true,
      },
    },
    include: {
      task: {
        select: {
          id: true,
          autoExecute: true,
          autoPlanGenerationTiming: true,
          taskPlans: {
            where: { status: { in: [...ACTIVE_PLAN_STATUSES] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ scheduledStartAt: "asc" }, { task: { priority: "desc" } }],
  });

  for (const block of dueWorkBlocks) {
    const task = block.task;
    if (fired.has(task.id)) continue;
    const timing = normalizeAutomationTiming(task.autoPlanGenerationTiming);

    // `immediate` plans already fired synchronously during create/update.
    if (timing === "immediate") {
      result.skipped.push({ taskId: task.id, reason: "immediate_handled_inline" });
      continue;
    }
    if (task.taskPlans.length > 0) {
      result.skipped.push({ taskId: task.id, reason: "plan_exists" });
      continue;
    }
    if (!block.scheduledStartAt) {
      result.skipped.push({ taskId: task.id, reason: "no_scheduled_start" });
      continue;
    }

    const triggerTime = new Date(block.scheduledStartAt.getTime() - automationTimingOffsetMs(timing));
    if (triggerTime > now) {
      result.skipped.push({ taskId: task.id, reason: "not_due" });
      continue;
    }

    startAutoPlanGenerationForTask({ taskId: task.id, accept: task.autoExecute });
    fired.add(task.id);
    result.triggered.push({ taskId: task.id, reason: "scheduled" });
  }
}

async function runNoScheduleFallbackPass({ now, result, fired }: PassContext): Promise<void> {
  const graceCutoff = new Date(now.getTime() - NO_SCHEDULE_GRACE_MS);
  const unscheduledTasks = await db.task.findMany({
    where: {
      status: { in: [...PLAN_GENERATION_TASK_STATUSES] },
      autoPlanGeneration: true,
      createdAt: { lte: graceCutoff },
      workBlocks: { none: {} },
      taskPlans: { none: { status: { in: [...ACTIVE_PLAN_STATUSES] } } },
    },
    select: {
      id: true,
      autoExecute: true,
      autoPlanGenerationTiming: true,
    },
  });

  for (const task of unscheduledTasks) {
    if (fired.has(task.id)) continue;
    const timing = normalizeAutomationTiming(task.autoPlanGenerationTiming);

    // `immediate` already fired inline; a scheduled timing with no WorkBlock
    // past the grace window means scheduling never arrived, so fall back to
    // running now rather than waiting forever.
    if (timing === "immediate") {
      result.skipped.push({ taskId: task.id, reason: "immediate_handled_inline" });
      continue;
    }

    startAutoPlanGenerationForTask({ taskId: task.id, accept: task.autoExecute });
    fired.add(task.id);
    result.triggered.push({ taskId: task.id, reason: "no_schedule_fallback" });
  }
}
