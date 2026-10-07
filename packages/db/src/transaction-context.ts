import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

type Scope = { client: Prisma.TransactionClient; active: boolean; afterCommit: Array<() => void> };
const transactions = new AsyncLocalStorage<Scope>();

/** Existing DB-only use cases can compose without independent/nested commits.
 * No provider/network operation may be performed inside this scope. */
export function transactionAwareClient(root: PrismaClient): PrismaClient {
  let transactionOverride: PrismaClient["$transaction"] | undefined;
  return new Proxy(root, {
    set(target, property, value: unknown) {
      // Instrumentation may wrap the public method; never replace the raw method
      // used by the composition layer or a captured wrapper would recurse.
      if (property === "$transaction" && typeof value === "function") {
        transactionOverride = value as PrismaClient["$transaction"];
        return true;
      }
      return Reflect.set(target, property, value);
    },
    get(target, property) {
      const scope = transactions.getStore();
      if (scope && !scope.active) throw new Error("Database transaction scope has already closed");
      if (property === "$transaction") {
        if (!scope && transactionOverride) return transactionOverride;
        return (work: ((tx: Prisma.TransactionClient) => Promise<unknown>) | Promise<unknown>[], options?: TransactionOptions) => {
          const current = transactions.getStore();
          if (current && !current.active) throw new Error("Database transaction scope has already closed");
          if (current) return typeof work === "function" ? work(current.client) : Promise.all(work);
          if (typeof work !== "function") return Reflect.apply(target.$transaction, target, [work, options]);
          return inDatabaseTransaction(target, () => work(transactions.getStore()!.client), options);
        };
      }
      const client = scope?.client ?? target;
      const value = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

type TransactionOptions = { timeout?: number; maxWait?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
export async function inDatabaseTransaction<T>(root: PrismaClient, work: () => Promise<T>, options?: TransactionOptions): Promise<T> {
  if (transactions.getStore()?.active) return work();
  const afterCommit: Array<() => void> = [];
  const result = await root.$transaction(async (client) => {
    const scope: Scope = { client, active: true, afterCommit };
    try { return await transactions.run(scope, work); }
    finally { scope.active = false; }
  }, { timeout: 30_000, maxWait: 30_000, ...options });
  for (const callback of afterCommit) callback();
  return result;
}

export function afterDatabaseCommit(callback: () => void) {
  const scope = transactions.getStore();
  if (scope) {
    if (!scope.active) throw new Error("Cannot schedule work after a closed database transaction");
    scope.afterCommit.push(callback);
  } else callback();
}
