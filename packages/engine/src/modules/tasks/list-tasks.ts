import { db } from "@/lib/db";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import {
  TASK_FILTER_STATUS_MAP,
  type TaskListFilter,
  type TaskListSortField,
} from "@chrona/contracts/api";

export type ListTasksInput = {
  workspaceId: string;
  status?: string;
  filter?: TaskListFilter;
  priority?: string;
  search?: string;
  sort?: TaskListSortField;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORT_FIELDS: Record<TaskListSortField, true> = {
  updatedAt: true,
  createdAt: true,
  dueAt: true,
  title: true,
};

function resolveStatusFilter(input: ListTasksInput): TaskStatus[] | undefined {
  // An explicit status always wins over the semantic filter tab.
  if (input.status) return [input.status as TaskStatus];
  if (!input.filter || input.filter === "all") return undefined;
  return [...TASK_FILTER_STATUS_MAP[input.filter]] as TaskStatus[];
}

function buildWhere(input: ListTasksInput): Prisma.TaskWhereInput {
  const statuses = resolveStatusFilter(input);
  const where: Prisma.TaskWhereInput = { workspaceId: input.workspaceId };

  if (statuses) where.status = { in: statuses };
  if (input.priority) where.priority = input.priority as Prisma.TaskWhereInput["priority"];
  if (input.search) {
    where.OR = [
      { title: { contains: input.search } },
      { description: { contains: input.search } },
    ];
  }

  return where;
}

async function computeCounts(workspaceId: string, baseSearch?: string) {
  const where: Prisma.TaskWhereInput = { workspaceId };
  if (baseSearch) {
    where.OR = [
      { title: { contains: baseSearch } },
      { description: { contains: baseSearch } },
    ];
  }

  const grouped = await db.task.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  const byStatus = new Map<string, number>();
  let all = 0;
  for (const row of grouped) {
    const n = row._count._all;
    byStatus.set(row.status, n);
    all += n;
  }

  const sumStatuses = (statuses: readonly TaskStatus[]) =>
    statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

  return {
    all,
    needsMe: sumStatuses(TASK_FILTER_STATUS_MAP.needs_me),
    ready: sumStatuses(TASK_FILTER_STATUS_MAP.ready),
    running: sumStatuses(TASK_FILTER_STATUS_MAP.running),
    completed: sumStatuses(TASK_FILTER_STATUS_MAP.completed),
    failed: sumStatuses(TASK_FILTER_STATUS_MAP.failed),
  };
}

export async function listTasksByWorkspace(input: ListTasksInput) {
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
  const sortField: TaskListSortField =
    input.sort && SORT_FIELDS[input.sort] ? input.sort : "updatedAt";
  const order: "asc" | "desc" = input.order === "asc" ? "asc" : "desc";

  const where = buildWhere(input);

  const [rows, total, counts] = await Promise.all([
    db.task.findMany({
      where,
      include: {
        projection: true,
        importedCalendarEvents: {
          take: 1,
          include: {
            calendarSource: { select: { name: true, color: true } },
          },
        },
      },
      orderBy: { [sortField]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.task.count({ where }),
    // Counts reflect the current search scope but ignore the active tab/status
    // so every filter tab shows its own total.
    computeCounts(input.workspaceId, input.search),
  ]);

  // Derive the task source from a linked imported calendar event so the UI can
  // mark externally-synced tasks. Tasks created in Chrona have no linked event
  // and report a null source (fully editable).
  const tasks = rows.map(({ importedCalendarEvents, ...task }) => {
    const importedEvent = importedCalendarEvents[0] ?? null;
    return {
      ...task,
      source: importedEvent
        ? {
            source: "external_calendar" as const,
            sourceName: importedEvent.calendarSource.name,
            sourceColor: importedEvent.calendarSource.color,
          }
        : null,
    };
  });

  return {
    tasks,
    count: tasks.length,
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
    counts,
  };
}
