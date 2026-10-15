import type { SourceAdapter, SourceItem } from "@chrona/contracts/steward";

/** Append-only, process-local test log. Cursors are exclusive sequence offsets. */
export function createLocalTestSource() {
  const items: SourceItem[] = [];
  const failures: unknown[] = [];
  const adapter: SourceAdapter = {
    kind: "local_test",
    mode: "poll",
    coverageNote: "LOCAL TEST DATA only; in-memory polling, not a real account. Lost on restart.",
    async readiness() { return { state: "ready" }; },
    async poll(_connection, cursor) {
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
        nextCursor: items.length ? String(items.length) : cursor,
      };
    },
  };
  return {
    adapter,
    push(batch: readonly SourceItem[]) { items.push(...batch.map((item) => ({ ...item }))); },
    failNext(error: unknown) { failures.push(error); },
  };
}
