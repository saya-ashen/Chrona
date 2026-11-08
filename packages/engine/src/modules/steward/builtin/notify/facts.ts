import type { Store } from "./store";
import type { createNotify } from "./notify";

// Routed output is validated by Chrona. Private modules mirror only the finite consumer contract.
type Fact = { id: string; at: string; type: "notice" | "lifecycle" | "approval" | "withdraw" | "configure"; data: Record<string, unknown> };
type Page = { revision: string; facts: Fact[] };
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type Staged = { id: string; key: string | null };
const stagedKey = "kernel-facts:staged";
function noticeKey(fact: Fact) {
  if (fact.type === "approval") return `approval:${String(fact.data.approval)}`;
  return fact.type === "notice" || fact.type === "lifecycle" ? String(fact.data.key) : null;
}
/** Durably ingest before ACK; ACK before any delivery. Lost replies are recovered by fact identity. */
export async function ingestKernelFacts(store: Store, notify: ReturnType<typeof createNotify>, call: Call, now: Date) {
  // A bounded backlog pass never delivers ahead of an unread withdrawal on a later page.
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = await call("activity.facts", {}) as Page;
    const saved = store.get(stagedKey);
    if (saved) {
      const staged = JSON.parse(saved) as Staged[];
      await acknowledge(store, notify, call, { revision: page.revision, staged }, now);
      // Read again: ACK recovery may have consumed the same page.
      continue;
    }
    if (!page.facts.length) {
      await reconcileWithdrawals(store, notify, call, page.revision, now);
      return true;
    }
    const staged = page.facts.map(fact => ({ id: fact.id, key: noticeKey(fact) }));
    store.db.transaction(() => {
      for (const fact of page.facts) {
        const args = fact.type === "lifecycle" ? { ...fact.data, kind: (fact.data.fact as Record<string, unknown>).kind, app: (fact.data.fact as Record<string, unknown>).app, facts: JSON.stringify(fact.data.fact) } : fact.data;
        const result = notify.handle(fact.type === "notice" ? "send" : fact.type, args, { kind: "kernel" }, now) as Record<string, unknown>;
        if (result.error) throw new Error(`Kernel fact ingestion failed: ${String(result.error)}`);
      }
      store.set(stagedKey, JSON.stringify(staged));
    })();
    await acknowledge(store, notify, call, { revision: page.revision, staged }, now);
  }
  return false;
}
async function reconcileWithdrawals(store: Store, notify: ReturnType<typeof createNotify>, call: Call, revision: string, now: Date) {
  let cursor = "";
  for (;;) {
    const rows = store.rows("SELECT * FROM notifications WHERE status IN ('queued', 'folded') AND key > ? ORDER BY key LIMIT 100", cursor);
    if (!rows.length) return;
    const { withdrawn } = await call("activity.withdrawals", { revision, keys: rows.map(row => row.key) }) as { withdrawn: string[] };
    store.db.transaction(() => { for (const key of withdrawn) notify.handle("withdraw", { key }, { kind: "kernel" }, now); })();
    cursor = rows.at(-1)!.key;
  }
}
async function acknowledge(store: Store, notify: ReturnType<typeof createNotify>, call: Call, batch: { revision: string; staged: Staged[] }, now: Date) {
  const { revision, staged } = batch;
  const { acknowledged } = await call("activity.ack", { revision, ids: staged.map(fact => fact.id) }) as { acknowledged: string[] };
  const accepted = new Set(acknowledged);
  store.db.transaction(() => {
    // A different consumer may have accepted an unacknowledged fact while this app was paused.
    for (const fact of staged) if (!accepted.has(fact.id) && fact.key) notify.handle("withdraw", { key: fact.key }, { kind: "kernel" }, now);
    store.db.run("DELETE FROM kv WHERE key = ?", [stagedKey]);
  })();
}
