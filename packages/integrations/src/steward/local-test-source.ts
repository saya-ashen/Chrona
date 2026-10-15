import type { ConnectorAdapter, SourceItem } from "@chrona/contracts/steward";

/** Append-only, process-local test log. Cursors are exclusive sequence offsets. */
export function createLocalTestSource() {
  const items: SourceItem[] = [];
  const failures: unknown[] = [];
  const adapter: ConnectorAdapter = {
    kind: "local_test",
    coverageNote: "LOCAL TEST DATA only; in-memory polling, not a real account. Lost on restart.",
    async test() { return { ok: true }; },
    async poll({ cursor }) {
      if (failures.length) throw failures.shift();
      if (cursor !== null && !/^(0|[1-9]\d*)$/.test(cursor)) {
        throw new Error("Invalid local test cursor");
      }
      const offset = cursor === null ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset > items.length) {
        throw new Error("Invalid local test cursor");
      }
      return {
        items: items.slice(offset).map((item) => ({ ...item })),
        cursor: items.length ? String(items.length) : cursor,
      };
    },
  };
  return {
    adapter,
    push(batch: readonly SourceItem[]) { items.push(...batch.map((item) => ({ ...item }))); },
    failNext(error: unknown) { failures.push(error); },
  };
}
