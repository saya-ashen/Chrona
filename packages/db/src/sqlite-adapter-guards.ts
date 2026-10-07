import { BunSqliteAdapter, type PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import type { Database } from "bun:sqlite";

type SqlDriverAdapter = Awaited<ReturnType<PrismaBunSqlite["connect"]>>;
type SqlQueryable = Pick<SqlDriverAdapter, "executeRaw" | "queryRaw">;
type Transaction = Awaited<ReturnType<SqlDriverAdapter["startTransaction"]>>;

/** Bun .run().changes counts trigger/cascade effects; Prisma expects SQLite's
 * top-level changes(). Capture synchronously before yielding to another query.
 * Covered by nested relation-connect and multi-row update regression tests. */
function affectedRows<T extends SqlQueryable>(target: T, connection: Database): T {
  return new Proxy(target, { get(object, property) {
    if (property === "executeRaw") return (query: Parameters<T["executeRaw"]>[0]) => {
      const pending = object.executeRaw(query);
      const row = connection.query("SELECT changes() AS count").get() as { count: number | bigint };
      return pending.then(() => Number(row.count));
    };
    const value = Reflect.get(object, property);
    return typeof value === "function" ? value.bind(object) : value;
  } });
}

/** The adapter shares one SQLite connection. Its transaction-only mutex does
 * not fence ordinary queries; those must not accidentally join another caller's
 * uncommitted transaction. Hold this gate for a transaction's entire lifetime. */
function guardConnection(adapter: BunSqliteAdapter): SqlDriverAdapter {
  let tail: Promise<void> = Promise.resolve();
  async function acquire() {
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    return release;
  }
  const root = affectedRows(adapter, adapter.getDatabase());
  return new Proxy(root, { get(object, property) {
    if (property === "queryRaw" || property === "executeRaw") return async (query: Parameters<SqlQueryable["queryRaw"]>[0]) => {
      const release = await acquire();
      try { return await object[property](query); } finally { release(); }
    };
    if (property === "startTransaction") return async (...args: Parameters<SqlDriverAdapter["startTransaction"]>) => {
      const release = await acquire();
      try {
        const tx = affectedRows(await adapter.startTransaction(...args), adapter.getDatabase());
        return new Proxy(tx, { get(transaction, key) {
          if (key === "commit" || key === "rollback") return async () => { try { await transaction[key](); } finally { release(); } };
          const value = Reflect.get(transaction, key);
          return typeof value === "function" ? value.bind(transaction) : value;
        } }) satisfies Transaction;
      } catch (error) { release(); throw error; }
    };
    const value = Reflect.get(object, property);
    return typeof value === "function" ? value.bind(object) : value;
  } });
}
export function guardSqliteAdapter(factory: PrismaBunSqlite): PrismaBunSqlite {
  return new Proxy(factory, { get(target, property) {
    if (property === "connect") return async () => {
      const adapter = await target.connect();
      if (!(adapter instanceof BunSqliteAdapter)) throw new Error("Unsupported Bun SQLite adapter implementation");
      return guardConnection(adapter);
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
