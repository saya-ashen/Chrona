import { expect, test } from "bun:test";
import type { SourceItem } from "@chrona/contracts/steward";
import { createLocalTestSource } from "./local-test-source";
import { createTestDelivery } from "./test-delivery";
const item: SourceItem = { externalId: "one", from: "test", subject: "Update", body: "Progress", url: null, receivedAt: "2026-10-13T12:00:00.000Z" };
test("local connector snapshots, exclusive cursors, transient failures", async () => {
  const source = createLocalTestSource();
  const poll = (cursor: string | null = null) => source.adapter.poll({ settings: {}, secret: null, cursor });
  expect(await source.adapter.test({}, null)).toEqual({ ok: true });
  expect(await poll()).toEqual({ items: [], cursor: null });
  const input = { ...item }; source.push([input]); input.body = "changed";
  const first = await poll(); expect(first.items).toEqual([item]);
  expect(await poll(first.cursor)).toEqual({ items: [], cursor: first.cursor });
  first.items[0]!.body = "changed"; expect((await poll()).items).toEqual([item]);
  source.failNext(new Error("test")); await expect(poll()).rejects.toThrow("test");
  for (const cursor of ["-1", "garbage", "1.5", "9", "01"]) await expect(poll(cursor)).rejects.toThrow("Invalid local test cursor");
});
test("test delivery idempotency", async () => {
  const delivery = createTestDelivery();
  const message = { idempotencyKey: "key", title: "Test", body: "Local only", link: null, recipient: null };
  const results = await Promise.all([delivery.adapter.send(message), delivery.adapter.send(message)]);
  expect(results[0]).toEqual(results[1]); expect(delivery.sent).toHaveLength(1);
});
