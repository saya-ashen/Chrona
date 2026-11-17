import type { StewardPorts } from "../ports";
const locks = new WeakMap<StewardPorts["db"], Map<string, Promise<unknown>>>();
/** One runtime serializes timer mutation with committed admission and synchronous socket write. */
export function withTimerLock<T>(ports: StewardPorts, workspaceId: string, work: () => Promise<T>): Promise<T> {
  let workspaceLocks = locks.get(ports.db);
  if (!workspaceLocks) { workspaceLocks = new Map(); locks.set(ports.db, workspaceLocks); }
  const previous = workspaceLocks.get(workspaceId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  workspaceLocks.set(workspaceId, next);
  void next.finally(() => { if (workspaceLocks.get(workspaceId) === next) workspaceLocks.delete(workspaceId); }).catch(() => {});
  return next;
}
