import type { Prisma } from "@/generated/prisma/client";
import { recordSchedulerEvent } from "./scheduler-event-repository";

export type SchedulerEventType =
  | "scheduler.start"
  | "scheduler.skip"
  | "scheduler.sync"
  | "scheduler.advance"
  | "scheduler.pause"
  | "scheduler.complete"
  | "scheduler.fail"
  | "scheduler.cancel"
  | "scheduler.degraded_retry"
  | "scheduler.repair";

export type SchedulerEventDetails = {
  workspaceId: string;
  taskId: string;
  eventType: SchedulerEventType;
  graphVersion?: number | null;
  reason?: string | null;
  payload?: Prisma.InputJsonValue;
};

export function recordOrchestratorEvent(input: SchedulerEventDetails) {
  return recordSchedulerEvent(input);
}
