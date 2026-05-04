import type {
  Conflict,
  ScheduledTaskInfo,
  Suggestion,
  TaskChange,
} from "@chrona/contracts/ai";

/**
 * 为时间重叠冲突生成建议
 */
function generateOverlapSuggestions(
  conflict: Conflict,
  tasks: ScheduledTaskInfo[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  if (conflict.taskIds.length !== 2) {
    return suggestions;
  }

  const [taskAId, taskBId] = conflict.taskIds;
  const taskA = taskMap.get(taskAId);
  const taskB = taskMap.get(taskBId);

  if (!taskA || !taskB) {
    return suggestions;
  }

  // 策略 1: 延后低优先级任务
  const priorityOrder = { Low: 0, Medium: 1, High: 2, Urgent: 3 };
  const priorityA = priorityOrder[taskA.priority as keyof typeof priorityOrder] ?? 0;
  const priorityB = priorityOrder[taskB.priority as keyof typeof priorityOrder] ?? 0;

  const lowerPriorityTask = priorityA < priorityB ? taskA : taskB;
  const higherPriorityTask = priorityA < priorityB ? taskB : taskA;

  // 将低优先级任务移到高优先级任务之后
  const newStartAt = new Date(higherPriorityTask.scheduledEndAt);
  const newEndAt = new Date(
    newStartAt.getTime() + lowerPriorityTask.estimatedMinutes * 60000,
  );

  suggestions.push({
    id: `sugg_reschedule_${conflict.id}`,
    conflictId: conflict.id,
    type: "reschedule",
    description: `Move "${lowerPriorityTask.title}" to ${newStartAt.toLocaleTimeString()} - ${newEndAt.toLocaleTimeString()}`,
    reason: `"${lowerPriorityTask.title}" has lower priority than "${higherPriorityTask.title}"`,
    affectedTaskIds: [lowerPriorityTask.taskId],
    changes: [
      {
        taskId: lowerPriorityTask.taskId,
        scheduledStartAt: newStartAt,
        scheduledEndAt: newEndAt,
      },
    ],
    estimatedImpact: {
      resolvedConflicts: 1,
      movedTasks: 1,
      timeShiftMinutes: Math.round(
        (newStartAt.getTime() - lowerPriorityTask.scheduledStartAt.getTime()) /
          60000,
      ),
    },
  });

  return suggestions;
}

/**
 * 为工作量过载冲突生成建议
 */
function generateOverloadSuggestions(
  conflict: Conflict,
  tasks: ScheduledTaskInfo[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  const dayTasks = conflict.taskIds
    .map((id) => taskMap.get(id))
    .filter((t): t is ScheduledTaskInfo => t !== undefined);

  if (dayTasks.length === 0) {
    return suggestions;
  }

  // 策略 1: 延后低优先级任务到第二天
  const priorityOrder = { Low: 0, Medium: 1, High: 2, Urgent: 3 };
  const sortedByPriority = [...dayTasks].sort((a, b) => {
    const priorityA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 0;
    const priorityB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 0;
    return priorityA - priorityB;
  });

  const overloadMinutes = (conflict.metadata?.overloadMinutes as number) ?? 0;
  let accumulatedMinutes = 0;
  const tasksToDefer: ScheduledTaskInfo[] = [];

  // 选择足够的低优先级任务来解决过载
  for (const task of sortedByPriority) {
    if (accumulatedMinutes >= overloadMinutes) {
      break;
    }
    tasksToDefer.push(task);
    accumulatedMinutes += task.estimatedMinutes;
  }

  if (tasksToDefer.length > 0) {
    const changes: TaskChange[] = tasksToDefer.map((task) => {
      const nextDay = new Date(task.scheduledStartAt);
      nextDay.setDate(nextDay.getDate() + 1);
      const newEndAt = new Date(
        nextDay.getTime() + task.estimatedMinutes * 60000,
      );

      return {
        taskId: task.taskId,
        scheduledStartAt: nextDay,
        scheduledEndAt: newEndAt,
      };
    });

    suggestions.push({
      id: `sugg_defer_${conflict.id}`,
      conflictId: conflict.id,
      type: "defer",
      description: `Defer ${tasksToDefer.length} low-priority task(s) to the next day`,
      reason: `Workload exceeds 8 hours by ${Math.round(overloadMinutes)} minutes`,
      affectedTaskIds: tasksToDefer.map((t) => t.taskId),
      changes,
      estimatedImpact: {
        resolvedConflicts: 1,
        movedTasks: tasksToDefer.length,
        timeShiftMinutes: 24 * 60, // 延后一天
      },
    });
  }

  return suggestions;
}

/**
 * 为碎片化冲突生成建议
 */
function generateFragmentationSuggestions(
  conflict: Conflict,
  tasks: ScheduledTaskInfo[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  const fragmentedTasks = conflict.taskIds
    .map((id) => taskMap.get(id))
    .filter((t): t is ScheduledTaskInfo => t !== undefined);

  if (fragmentedTasks.length < 2) {
    return suggestions;
  }

  // 策略 1: 合并相邻的碎片任务
  const sorted = [...fragmentedTasks].sort(
    (a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime(),
  );

  const changes: TaskChange[] = [];
  let currentStart = sorted[0].scheduledStartAt;

  for (let i = 0; i < sorted.length; i++) {
    const task = sorted[i];
    const newEndAt = new Date(
      currentStart.getTime() + task.estimatedMinutes * 60000,
    );

    changes.push({
      taskId: task.taskId,
      scheduledStartAt: new Date(currentStart),
      scheduledEndAt: newEndAt,
    });

    currentStart = newEndAt;
  }

  suggestions.push({
    id: `sugg_merge_${conflict.id}`,
    conflictId: conflict.id,
    type: "merge",
    description: `Merge ${fragmentedTasks.length} fragmented tasks into a continuous block`,
    reason: `Reduce context switching and improve focus`,
    affectedTaskIds: fragmentedTasks.map((t) => t.taskId),
    changes,
    estimatedImpact: {
      resolvedConflicts: 1,
      movedTasks: fragmentedTasks.length,
      timeShiftMinutes: 0, // 不改变总时长
    },
  });

  return suggestions;
}

/**
 * 为依赖关系冲突生成建议
 */
function generateDependencySuggestions(
  conflict: Conflict,
  tasks: ScheduledTaskInfo[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  if (conflict.taskIds.length !== 2) {
    return suggestions;
  }

  const dependentTaskId = conflict.metadata?.dependentTask as string;
  const dependencyTaskId = conflict.metadata?.dependencyTask as string;

  const dependentTask = taskMap.get(dependentTaskId);
  const dependencyTask = taskMap.get(dependencyTaskId);

  if (!dependentTask || !dependencyTask) {
    return suggestions;
  }

  // 策略 1: 将依赖任务移到依赖项之后
  const newStartAt = new Date(dependencyTask.scheduledEndAt);
  const newEndAt = new Date(
    newStartAt.getTime() + dependentTask.estimatedMinutes * 60000,
  );

  suggestions.push({
    id: `sugg_reorder_${conflict.id}`,
    conflictId: conflict.id,
    type: "reorder",
    description: `Move "${dependentTask.title}" to start after "${dependencyTask.title}" completes`,
    reason: `"${dependentTask.title}" depends on "${dependencyTask.title}"`,
    affectedTaskIds: [dependentTask.taskId],
    changes: [
      {
        taskId: dependentTask.taskId,
        scheduledStartAt: newStartAt,
        scheduledEndAt: newEndAt,
      },
    ],
    estimatedImpact: {
      resolvedConflicts: 1,
      movedTasks: 1,
      timeShiftMinutes: Math.round(
        (newStartAt.getTime() - dependentTask.scheduledStartAt.getTime()) /
          60000,
      ),
    },
  });

  return suggestions;
}

/**
 * 为所有冲突生成建议
 */
export function generateSuggestions(
  conflicts: Conflict[],
  tasks: ScheduledTaskInfo[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const conflict of conflicts) {
    switch (conflict.type) {
      case "time_overlap":
        suggestions.push(...generateOverlapSuggestions(conflict, tasks));
        break;
      case "overload":
        suggestions.push(...generateOverloadSuggestions(conflict, tasks));
        break;
      case "fragmentation":
        suggestions.push(...generateFragmentationSuggestions(conflict, tasks));
        break;
      case "dependency":
        suggestions.push(...generateDependencySuggestions(conflict, tasks));
        break;
    }
  }

  return suggestions;
}
