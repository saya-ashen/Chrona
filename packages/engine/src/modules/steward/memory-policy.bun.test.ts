import { expect, test } from "bun:test";
import { conversationMemory, type ConversationSnapshot } from "./external/memory-local/conversation";

const snapshot = (count: number, options: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  session: { id: "s", source: "entry" }, now: "2026-11-07T12:00:00.000Z", ending: false, autoRecall: true, autoRetain: true, recalled: false, retainedThrough: null,
  messages: Array.from({ length: count }, (_, i) => ({ direction: "in", text: `message ${i}`, at: `2026-11-07T11:0${i}:00.000Z` })), ...options,
});
test.each([[3, false, false], [4, false, true], [1, true, true], [0, true, false]] as const)("memory application retains %d messages ending=%p: %p", async (count, ending, expected) => {
  const writes: unknown[] = [], policy = conversationMemory({ recall: async () => ({ items: [] }), retain: async args => { writes.push(args); } });
  expect((await policy.retain(snapshot(count, { ending }))).retained).toBe(expected);
  expect(writes).toHaveLength(expected ? 1 : 0);
});
test("module policy honors disabled and consumed snapshots; recall uses its own bounded query", async () => {
  const queries: string[] = [], writes: unknown[] = [];
  const policy = conversationMemory({ recall: async args => { queries.push(args.query); return { items: [{ id: "memory", content: "past decision" }] }; }, retain: async args => { writes.push(args); } });
  expect((await policy.context(snapshot(4))).text).toContain("past decision");
  expect((await policy.context(snapshot(4, { recalled: true }))).recalled).toBe(false);
  expect((await policy.context(snapshot(4, { autoRecall: false }))).recalled).toBe(false);
  expect(queries).toEqual(["message 0\nmessage 1\nmessage 2\nmessage 3"]);
  expect((await policy.retain(snapshot(4, { autoRetain: false }))).retained).toBe(false);
  expect((await policy.retain(snapshot(4, { retainedThrough: "2026-11-07T11:03:00.000Z" }))).retained).toBe(false);
  expect(writes).toHaveLength(0);
});
