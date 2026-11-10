import { expect, test } from "bun:test";
import { captureApplicationDelivery, reconcileApplicationDelivery, type ApplicationDelivery } from "./delivery";

import { receiptFixture, receiptItem, healthFixture } from "./delivery-fixture";

for (const mode of ["prose", "wrong-tool", "error", "truncated", "old", "baseline", "not-selected", "invalid-receipt"] as const) test(`delivery requires current actual complete result: ${mode}`, () => {
  const item = receiptItem();
  const turn = { at: "2026-11-09T00:00:02.000Z", baseline: [] as typeof item[], runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  if (mode === "prose") item.kind = "text";
  if (mode === "wrong-tool") item.tool = "m_unrelated_submit";
  if (mode === "error") item.error = true;
  if (mode === "truncated") item.text = item.text.slice(0, -1);
  if (mode === "old") item.at = "2026-11-09T00:00:01.000Z";
  if (mode === "baseline") turn.baseline = [item];
  if (mode === "not-selected") turn.runRequest.tools = [];
  if (mode === "invalid-receipt") item.text = JSON.stringify({ result: { ...receiptFixture(), members: [{ name: "music", moduleId: "music-id" }] } });
  captureApplicationDelivery(turn, [item]);
  expect(turn.applicationDelivery).toEqual([]);
});

test("exact tool results deduplicate and bound receipts, targets and current checks", async () => {
  const turn = { at: "2026-11-09T00:00:02.000Z", baseline: [], runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptItem(), receiptItem()]);
  expect(turn.applicationDelivery).toHaveLength(1);
  captureApplicationDelivery(turn, Array.from({ length: 7 }, (_, index) => ({ ...receiptItem(), text: JSON.stringify({ result: { ...receiptFixture(), receiptId: `other-${index}` } }) })));
  expect(turn.applicationDelivery).toHaveLength(4);
  const calls: string[] = [];
  await reconcileApplicationDelivery(async target => { calls.push(target); throw new Error("denied"); }, turn.applicationDelivery, "2026-11-09T00:00:04.000Z");
  expect(new Set(calls)).toEqual(new Set(["modules.health", "modules.candidate-check"]));
  expect(turn.applicationDelivery[0]).toMatchObject({ receiptCheck: "unknown", browser: "unknown", targets: [{ activation: "unknown", health: "unknown", pagesCheck: "unknown", pages: [] }] });
});

test("receipt checks cannot replace immutable targets and pages require the exact active hash", async () => {
  const turn = { at: "2026-11-09T00:00:02.000Z", baseline: [], runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptItem()]);
  const call = async (target: string) => target === "modules.health" ? { items: [healthFixture()], nextCursor: null } : { ...receiptFixture(), members: [{ ...receiptFixture().members[0], hash: "d".repeat(40) }] };
  const pages = [{ module: "music", moduleId: "music-id", hash: "d".repeat(40), id: "home", title: "Music" }, { module: "other", moduleId: "other-id", hash: "b".repeat(40), id: "home", title: "Other" }];
  await reconcileApplicationDelivery(call, turn.applicationDelivery, "2026-11-09T00:00:04.000Z", async () => pages);
  expect(turn.applicationDelivery[0]).toMatchObject({ receiptCheck: "unknown", targets: [{ hash: "b".repeat(40), activation: "active", health: "observed", pages: [] }], browser: "unknown" });
  pages.push({ module: "music", moduleId: "music-id", hash: "b".repeat(40), id: "home", title: "Music" });
  await reconcileApplicationDelivery(call, turn.applicationDelivery, "2026-11-09T00:00:06.000Z", async () => pages);
  expect(turn.applicationDelivery[0]!.targets[0]!.pages).toEqual([{ id: "home", title: "Music", href: "/p/music/home" }]);
});

for (const [change, activation, health] of [
  [{}, "active", "observed"],
  [{ runtime: { state: "running" } }, "active", "observed"],
  [{ runtime: { state: "unobserved" } }, "active", "unknown"],
  [{ runtime: { state: "starting" } }, "active", "unknown"],
  [{ truncated: true }, "active", "unknown"],
  [{ open: true, truncated: true }, "active", "issue"],
  [{ runtime: { state: "backoff" } }, "active", "issue"],
  [{ configuredStatus: "paused" }, "inactive", "unknown"],
  [{ activeHash: null }, "inactive", "unknown"],
  [{ activeHash: "d".repeat(40) }, "different", "unknown"],
  [{ moduleId: "unrelated-id" }, "unknown", "unknown"],
] as const) test(`current delivery observation: ${JSON.stringify(change)}`, async () => {
  const turn = { at: "2026-11-09T00:00:02.000Z", baseline: [], runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptItem()]);
  await reconcileApplicationDelivery(async target => target === "modules.health" ? { items: [{ ...healthFixture(), ...change }], nextCursor: null } : receiptFixture(), turn.applicationDelivery, "2026-11-09T00:00:04.000Z");
  expect(turn.applicationDelivery[0]!.targets[0]).toMatchObject({ activation, health, pages: [], pagesCheck: "unknown" });
  expect(turn.applicationDelivery[0]!.browser).toBe("unknown");
});
