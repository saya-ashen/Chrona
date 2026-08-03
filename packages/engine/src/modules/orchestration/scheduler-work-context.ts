import { AsyncLocalStorage } from "node:async_hooks";
import type { SchedulerWorkContext } from "./scheduler-lease-repository";

const schedulerWorkContextStorage = new AsyncLocalStorage<
  SchedulerWorkContext | undefined
>();

export function runWithSchedulerWorkContext<T>(
  workContext: SchedulerWorkContext | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return schedulerWorkContextStorage.run(workContext, work);
}

export function currentSchedulerWorkContext(): SchedulerWorkContext | undefined {
  return schedulerWorkContextStorage.getStore();
}
