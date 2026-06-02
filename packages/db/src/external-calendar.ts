import { db } from "./db";
import type {
  CalendarSource,
  CalendarAutomationPolicy,
  CalendarSourceLifecycleState,
  CalendarSyncPolicy,
  CalendarSyncState,
  ImportedCalendarEvent,
  Prisma,
  TaskStatus,
  WorkBlockStatus,
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

    const existingEvents = await tx.importedCalendarEvent.findMany({
      where: { calendarSourceId },
      orderBy: { updatedAt: "desc" },
    });
    const existingByIdentity = new Map<string, ImportedCalendarEvent>();
    for (const event of existingEvents) {
      const identity = importedCalendarEventIdentity(event);
      if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, event);
    }

    const grouped = new Map<string, ImportedCalendarEvent[]>();
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
      const group = grouped.get(importedEvent.externalUid) ?? [];
      group.push(importedEvent);
      grouped.set(importedEvent.externalUid, group);
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
      const group = grouped.get(cancelledEvent.externalUid) ?? [];
      group.push(cancelledEvent);
      grouped.set(cancelledEvent.externalUid, group);
    }

    for (const occurrences of grouped.values()) {
      const automationRequest = await syncImportedCalendarSeries(
        tx,
        occurrences,
        workspace.defaultRuntime,
        syncOptions,
      );
      if (automationRequest) automationRequests.push(automationRequest);
    }
  });
  return { importedCount, automationRequests };
}

function importedCalendarEventIdentity(
  event: Pick<ImportedCalendarEventWrite, "externalUid" | "recurrenceId">,
) {
  return [event.externalUid, event.recurrenceId ?? "single"].join(":");
}

async function syncImportedCalendarSeries(
  tx: TransactionClient,
  occurrences: ImportedCalendarEvent[],
  defaultRuntime: string,
  options: ImportedCalendarSyncOptions,
): Promise<ImportedCalendarAutomationRequest | null> {
  const sorted = [...occurrences].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const recurrenceRule = sorted.find((o) => o.recurrenceRule)?.recurrenceRule ?? null;
  const isRecurring = recurrenceRule !== null || sorted.length > 1;
  const externalUid = sorted[0].externalUid;
  const workspaceId = sorted[0].workspaceId;

  // The active occurrence (next upcoming, else most recent non-cancelled) drives
  // the series task status and the single projection slot shown in lists.
  const activeOccurrence =
    sorted.find(
      (o) => o.startsAt.getTime() >= options.now.getTime() && o.status !== "cancelled",
    ) ??
    [...sorted].reverse().find((o) => o.status !== "cancelled") ??
    sorted[sorted.length - 1];
  const activeStatus = getImportedCalendarTaskStatus(activeOccurrence, options);

  let automationRequest: ImportedCalendarAutomationRequest | null = null;
  const existingTaskId = sorted.find((o) => o.taskId)?.taskId ?? null;
  let task = existingTaskId
    ? await tx.task.findUnique({ where: { id: existingTaskId } })
    : null;

  const seriesData = {
    title: activeOccurrence.title,
    status: activeStatus,
    kind: isRecurring ? ("recurring" as const) : ("single" as const),
    recurrenceRule,
    seriesExternalUid: isRecurring ? externalUid : null,
  };

  if (task) {
    task = await tx.task.update({ where: { id: task.id }, data: seriesData });
  } else {
    const automation = getImportedCalendarTaskAutomation(activeOccurrence, activeStatus, options);
    task = await tx.task.create({
      data: {
        workspaceId,
        description: null,
        executionRuntime: defaultRuntime,
        executionConfig: {},
        priority: "Medium",
        autoPlanGeneration: automation.autoPlanGeneration,
        autoExecute: automation.autoExecute,
        ...seriesData,
      },
    });
    if (automation.shouldStartPlan) {
      automationRequest = { taskId: task.id, accept: automation.autoExecute };
    }
  }

  // One work block per occurrence; each imported occurrence owns its work block.
  for (const occurrence of sorted) {
    const occStatus = getImportedCalendarTaskStatus(occurrence, options);
    const workBlockStatus: WorkBlockStatus =
      occStatus === "Cancelled"
        ? "Cancelled"
        : occStatus === "Completed"
          ? "Completed"
          : "Scheduled";
    const completedAt = occStatus === "Completed" ? occurrence.endsAt : null;
    const blockData = {
      title: occurrence.title,
      status: workBlockStatus,
      scheduledStartAt: occurrence.startsAt,
      scheduledEndAt: occurrence.endsAt,
      completedAt,
      trigger: "manual" as const,
    };

    if (occurrence.workBlockId) {
      await tx.workBlock.update({
        where: { id: occurrence.workBlockId },
        data: { ...blockData, taskId: task.id },
      });
      if (occurrence.taskId !== task.id) {
        await tx.importedCalendarEvent.update({
          where: { id: occurrence.id },
          data: { taskId: task.id },
        });
      }
    } else {
      const workBlock = await tx.workBlock.create({
        data: { workspaceId, taskId: task.id, ...blockData },
      });
      await tx.importedCalendarEvent.update({
        where: { id: occurrence.id },
        data: { taskId: task.id, workBlockId: workBlock.id },
      });
    }
  }

  // The projection tracks the active occurrence only.
  if (activeStatus === "Cancelled") {
    await upsertImportedCalendarTaskProjection(
      tx,
      task.id,
      workspaceId,
      activeStatus,
      null,
      null,
      null,
      null,
    );
  } else {
    await upsertImportedCalendarTaskProjection(
      tx,
      task.id,
      workspaceId,
      task.status,
      activeOccurrence.startsAt,
      activeOccurrence.endsAt,
      activeStatus === "Completed" ? "Completed" : "Scheduled",
      "system",
    );
  }

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
      task: { kind: "recurring" },
      status: { not: "cancelled" },
      startsAt: { lt: to },
      endsAt: { gt: from },
      calendarSource: { lifecycleState: "active" },
      workBlockId: null,
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
