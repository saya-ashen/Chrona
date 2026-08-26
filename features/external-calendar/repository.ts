import { db } from "@chrona/db";
import type {
  CalendarAutomationPolicy,
  CalendarSource as PrismaCalendarSource,
  CalendarSourceLifecycleState,
  CalendarSyncPolicy,
  CalendarSyncState,
  ImportedCalendarEvent,
  Prisma,
  TaskStatus,
  WorkBlockStatus,
} from "@chrona/db";

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type CalendarSource = PrismaCalendarSource;

export type CalendarSourceCreateData = {
  workspaceId: string;
  name: string;
  sourceUrl: string;
  redactedUrlLabel: string;
  color: string;
  syncPolicy?: CalendarSyncPolicy;
  automationPolicy?: CalendarAutomationPolicy;
  blockedNetworkConfirmedAt?: Date | null;
};

export type ImportedCalendarEventWrite = {
  workspaceId: string;
  calendarSourceId: string;
  externalUid: string;
  recurrenceId?: string | null;
  recurrenceRule?: string | null;
  dedupeKey: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
};

type ImportedCalendarSyncOptions = {
  policy: CalendarSyncPolicy;
  automationPolicy: CalendarAutomationPolicy;
  now: Date;
};

export type ImportedCalendarAutomationRequest = {
  taskId: string;
  workBlockId: string | null;
  accept: boolean;
};

export type ImportedCalendarReplacementResult = {
  importedCount: number;
  automationRequests: ImportedCalendarAutomationRequest[];
};

export function listCalendarSources(workspaceId: string): Promise<CalendarSource[]> {
  return db.calendarSource.findMany({
    where: { workspaceId, lifecycleState: { not: "removed" } },
    orderBy: { createdAt: "asc" },
  });
}

export function getCalendarSource(
  workspaceId: string,
  sourceId: string,
): Promise<CalendarSource | null> {
  return db.calendarSource.findFirst({
    where: { id: sourceId, workspaceId, lifecycleState: { not: "removed" } },
  });
}

export function createCalendarSource(data: CalendarSourceCreateData): Promise<CalendarSource> {
  return db.calendarSource.create({ data });
}

export function updateCalendarSource(
  workspaceId: string,
  sourceId: string,
  data: Prisma.CalendarSourceUpdateInput,
): Promise<CalendarSource> {
  return db.calendarSource.update({
    where: { id: sourceId, workspaceId },
    data,
  });
}

export async function markCalendarSourceRemoved(
  workspaceId: string,
  sourceId: string,
): Promise<CalendarSource | null> {
  const existing = await db.calendarSource.findFirst({ where: { id: sourceId, workspaceId } });
  if (!existing) return null;

  if (existing.lifecycleState === "removed") return existing;

  return db.calendarSource.update({
    where: { id: sourceId, workspaceId },
    data: { lifecycleState: "removed" },
  });
}

export async function replaceImportedCalendarEvents(
  calendarSourceId: string,
  events: ImportedCalendarEventWrite[],
  options?: Partial<ImportedCalendarSyncOptions>,
): Promise<ImportedCalendarReplacementResult> {
  let importedCount = 0;
  const automationRequests: ImportedCalendarAutomationRequest[] = [];
  await db.$transaction(async (tx) => {
    const source = await tx.calendarSource.findUniqueOrThrow({
      where: { id: calendarSourceId },
      select: { workspaceId: true, name: true, syncPolicy: true, automationPolicy: true },
    });
    const syncOptions: ImportedCalendarSyncOptions = {
      policy: options?.policy ?? source.syncPolicy,
      automationPolicy: options?.automationPolicy ?? source.automationPolicy,
      now: options?.now ?? new Date(),
    };
    const existingEvents = await tx.importedCalendarEvent.findMany({
      where: { calendarSourceId },
      orderBy: { updatedAt: "desc" },
    });
    const previouslyLinkedTaskIds = new Set(
      existingEvents.map((event) => event.taskId).filter((taskId): taskId is string => Boolean(taskId)),
    );
    const existingByIdentity = new Map<string, ImportedCalendarEvent>();
    const seriesTaskIds = new Map<string, string>();
    for (const event of existingEvents) {
      const identity = importedCalendarEventIdentity(event);
      if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, event);
      const seriesKey = importedCalendarSeriesKey(event);
      if (seriesKey && event.taskId && !seriesTaskIds.has(seriesKey)) seriesTaskIds.set(seriesKey, event.taskId);
    }

    const syncedEventIds = new Set<string>();
    for (const event of events) {
      const existingByStableIdentity = existingByIdentity.get(importedCalendarEventIdentity(event));
      const importedEvent = existingByStableIdentity
        ? await tx.importedCalendarEvent.update({
          where: { id: existingByStableIdentity.id },
          data: {
            dedupeKey: event.dedupeKey,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            isAllDay: event.isAllDay,
            status: event.status,
            recurrenceId: event.recurrenceId,
            recurrenceRule: event.recurrenceRule,
          },
        })
        : await tx.importedCalendarEvent.upsert({
          where: {
            calendarSourceId_dedupeKey: {
              calendarSourceId,
              dedupeKey: event.dedupeKey,
            },
          },
          create: event,
          update: {
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            isAllDay: event.isAllDay,
            status: event.status,
            recurrenceId: event.recurrenceId,
            recurrenceRule: event.recurrenceRule,
          },
        });
      syncedEventIds.add(importedEvent.id);
      const automationRequest = await syncImportedCalendarOccurrence(
        tx,
        importedEvent,
        seriesTaskIds,
        syncOptions,
      );
      if (automationRequest) automationRequests.push(automationRequest);
      importedCount += 1;
    }

    const staleEvents = existingEvents.filter((event) => !syncedEventIds.has(event.id));
    for (const event of staleEvents) {
      const cancelledEvent = event.status === "cancelled"
        ? event
        : await tx.importedCalendarEvent.update({
          where: { id: event.id },
          data: { status: "cancelled" },
        });
      await syncImportedCalendarOccurrence(
        tx,
        cancelledEvent,
        seriesTaskIds,
        syncOptions,
      );
    }

    const stillLinkedTaskIds = new Set(
      (await tx.importedCalendarEvent.findMany({
        where: { calendarSourceId, taskId: { not: null } },
        select: { taskId: true },
      })).map((event) => event.taskId).filter((taskId): taskId is string => Boolean(taskId)),
    );
    const orphanTaskIds = [...previouslyLinkedTaskIds].filter((taskId) => !stillLinkedTaskIds.has(taskId));
    if (orphanTaskIds.length > 0) {
      await deleteCalendarOrphanTasks(tx, orphanTaskIds);
    }
  });
  return { importedCount, automationRequests };
}

function importedCalendarEventIdentity(
  event: Pick<ImportedCalendarEventWrite, "externalUid" | "recurrenceId">,
) {
  return [event.externalUid, event.recurrenceId ?? "single"].join(":");
}

function importedCalendarSeriesKey(event: Pick<ImportedCalendarEvent, "externalUid" | "recurrenceRule">) {
  return event.recurrenceRule ? event.externalUid : null;
}

async function deleteCalendarOrphanTasks(tx: TransactionClient, taskIds: string[]) {
  await tx.rawEventLog.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.event.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskTimelineItem.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskPlanProviderRun.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskPlanRun.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskPlan.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.run.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskSession.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.executionSession.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.schedulerEvent.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.scheduleProposal.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.workBlock.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.taskProjection.deleteMany({ where: { taskId: { in: taskIds } } });
  await tx.task.deleteMany({ where: { id: { in: taskIds } } });
}

async function syncImportedCalendarOccurrence(
  tx: TransactionClient,
  occurrence: ImportedCalendarEvent,
  seriesTaskIds: Map<string, string>,
  options: ImportedCalendarSyncOptions,
): Promise<ImportedCalendarAutomationRequest | null> {
  const syncedStatus = getImportedCalendarTaskStatus(occurrence, options);
  const workspaceId = occurrence.workspaceId;
  const isRecurring = Boolean(occurrence.recurrenceRule || occurrence.recurrenceId);
  const seriesKey = importedCalendarSeriesKey(occurrence);
  const mappedSeriesTaskId = seriesKey ? seriesTaskIds.get(seriesKey) ?? null : null;
  const seriesTaskId = isRecurring
    ? mappedSeriesTaskId ?? (await tx.importedCalendarEvent.findFirst({
      where: {
        calendarSourceId: occurrence.calendarSourceId,
        externalUid: occurrence.externalUid,
        taskId: { not: null },
      },
      orderBy: { startsAt: "asc" },
      select: { taskId: true },
    }))?.taskId ?? null
    : null;
  let task = (seriesTaskId ?? occurrence.taskId)
    ? await tx.task.findUnique({ where: { id: (seriesTaskId ?? occurrence.taskId) as string } })
    : null;
  let automationRequest: ImportedCalendarAutomationRequest | null = null;

  if (task) {
    task = await tx.task.update({
      where: { id: task.id },
      data: {
        title: occurrence.title,
        status: syncedStatus,
        kind: isRecurring ? "recurring" : "single",
        recurrenceRule: occurrence.recurrenceRule,
        recurrenceWindowUntil: isRecurring ? occurrence.startsAt : null,
        seriesExternalUid: null,
      },
    });
  } else {
    const automation = getImportedCalendarTaskAutomation(occurrence, syncedStatus, options);
    task = await tx.task.create({
      data: {
        workspaceId,
        title: occurrence.title,
        description: null,
        status: syncedStatus,
        kind: isRecurring ? "recurring" : "single",
        recurrenceRule: occurrence.recurrenceRule,
        recurrenceAnchorStartAt: isRecurring ? occurrence.startsAt : null,
        recurrenceAnchorEndAt: isRecurring ? occurrence.endsAt : null,
        recurrenceWindowUntil: isRecurring ? occurrence.startsAt : null,
        seriesExternalUid: null,
        executionConfig: {},
        priority: "Medium",
        autoPlanGeneration: automation.autoPlanGeneration,
        autoExecute: automation.autoExecute,
        autoPlanGenerationTiming: "at_start",
        autoExecuteTiming: "at_start",
      },
    });
    if (automation.shouldStartPlan) {
      automationRequest = { taskId: task.id, workBlockId: null, accept: automation.autoExecute };
    }
  }

  if (seriesKey) seriesTaskIds.set(seriesKey, task.id);
  if (isRecurring) {
    await tx.workBlock.deleteMany({ where: { taskId: task.id, recurrenceKey: null } });
  }


  const workBlockStatus: WorkBlockStatus =
    syncedStatus === "Cancelled"
      ? "Cancelled"
      : syncedStatus === "Completed"
        ? "Completed"
        : "Scheduled";
  const completedAt = syncedStatus === "Completed" ? occurrence.endsAt : null;
  const blockData = {
    recurrenceKey: isRecurring ? occurrence.startsAt.toISOString() : null,
    title: occurrence.title,
    status: workBlockStatus,
    scheduledStartAt: occurrence.startsAt,
    scheduledEndAt: occurrence.endsAt,
    completedAt,
    trigger: "manual" as const,
  };

  let workBlock: { id: string };
  if (isRecurring) {
    workBlock = await tx.workBlock.upsert({
      where: {
        taskId_recurrenceKey: {
          taskId: task.id,
          recurrenceKey: occurrence.startsAt.toISOString(),
        },
      },
      create: { workspaceId, taskId: task.id, ...blockData },
      update: { taskId: task.id, ...blockData },
      select: { id: true },
    });
  } else if (occurrence.workBlockId) {
    const existingBlock = await tx.workBlock.findUnique({
      where: { id: occurrence.workBlockId },
      select: { id: true },
    });
    workBlock = existingBlock ?? await tx.workBlock.create({
      data: { workspaceId, taskId: task.id, ...blockData },
      select: { id: true },
    });
    if (existingBlock) {
      await tx.workBlock.update({
        where: { id: existingBlock.id },
        data: { taskId: task.id, ...blockData },
      });
    }
  } else {
    workBlock = await tx.workBlock.create({
      data: { workspaceId, taskId: task.id, ...blockData },
      select: { id: true },
    });
  }

  await tx.importedCalendarEvent.update({
    where: { id: occurrence.id },
    data: { taskId: task.id, workBlockId: workBlock.id },
  });
  await upsertImportedCalendarTaskProjectionForOccurrence(tx, task.id, workspaceId, syncedStatus, occurrence);

  return automationRequest ? { ...automationRequest, workBlockId: workBlock.id } : null;
}

async function upsertImportedCalendarTaskProjectionForOccurrence(
  tx: TransactionClient,
  taskId: string,
  workspaceId: string,
  syncedStatus: TaskStatus,
  occurrence: ImportedCalendarEvent,
) {
  if (syncedStatus === "Cancelled") {
    await upsertImportedCalendarTaskProjection(tx, taskId, workspaceId, syncedStatus, null, null, null, null);
    return;
  }

  await upsertImportedCalendarTaskProjection(
    tx,
    taskId,
    workspaceId,
    syncedStatus,
    occurrence.startsAt,
    occurrence.endsAt,
    syncedStatus === "Completed" ? "Completed" : "Scheduled",
    "system",
  );
}

function getImportedCalendarTaskAutomation(
  event: ImportedCalendarEvent,
  syncedStatus: string,
  options: ImportedCalendarSyncOptions,
) {
  const autoExecute = options.automationPolicy === "auto_execute";
  const autoPlanGeneration = autoExecute || options.automationPolicy === "auto_plan";
  const shouldStartPlan = autoPlanGeneration
    && event.status === "confirmed"
    && syncedStatus === "Ready"
    && event.startsAt.getTime() > options.now.getTime();
  return { autoPlanGeneration, autoExecute, shouldStartPlan };
}

function getImportedCalendarTaskStatus(
  event: ImportedCalendarEvent,
  options: ImportedCalendarSyncOptions,
): TaskStatus {
  if (event.status === "cancelled") return "Cancelled";
  if (options.policy === "auto_complete_past_events" && event.endsAt.getTime() < options.now.getTime()) return "Completed";
  return "Ready";
}

async function upsertImportedCalendarTaskProjection(
  tx: TransactionClient,
  taskId: string,
  workspaceId: string,
  persistedStatus: string,
  scheduledStartAt: Date | null,
  scheduledEndAt: Date | null,
  scheduleStatus: string | null,
  scheduleSource: string | null,
) {
  await tx.taskProjection.upsert({
    where: { taskId },
    update: {
      workspaceId,
      persistedStatus,
      displayState: null,
      blockType: null,
      blockScope: null,
      blockSince: null,
      actionRequired: null,
      latestRunStatus: null,
      approvalPendingCount: 0,
      dueAt: null,
      scheduledStartAt,
      scheduledEndAt,
      scheduleStatus,
      scheduleSource,
      scheduleProposalCount: 0,
      lastActivityAt: new Date(),
    },
    create: {
      taskId,
      workspaceId,
      persistedStatus,
      displayState: null,
      blockType: null,
      blockScope: null,
      blockSince: null,
      actionRequired: null,
      latestRunStatus: null,
      approvalPendingCount: 0,
      dueAt: null,
      scheduledStartAt,
      scheduledEndAt,
      scheduleStatus,
      scheduleSource,
      scheduleProposalCount: 0,
      lastActivityAt: new Date(),
    },
  });
}

export function listImportedCalendarEventsInRange(
  workspaceId: string,
  from: Date,
  to: Date,
  sourceId?: string,
): Promise<Array<ImportedCalendarEvent & { calendarSource: CalendarSource }>> {
  return db.importedCalendarEvent.findMany({
    where: {
      workspaceId,
      ...(sourceId ? { calendarSourceId: sourceId } : {}),
      status: { not: "cancelled" },
      startsAt: { lt: to },
      endsAt: { gt: from },
      calendarSource: { lifecycleState: "active" },
    },
    include: { calendarSource: true },
    orderBy: { startsAt: "asc" },
  });
}

export function updateCalendarSourceSyncStatus(
  workspaceId: string,
  sourceId: string,
  data: {
    syncState: CalendarSyncState;
    importedCount?: number;
    skippedCount?: number;
    lastSuccessfulRefreshAt?: Date | null;
    nextExpectedRefreshAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    lifecycleState?: CalendarSourceLifecycleState;
  },
): Promise<CalendarSource> {
  return db.calendarSource.update({
    where: { id: sourceId, workspaceId },
    data,
  });
}
