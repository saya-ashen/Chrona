import type { Store } from "./store";
import type { createNotify } from "./notify";

// Routed output is validated by Chrona. Private modules mirror only the finite consumer contract.
type LifecycleFact =
  | { kind: "module-paused" | "module-build-failed"; app: string }
  | { kind: "module-activated"; app: string; update: boolean; hash: string }
  | { kind: "module-update-rejected"; app: string; hash: string; activeHash: string; error: string }
  | { kind: "module-migration-failed"; app: string; restore: boolean }
  | { kind: "schedule-failed"; target: string; status: "failed" | "unknown"; error?: string | null; disconnected?: boolean }
  | { kind: "build-paused"; status: "failed" | "timed_out" | "provider_unavailable" };
type Fact = { id: string; at: string } & (
  | { type: "notice"; data: { key: string; kind: "provider-input-required"; run: string; session?: string } }
  | { type: "lifecycle"; data: { key: string; module?: string; session?: string; fact: LifecycleFact } }
  | { type: "approval"; data: { approval: string; title: string; action: string; detail: string; preview: string; module?: string } }
  | { type: "withdraw"; data: { key: string } }
);
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
    let page: Page;
    try { page = await call("activity.facts", {}) as Page; }
    catch (error) {
      // The consumer getter is owner-only. A denied read also covers null selection
      // and revoked caller identity; none of those permit private kernel delivery.
      if (error instanceof Error && "code" in error && error.code === "forbidden") return false;
      throw error;
    }
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
        // Notify owns delivery policy and wording, including the provider-input alert.
        const args = fact.type === "notice"
          ? { key: fact.data.key, session: fact.data.session, title: "处理需要你的输入", body: `运行 ${String(fact.data.run)} 正在等待输入，请打开会话查看并回答。`, level: "now", responds: true }
          : fact.type === "lifecycle" ? { ...fact.data, kind: fact.data.fact.kind, app: ("app" in fact.data.fact ? fact.data.fact.app : undefined), facts: JSON.stringify(fact.data.fact) } : fact.data;
        const result = notify.handle(fact.type === "notice" ? "send" : fact.type, args, { kind: "kernel" }, now) as Record<string, unknown>;
        if (result.error) throw new Error(`Kernel fact ingestion failed: ${String(result.error)}`);
      }
      store.set(stagedKey, JSON.stringify(staged));
    })();
    await acknowledge(store, notify, call, { revision: page.revision, staged }, now);
  }
  return false;
}
/** Ordinary delivery continues when facts are unavailable to this caller or the backlog is incomplete. */
export async function tickNotify(store: Store, notify: ReturnType<typeof createNotify>, call: Call, now: Date) {
  const kernelFactsReady = await ingestKernelFacts(store, notify, call, now);
  await notify.tick(now, kernelFactsReady);
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
