import { db } from "./db";
import type {
  CalendarSource,
  CalendarAutomationPolicy,
  CalendarSourceLifecycleState,
  CalendarSyncPolicy,
  CalendarSyncState,
  ImportedCalendarEvent,
  Prisma,
} from "./generated/prisma/client";

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

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
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: source.workspaceId },
      select: { defaultRuntime: true },
    });

    for (const event of events) {
      const importedEvent = await tx.importedCalendarEvent.upsert({
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
        },
      });
      const automationRequest = await syncImportedCalendarEventTask(tx, importedEvent, workspace.defaultRuntime, syncOptions);
      if (automationRequest) automationRequests.push(automationRequest);
      importedCount += 1;
    }
  });
  return { importedCount, automationRequests };
}

async function syncImportedCalendarEventTask(
  tx: TransactionClient,
  event: ImportedCalendarEvent,
  defaultRuntime: string,
  options: ImportedCalendarSyncOptions,
) {
  const syncedStatus = getImportedCalendarTaskStatus(event, options);
  let automationRequest: ImportedCalendarAutomationRequest | null = null;
  let task = event.taskId
    ? await tx.task.findUnique({ where: { id: event.taskId } })
    : null;

  if (task) {
    task = await tx.task.update({
      where: { id: task.id },
      data: {
        title: event.title,
        status: syncedStatus,
      },
    });
  } else {
    const automation = getImportedCalendarTaskAutomation(event, syncedStatus, options);
    task = await tx.task.create({
      data: {
        workspaceId: event.workspaceId,
        title: event.title,
        description: null,
        executionRuntime: defaultRuntime,
        executionConfig: {},
        status: syncedStatus,
        priority: "Medium",
        autoPlanGeneration: automation.autoPlanGeneration,
        autoExecute: automation.autoExecute,
      },
    });
    if (automation.shouldStartPlan) {
      automationRequest = { taskId: task.id, accept: automation.autoExecute };
    }
    await tx.importedCalendarEvent.update({
      where: { id: event.id },
      data: { taskId: task.id },
    });
  }

  if (syncedStatus === "Cancelled") {
    await tx.workBlock.updateMany({
      where: { taskId: task.id, status: "Scheduled" },
      data: { status: syncedStatus },
    });
    await upsertImportedCalendarTaskProjection(tx, task.id, event.workspaceId, syncedStatus, null, null, null, null);
    return automationRequest;
  }

  const workBlockStatus = syncedStatus === "Completed" ? "Completed" : "Scheduled";
  const existingBlock = await tx.workBlock.findFirst({
    where: { taskId: task.id, status: { in: ["Scheduled", "Completed"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existingBlock) {
    await tx.workBlock.update({
      where: { id: existingBlock.id },
      data: {
        title: event.title,
        status: workBlockStatus,
        scheduledStartAt: event.startsAt,
        scheduledEndAt: event.endsAt,
        completedAt: syncedStatus === "Completed" ? event.endsAt : null,
        trigger: "manual",
      },
    });
  } else {
    await tx.workBlock.create({
      data: {
        workspaceId: event.workspaceId,
        taskId: task.id,
        title: event.title,
        status: workBlockStatus,
        scheduledStartAt: event.startsAt,
        scheduledEndAt: event.endsAt,
        completedAt: syncedStatus === "Completed" ? event.endsAt : null,
        trigger: "manual",
      },
    });
  }

  await upsertImportedCalendarTaskProjection(
    tx,
    task.id,
    event.workspaceId,
    task.status,
    event.startsAt,
    event.endsAt,
    syncedStatus === "Completed" ? "Completed" : "Scheduled",
    "system",
  );

  return automationRequest;
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
) {
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
      taskId: null,
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
