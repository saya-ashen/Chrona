import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { builtinEntry, testDb } from "@chrona/engine/test-support";
import type { ProviderAnswer, ProviderRunView } from "@chrona/contracts";
let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>, web: Awaited<ReturnType<typeof builtinEntry>>;
let workspaceId: string, sessionId: string;
let answers: ProviderAnswer[];
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "owner" } })).id; answers = [];
  ports = { db, now: () => new Date(), dataDir: await mkdtemp(join(tmpdir(), "chrona-provider-api-")), publicUrl: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
      const controller = new AbortController();
      const done = (async () => {
        await input.events!.progress({ phase: "reading", tool: "read" });
        answers.push(await input.events!.question({ method: "confirm", title: "Fixture permission", message: "Only this attempt", options: [], timeoutMs: 1000 }, controller.signal));
        return { outcome: "finished" as const, sessionId: null, error: null };
      })();
      return { done, inject: async () => {}, abort: async () => { controller.abort(); await done; } };
    } } };
  service = createStewardService(ports); sessionId = (await db.session.create({ data: { workspaceId, key: "web:fixture", source: "web", title: "Fixture" } })).id;
  web = await builtinEntry(ports, workspaceId, "web");
});
afterEach(async () => {
  for (const run of await db.run.findMany({ where: { status: { in: ["running", "queued"] } } })) await service.forWorkspace(workspaceId).provider.cancel(run.id);
  await db.$disconnect();
});
// What the web page does: Provider runs and their questions through the chat system module (v2-9).
async function start() {
  await service.forWorkspace(workspaceId).runs.enqueue({ sessionId, lane: "background", trigger: "schedule", prompt: "Fixture only" }); await service.tick();
  for (let i = 0; i < 100; i++) {
    const run = (await web.call("chat.runs", {}) as ProviderRunView[])[0];
    if (run?.interactions.length) return run; await Bun.sleep(5);
  }
  throw new Error("No Provider question");
}
const answer = (interaction: string, value: unknown) => web.call("chat.answer", { interaction, answer: JSON.stringify(value) });
async function finished(id: string) { for (let i = 0; i < 100; i++) { if ((await db.run.findUniqueOrThrow({ where: { id } })).status !== "running") return; await Bun.sleep(5); } throw new Error("Fixture run did not stop"); }
test("the user answers a running Provider's question through chat.answer: no approval or grant, invalid answers refused", async () => {
  const run = await start(), id = run.interactions[0]!.id;
  expect(answers).toEqual([]); expect(run.progress).toEqual({ phase: "reading", tool: "read" });
  await expect(answer(id, { decision: "submit", value: true, scope: "always" })).rejects.toMatchObject({ code: "invalid" });
  await expect(web.call("chat.answer", { interaction: id, answer: "not json" })).rejects.toMatchObject({ code: "invalid" });
  await answer(id, { decision: "submit", value: false });
  await finished(run.id); expect(answers).toEqual([{ decision: "submit", value: false }]);
  expect(await db.grant.count()).toBe(0); expect(await db.approval.count()).toBe(0);
  await expect(answer(id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict", message: "Provider interaction is no longer active" });
  expect(answers).toEqual([{ decision: "submit", value: false }]);
});
test("chat.cancel stops current work and closes its questions", async () => {
  const run = await start();
  await web.call("chat.cancel", { run: run.id }); await finished(run.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0); expect(answers).toEqual([{ decision: "cancel" }]);
});
