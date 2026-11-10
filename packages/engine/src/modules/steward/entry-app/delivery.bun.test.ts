import { expect, test } from "bun:test";
import { captureApplicationDelivery, reconcileApplicationDelivery, type ApplicationDelivery } from "./delivery";

import { receiptFixture, receiptEvent, healthFixture } from "./delivery-fixture";

for (const mode of ["prose", "wrong-tool", "error", "filtered", "omitted", "other-run", "other-module", "other-version", "not-selected", "invalid-receipt"] as const) test(`delivery requires bound complete persisted result: ${mode}`, () => {
  const item = receiptEvent(), result = item.payload.value;
  const turn = { runId: "run-1", runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  if (mode === "prose") item.kind = "text";
  if (mode === "wrong-tool") result.target = "unrelated.submit";
  if (mode === "error") result.status = "failed";
  if (mode === "filtered") result.outputState = "filtered";
  if (mode === "omitted") result.outputState = "omitted";
  if (mode === "other-run") result.runId = "run-2";
  if (mode === "other-module") result.moduleId = "reinstalled-author";
  if (mode === "other-version") result.hash = "e".repeat(40);
  if (mode === "not-selected") turn.runRequest.tools = [];
  if (mode === "invalid-receipt") result.output.members = [];
  captureApplicationDelivery(turn, [item]);
  expect(turn.applicationDelivery).toEqual([]);
});

test("exact tool results deduplicate and bound receipts, targets and current checks", async () => {
  const turn = { runId: "run-1", runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptEvent(), receiptEvent()]);
  expect(turn.applicationDelivery).toHaveLength(1);
  captureApplicationDelivery(turn, Array.from({ length: 7 }, (_, index) => ({ ...receiptEvent(), payload: { type: "tool-result", value: { ...receiptEvent().payload.value, output: { ...receiptFixture(), receiptId: `other-${index}` } } } })));
  expect(turn.applicationDelivery).toHaveLength(4);
  const calls: string[] = [];
  await reconcileApplicationDelivery(async target => { calls.push(target); throw new Error("denied"); }, turn.applicationDelivery, "2026-11-09T00:00:04.000Z");
  expect(new Set(calls)).toEqual(new Set(["modules.health", "modules.candidate-check"]));
  expect(turn.applicationDelivery[0]).toMatchObject({ receiptCheck: "unknown", browser: "unknown", targets: [{ activation: "unknown", health: "unknown", pagesCheck: "unknown", pages: [] }] });
});

test("receipt checks cannot replace immutable targets and pages require the exact active hash", async () => {
  const turn = { runId: "run-1", runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptEvent()]);
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
  const turn = { runId: "run-1", runRequest: { tools: ["author.submit"] }, applicationDelivery: [] as ApplicationDelivery[] };
  captureApplicationDelivery(turn, [receiptEvent()]);
  await reconcileApplicationDelivery(async target => target === "modules.health" ? { items: [{ ...healthFixture(), ...change }], nextCursor: null } : receiptFixture(), turn.applicationDelivery, "2026-11-09T00:00:04.000Z");
  expect(turn.applicationDelivery[0]!.targets[0]).toMatchObject({ activation, health, pages: [], pagesCheck: "unknown" });
  expect(turn.applicationDelivery[0]!.browser).toBe("unknown");
});
