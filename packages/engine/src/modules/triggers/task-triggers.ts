import { createHash } from "node:crypto";

import { db, Prisma } from "@chrona/db";
import type {
  CreateTaskTriggerRequest,
  TaskTriggerActionRequest,
  TaskTriggerDefinition,
  UpdateTaskTriggerRequest,
} from "@chrona/contracts/api";
import { taskTriggerDefinitionSchema } from "@chrona/contracts/api";
import { expandRecurrenceRule } from "@chrona/integrations";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const LOOKAHEAD_DAYS = 90;
const MAX_OCCURRENCES = 200;

type Json = Prisma.InputJsonValue;
type EventTopic = Extract<TaskTriggerDefinition, { kind: "event" }>["config"]["topic"];

function scheduleKey(version: number, startsAt: Date) {
  return `schedule:v${version}:${startsAt.toISOString()}`;
}

function triggerReadModel(trigger: {
  id: string;
  workspaceId: string;
  taskId: string;
  kind: string;
  state: string;
  config: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...trigger,
    definition: taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config }),
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
  };
}

async function taskForTrigger(taskId: string, workspaceId: string) {
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  return task;
}

function scheduleOccurrences(config: Extract<TaskTriggerDefinition, { kind: "schedule" }>["config"], from: Date) {
  if (config.mode === "once") {
    const startsAt = new Date(config.fireAt);
    return [{ startsAt, endsAt: new Date(startsAt.getTime() + (config.durationMs ?? 3_600_000)) }];
  }
  const windowTo = new Date(from.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  return expandRecurrenceRule(config.rrule, new Date(config.anchorStartAt), config.durationMs ?? 3_600_000, {
    from,
    to: config.windowUntil ? new Date(Math.min(windowTo.getTime(), new Date(config.windowUntil).getTime())) : windowTo,
    maxOccurrences: MAX_OCCURRENCES,
  });
}

async function materializeScheduleTrigger(triggerId: string, from = new Date()) {
  const trigger = await db.taskTrigger.findUnique({
    where: { id: triggerId },
    include: { task: true },
  });
  if (!trigger || trigger.kind !== "schedule" || trigger.state !== "Enabled") return 0;
  const definition = taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config });
  if (definition.kind !== "schedule") return 0;
  const config = definition.config;
  const scheduled = scheduleOccurrences(config, from);
  let created = 0;
  for (const item of scheduled) {
    if (item.startsAt < from && config.mode === "once") continue;
    const occurrenceKey = scheduleKey(trigger.version, item.startsAt);
    const deliveryKey = occurrenceKey;
    const existing = await db.triggerDelivery.findUnique({
      where: { triggerId_deliveryKey: { triggerId: trigger.id, deliveryKey } },
      select: { id: true },
    });
    if (existing) continue;
    await db.$transaction(async (tx) => {
      const workBlock = await tx.workBlock.create({
        data: {
          workspaceId: trigger.workspaceId,
          taskId: trigger.taskId,
          title: trigger.task.title,
          recurrenceKey: occurrenceKey,
          status: "Scheduled",
          scheduledStartAt: item.startsAt,
          scheduledEndAt: item.endsAt,
          trigger: "scheduled",
        },
      });
      const delivery = await tx.triggerDelivery.create({
        data: {
          workspaceId: trigger.workspaceId,
          triggerId: trigger.id,
          taskId: trigger.taskId,
          deliveryKey,
          status: "Accepted",
          processedAt: new Date(),
          payloadDigest: createHash("sha256").update(deliveryKey).digest("hex"),
        },
      });
      await tx.taskOccurrence.create({
        data: {
          workspaceId: trigger.workspaceId,
          taskId: trigger.taskId,
          triggerId: trigger.id,
          deliveryId: delivery.id,
          workBlockId: workBlock.id,
          occurrenceKey,
          triggerVersion: trigger.version,
          source: { kind: "trigger", triggerId: trigger.id, deliveryId: delivery.id },
          status: item.startsAt > from ? "Scheduled" : "Ready",
          eligibleAt: item.startsAt,
        },
      });
    });
    created += 1;
  }
  return created;
}

export async function createTaskTrigger(input: { taskId: string; command: CreateTaskTriggerRequest }) {
  const task = await taskForTrigger(input.taskId, input.command.workspaceId);
  const definition = taskTriggerDefinitionSchema.parse(input.command.definition);
  const trigger = await db.taskTrigger.create({
    data: {
      workspaceId: task.workspaceId,
      taskId: task.id,
      kind: definition.kind,
      config: definition.config as Json,
      state: "Enabled",
      version: 1,
    },
  });
  if (definition.kind === "schedule") await materializeScheduleTrigger(trigger.id);
  return triggerReadModel(trigger);
}

export async function updateTaskTrigger(input: { taskId: string; triggerId: string; command: UpdateTaskTriggerRequest }) {
  await taskForTrigger(input.taskId, input.command.workspaceId);
  const current = await db.taskTrigger.findFirst({ where: { id: input.triggerId, taskId: input.taskId } });
  if (!current) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Trigger not found");
  if (current.version !== input.command.expectedVersion) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Trigger version changed");
  const definition = taskTriggerDefinitionSchema.parse(input.command.definition);
  const trigger = await db.$transaction(async (tx) => {
    const updated = await tx.taskTrigger.update({
      where: { id: current.id },
      data: { kind: definition.kind, config: definition.config as Json, version: { increment: 1 } },
    });
    await tx.taskOccurrence.updateMany({
      where: { triggerId: current.id, status: { in: ["Scheduled", "Ready"] }, startedAt: null },
      data: { status: "Cancelled", completedAt: new Date() },
    });
    await tx.workBlock.updateMany({
      where: { taskId: input.taskId, occurrence: { triggerId: current.id, status: "Cancelled" }, status: "Scheduled" },
      data: { status: "Cancelled" },
    });
    return updated;
  });
  if (definition.kind === "schedule" && trigger.state === "Enabled") await materializeScheduleTrigger(trigger.id);
  return triggerReadModel(trigger);
}

export async function applyTaskTriggerAction(input: { taskId: string; triggerId: string; command: TaskTriggerActionRequest }) {
  await taskForTrigger(input.taskId, input.command.workspaceId);
  const desired = input.command.action === "pause" ? "Paused" : input.command.action === "resume" ? "Enabled" : "Retired";
  const trigger = await db.taskTrigger.update({ where: { id: input.triggerId }, data: { state: desired } });
  if (desired === "Enabled" && trigger.kind === "schedule") await materializeScheduleTrigger(trigger.id);
  return triggerReadModel(trigger);
}

export async function listTaskOccurrences(input: { taskId: string; workspaceId: string }) {
  await taskForTrigger(input.taskId, input.workspaceId);
  const occurrences = await db.taskOccurrence.findMany({
    where: { taskId: input.taskId },
    orderBy: [{ eligibleAt: "desc" }, { materializedAt: "desc" }],
    include: { workBlock: true, trigger: true },
  });
  return { occurrences };
}

export async function getTaskOccurrence(input: { taskId: string; occurrenceId: string }) {
  const occurrence = await db.taskOccurrence.findFirst({
    where: { id: input.occurrenceId, taskId: input.taskId },
    include: { workBlock: true, trigger: true, runs: true, executionSessions: true, taskPlans: true },
  });
  if (!occurrence) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Occurrence not found");
  return occurrence;
}

function valueAtPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }, input);
}

function eventFilterMatches(input: Record<string, unknown>, filter: { path: string; operator: "eq" | "neq" | "contains"; value: string | number | boolean }) {
  const actual = valueAtPath(input, filter.path);
  if (filter.operator === "eq") return actual === filter.value;
  if (filter.operator === "neq") return actual !== filter.value;
  return typeof actual === "string" && actual.includes(String(filter.value));
}

function acceptsEventTrigger(trigger: { kind: string; config: unknown }, input: { topic: EventTopic; normalizedInput: Record<string, unknown> }) {
  const definition = taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config });
  if (definition.kind !== "event" || definition.config.topic !== input.topic) return false;
  return !definition.config.filter || eventFilterMatches(input.normalizedInput, definition.config.filter);
}

async function activateEventTrigger(trigger: { id: string; taskId: string; version: number }, input: {
  workspaceId: string;
  topic: string;
  causationId: string;
  activationDepth: number;
  normalizedInput: Record<string, unknown>;
  encoded: string;
}) {
  const deliveryKey = `${input.topic}:${input.causationId}`;
  const duplicate = await db.triggerDelivery.findUnique({
    where: { triggerId_deliveryKey: { triggerId: trigger.id, deliveryKey } },
    select: { id: true },
  });
  if (duplicate) return false;
  try {
    await db.$transaction(async (tx) => {
      const delivery = await tx.triggerDelivery.create({ data: { workspaceId: input.workspaceId, triggerId: trigger.id, taskId: trigger.taskId, deliveryKey, status: "Accepted", processedAt: new Date(), payloadDigest: createHash("sha256").update(input.encoded).digest("hex"), normalizedInput: { ...input.normalizedInput, activationDepth: input.activationDepth } as Json } });
      await tx.taskOccurrence.create({ data: { workspaceId: input.workspaceId, taskId: trigger.taskId, triggerId: trigger.id, deliveryId: delivery.id, occurrenceKey: `event:${deliveryKey}`, triggerVersion: trigger.version, source: { kind: "trigger", triggerId: trigger.id, deliveryId: delivery.id }, status: "Ready", eligibleAt: new Date(), normalizedInput: { ...input.normalizedInput, activationDepth: input.activationDepth } as Json } });
    });
    return true;
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return false;
    throw cause;
  }
}

export async function activateInternalEvent(input: {
  workspaceId: string;
  topic: "task.result.accepted" | "goal.review_due";
  causationId: string;
  activationDepth?: number;
  normalizedInput: Record<string, unknown>;
}) {
  const activationDepth = input.activationDepth ?? 0;
  if (activationDepth > 4) return 0;
  const encoded = JSON.stringify(input.normalizedInput);
  if (Buffer.byteLength(encoded, "utf8") > 16_384) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Internal event input exceeds 16 KiB");
  }
  const triggers = await db.taskTrigger.findMany({ where: { workspaceId: input.workspaceId, kind: "event", state: "Enabled" } });
  const activations = await Promise.all(triggers
    .filter((trigger) => acceptsEventTrigger(trigger, input))
    .map((trigger) => activateEventTrigger(trigger, { ...input, activationDepth, encoded })));
  return activations.filter(Boolean).length;
}

function emailTriggerMatches(trigger: { kind: string; config: unknown }, input: { recipient: string; subject: string }) {
  const definition = taskTriggerDefinitionSchema.parse({ kind: trigger.kind, config: trigger.config });
  return definition.kind === "email" && definition.config.recipient === input.recipient && (!definition.config.subjectContains || input.subject.includes(definition.config.subjectContains));
}

export async function activateEmailDelivery(input: { timestamp: Date; workspaceId: string; deliveryId: string; recipient: string; from: string; subject: string; text: string; receivedAt: Date }) {
  const normalizedInput = { adapter: "email", recipient: input.recipient, from: input.from, subject: input.subject, text: input.text, receivedAt: input.receivedAt.toISOString() };
  const encoded = JSON.stringify(normalizedInput);
  if (Buffer.byteLength(encoded, "utf8") > 65_536) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Email delivery exceeds 64 KiB");
  const triggers = await db.taskTrigger.findMany({ where: { workspaceId: input.workspaceId, kind: "email", state: "Enabled" } });
  let activated = 0;
  for (const trigger of triggers.filter((candidate) => emailTriggerMatches(candidate, input))) {
    const deliveryKey = `email:${input.deliveryId}`;
    try {
      await db.$transaction(async (tx) => {
        const delivery = await tx.triggerDelivery.create({ data: { workspaceId: trigger.workspaceId, triggerId: trigger.id, taskId: trigger.taskId, deliveryKey, status: "Accepted", processedAt: new Date(), payloadDigest: createHash("sha256").update(encoded).digest("hex"), normalizedInput: normalizedInput as Json } });
        await tx.taskOccurrence.create({ data: { workspaceId: trigger.workspaceId, taskId: trigger.taskId, triggerId: trigger.id, deliveryId: delivery.id, occurrenceKey: deliveryKey, triggerVersion: trigger.version, source: { kind: "email", triggerId: trigger.id, deliveryId: delivery.id }, status: "Ready", eligibleAt: input.receivedAt, normalizedInput: normalizedInput as Json } });
      });
      activated += 1;
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") continue;
      throw cause;
    }
  }
  return activated;
}
