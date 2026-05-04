import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type TaskAssistantMessageRole = "user" | "assistant";

export async function saveAssistantMessage(input: {
  taskId: string;
  role: TaskAssistantMessageRole;
  content: string;
  proposal?: Record<string, unknown> | null;
}) {
  const task = await db.task.findUnique({ where: { id: input.taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  const lastMsg = await db.taskAssistantMessage.findFirst({
    where: { taskId: input.taskId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (lastMsg?.sequence ?? -1) + 1;

  return db.taskAssistantMessage.create({
    data: {
      taskId: input.taskId,
      role: input.role,
      content: input.content,
      proposal: (input.proposal ?? null) as Prisma.InputJsonValue,
      sequence,
    },
  });
}

export async function getAssistantMessages(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  return db.taskAssistantMessage.findMany({
    where: { taskId },
    orderBy: { sequence: "asc" },
  });
}

export async function applyAssistantMessage(messageId: string, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  const existing = await db.taskAssistantMessage.findFirst({
    where: { id: messageId, taskId },
  });
  if (!existing) {
    throw new Error("Message not found");
  }

  return db.taskAssistantMessage.update({
    where: { id: messageId },
    data: { applied: true, appliedAt: new Date() },
  });
}
