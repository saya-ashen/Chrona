import type {
  Conflict,
  ConflictSeverity,
  ScheduledTaskInfo,
} from "@chrona/contracts/ai";

/**
 * 检测时间重叠冲突
 */
export function detectTimeOverlaps(tasks: ScheduledTaskInfo[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const sorted = [...tasks].sort(
    (a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime(),
  );

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const taskA = sorted[i];
      const taskB = sorted[j];

      // 如果 B 的开始时间 >= A 的结束时间，后续任务都不会重叠
      if (taskB.scheduledStartAt >= taskA.scheduledEndAt) {
        break;
      }

      // 检测重叠
      const overlapStart = new Date(
        Math.max(
          taskA.scheduledStartAt.getTime(),
          taskB.scheduledStartAt.getTime(),
        ),
      );
      const overlapEnd = new Date(
        Math.min(taskA.scheduledEndAt.getTime(), taskB.scheduledEndAt.getTime()),
      );

      if (overlapStart < overlapEnd) {
        const overlapMinutes =
          (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
        const severity: ConflictSeverity =
          overlapMinutes >= 60 ? "high" : overlapMinutes >= 30 ? "medium" : "low";

        conflicts.push({
          id: `overlap_${taskA.taskId}_${taskB.taskId}`,
          type: "time_overlap",
          severity,
          taskIds: [taskA.taskId, taskB.taskId],
          description: `"${taskA.title}" and "${taskB.title}" overlap by ${Math.round(overlapMinutes)} minutes`,
          timeRange: {
            start: overlapStart,
            end: overlapEnd,
          },
          metadata: {
            overlapMinutes,
          },
        });
      }
    }
  }

  return conflicts;
}

/**
 * 检测工作量过载冲突
 */
export function detectOverload(tasks: ScheduledTaskInfo[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const MAX_DAILY_MINUTES = 8 * 60; // 8 小时

  // 按日期分组
  const tasksByDay = new Map<string, ScheduledTaskInfo[]>();
  for (const task of tasks) {
    const dayKey = task.scheduledStartAt.toISOString().split("T")[0];
    const dayTasks = tasksByDay.get(dayKey) ?? [];
    dayTasks.push(task);
    tasksByDay.set(dayKey, dayTasks);
  }

  // 检查每天的工作量
  for (const [dayKey, dayTasks] of tasksByDay.entries()) {
    const totalMinutes = dayTasks.reduce(
      (sum, task) => sum + task.estimatedMinutes,
      0,
    );

    if (totalMinutes > MAX_DAILY_MINUTES) {
      const overloadMinutes = totalMinutes - MAX_DAILY_MINUTES;
      const severity: ConflictSeverity =
        overloadMinutes >= 120 ? "high" : overloadMinutes >= 60 ? "medium" : "low";

      conflicts.push({
        id: `overload_${dayKey}`,
        type: "overload",
        severity,
        taskIds: dayTasks.map((t) => t.taskId),
        description: `Workload on ${dayKey} exceeds 8 hours by ${Math.round(overloadMinutes)} minutes`,
        metadata: {
          totalMinutes,
          overloadMinutes,
          dayKey,
        },
      });
    }
  }

  return conflicts;
}

/**
 * 检测碎片化冲突
 */
export function detectFragmentation(tasks: ScheduledTaskInfo[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const FRAGMENTATION_THRESHOLD = 90; // 小于 90 分钟的任务视为碎片

  // 按日期分组
  const tasksByDay = new Map<string, ScheduledTaskInfo[]>();
  for (const task of tasks) {
    const dayKey = task.scheduledStartAt.toISOString().split("T")[0];
    const dayTasks = tasksByDay.get(dayKey) ?? [];
    dayTasks.push(task);
    tasksByDay.set(dayKey, dayTasks);
  }

  // 检查每天的碎片化程度
  for (const [dayKey, dayTasks] of tasksByDay.entries()) {
    const fragmentedTasks = dayTasks.filter(
      (task) => task.estimatedMinutes < FRAGMENTATION_THRESHOLD,
    );
    const fragmentedMinutes = fragmentedTasks.reduce(
      (sum, task) => sum + task.estimatedMinutes,
      0,
    );

    // 如果碎片化时间超过 2 小时，或者碎片任务数量 >= 4，视为冲突
    if (fragmentedMinutes >= 120 || fragmentedTasks.length >= 4) {
      const severity: ConflictSeverity =
        fragmentedTasks.length >= 6 || fragmentedMinutes >= 180
          ? "high"
          : fragmentedTasks.length >= 4 || fragmentedMinutes >= 120
            ? "medium"
            : "low";

      conflicts.push({
        id: `fragmentation_${dayKey}`,
        type: "fragmentation",
        severity,
        taskIds: fragmentedTasks.map((t) => t.taskId),
        description: `${fragmentedTasks.length} fragmented tasks on ${dayKey} (${Math.round(fragmentedMinutes)} minutes total)`,
        metadata: {
          fragmentedMinutes,
          fragmentedTaskCount: fragmentedTasks.length,
          dayKey,
        },
      });
    }
  }

  return conflicts;
}

/**
 * 检测依赖关系冲突
 */
export function detectDependencyConflicts(
  tasks: ScheduledTaskInfo[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  for (const task of tasks) {
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (!depTask) {
        continue; // 依赖任务不在当前列表中
      }

      // 检查依赖任务是否在当前任务之后完成
      if (depTask.scheduledEndAt > task.scheduledStartAt) {
        conflicts.push({
          id: `dependency_${task.taskId}_${depId}`,
          type: "dependency",
          severity: "high",
          taskIds: [task.taskId, depId],
          description: `"${task.title}" depends on "${depTask.title}", but "${depTask.title}" ends after "${task.title}" starts`,
          metadata: {
            dependentTask: task.taskId,
            dependencyTask: depId,
          },
        });
      }
    }
  }

  return conflicts;
}

/**
 * 检测所有冲突
 */
export function detectAllConflicts(tasks: ScheduledTaskInfo[]): Conflict[] {
  return [
    ...detectTimeOverlaps(tasks),
    ...detectOverload(tasks),
    ...detectFragmentation(tasks),
    ...detectDependencyConflicts(tasks),
  ];
}
