import { AsyncLocalStorage } from "node:async_hooks";

export type CommandActor = { actorType: string; actorId: string; source: string; correlationId?: string };
const actors = new AsyncLocalStorage<CommandActor>();
export function withCommandActor<T>(actor: CommandActor, work: () => Promise<T>): Promise<T> {
  return actors.run(actor, work);
}
export function currentCommandActor(): CommandActor | undefined { return actors.getStore(); }
