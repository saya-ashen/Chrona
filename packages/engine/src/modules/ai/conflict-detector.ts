import type { Conflict, ConflictSeverity, ScheduledTaskInfo } from "@chrona/contracts/ai";

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function severityForMinutes(minutes: number): ConflictSeverity {
  if (minutes >= 60) return "high";
  if (minutes >= 30) return "medium";
  return "low";
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function detectTimeOverlaps(tasks: ScheduledTaskInfo[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const sorted = [...tasks].sort(
    (left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime(),
  );

  for (let index = 0; index < sorted.length; index += 1) {
    for (let next = index + 1; next < sorted.length; next += 1) {
      const left = sorted[index];
      const right = sorted[next];
      const overlapStart = new Date(Math.max(left.scheduledStartAt.getTime(), right.scheduledStartAt.getTime()));
      const overlapEnd = new Date(Math.min(left.scheduledEndAt.getTime(), right.scheduledEndAt.getTime()));
      const overlapMinutes = minutesBetween(overlapStart, overlapEnd);

      if (overlapMinutes <= 0) continue;

      conflicts.push({
        id: `overlap_${left.taskId}_${right.taskId}`,
        type: "time_overlap",
        severity: severityForMinutes(overlapMinutes),
        taskIds: [left.taskId, right.taskId],
        description: `${left.title} overlaps with ${right.title}`,
        timeRange: { start: overlapStart, end: overlapEnd },
        metadata: { overlapMinutes },
      });
    }
  }

  return conflicts;
}

export function detectOverload(tasks: ScheduledTaskInfo[]): Conflict[] {
  const byDay = new Map<string, ScheduledTaskInfo[]>();

  for (const task of tasks) {
    const items = byDay.get(dayKey(task.scheduledStartAt)) ?? [];
    items.push(task);
    byDay.set(dayKey(task.scheduledStartAt), items);
  }

  return Array.from(byDay.entries()).flatMap(([key, items]) => {
    const totalMinutes = items.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const overloadMinutes = totalMinutes - 480;

    if (overloadMinutes <= 0) return [];

    return [{
      id: `overload_${key}`,
      type: "overload" as const,
      severity: overloadMinutes >= 120 ? "high" : "medium",
      taskIds: items.map((task) => task.taskId),
      description: `Schedule exceeds daily capacity by ${overloadMinutes} minutes`,
      metadata: { overloadMinutes },
    }];
  });
}

export function detectFragmentation(tasks: ScheduledTaskInfo[]): Conflict[] {
  const smallTasks = tasks.filter((task) => task.estimatedMinutes <= 30);
  const fragmentedMinutes = smallTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  if (smallTasks.length < 4 || fragmentedMinutes < 120) return [];

  return [{
    id: `fragmentation_${smallTasks.map((task) => task.taskId).join("_")}`,
    type: "fragmentation",
    severity: "medium",
    taskIds: smallTasks.map((task) => task.taskId),
    description: "Schedule is fragmented into many short blocks",
    metadata: { fragmentedMinutes },
  }];
}

export function detectDependencyConflicts(tasks: ScheduledTaskInfo[]): Conflict[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const conflicts: Conflict[] = [];

  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      const dependency = byId.get(dependencyId);
      if (!dependency || dependency.scheduledEndAt <= task.scheduledStartAt) continue;

      conflicts.push({
        id: `dependency_${task.taskId}_${dependencyId}`,
        type: "dependency",
        severity: "high",
        taskIds: [task.taskId, dependencyId],
        description: `${task.title} is scheduled before dependency ${dependency.title} completes`,
      });
    }
  }

  return conflicts;
}
