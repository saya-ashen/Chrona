import type { Prisma, ManagementCommand } from "@/generated/prisma/client";
export const managementJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function commandReceipt(command: ManagementCommand, replayed = false) {
  return { commandId: command.id, requestId: command.requestId, taskId: command.taskId, phase: command.phase, state: command.state, errorCode: command.errorCode, replayed, recordedAt: command.updatedAt.toISOString(), result: command.result };
}
