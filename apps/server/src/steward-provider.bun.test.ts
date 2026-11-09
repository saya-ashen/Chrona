import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { testReleaseRuntimeChecks } from "../../../packages/engine/src/modules/steward/module-release-test-fixture";
import type { ProviderAnswer, ProviderRunView } from "@chrona/contracts";
import { queueBuild } from "../../../packages/engine/src/modules/steward/module-build-session";
let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>;
let workspaceId: string;
let answers: ProviderAnswer[];
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "owner" } })).id; answers = [];
  ports = { db, ...testReleaseRuntimeChecks(), now: () => new Date(), dataDir: await mkdtemp(join(tmpdir(), "chrona-provider-api-")), publicUrl: null,
    provider: { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start(input) {
      const controller = new AbortController();
      const done = (async () => {
        await input.events!.progress({ phase: "reading", tool: "read" });
        answers.push(await input.events!.question({ method: "confirm", title: "Fixture permission", message: "Only this attempt", options: [], timeoutMs: 1000 }, controller.signal));
        return { outcome: "finished" as const, sessionId: null, error: null };
      })();
      return { done, inject: async () => {}, abort: async () => { controller.abort(); await done; } };
    } } };
  service = createStewardService(ports);
  await queueBuild(ports, workspaceId, { key: "provider-fixture", actorKey: "owner", originSessionId: null,
    request: { name: "fixture-app", goal: "Fixture only", examples: [], files: [], intent: { changes: ["Fixture"], preserves: [] } } });

});
afterEach(async () => {
  for (const run of await db.run.findMany({ where: { status: { in: ["running", "queued"] } } })) await service.forWorkspace(workspaceId).provider.cancel(run.id);
  await db.$disconnect();
});
// Internal channel regression. Public Agent SDK question/control behavior is covered in agent-module-calls.
async function start() {
  await service.tick();
  for (let i = 0; i < 100; i++) {
    const run = (await service.forWorkspace(workspaceId).provider.list() as ProviderRunView[])[0];
    if (run?.interactions.length) return run; await Bun.sleep(5);
  }
  throw new Error("No Provider question");
}
const answer = (interaction: string, value: unknown) => service.forWorkspace(workspaceId).provider.answer(interaction, value);
async function finished(id: string) { for (let i = 0; i < 100; i++) { if ((await db.run.findUniqueOrThrow({ where: { id } })).status !== "running") return; await Bun.sleep(5); } throw new Error("Fixture run did not stop"); }
test("the user answers a running Provider's question through the internal channel: no approval or grant, invalid answers refused", async () => {
  const run = await start(), id = run.interactions[0]!.id;
  expect(answers).toEqual([]); expect(run.progress).toEqual({ phase: "reading", tool: "read" });
  await expect(answer(id, { decision: "submit", value: true, scope: "always" })).rejects.toMatchObject({ code: "invalid" });
  await expect(answer(id, "not json")).rejects.toMatchObject({ code: "invalid" });
  await answer(id, { decision: "submit", value: false });
  await finished(run.id); expect(answers).toEqual([{ decision: "submit", value: false }]);
  expect(await db.grant.count()).toBe(0); expect(await db.approval.count()).toBe(0);
  await expect(answer(id, { decision: "submit", value: true })).rejects.toMatchObject({ code: "conflict", message: "Provider interaction is no longer active" });
  expect(answers).toEqual([{ decision: "submit", value: false }]);
});
test("internal cancellation stops current work and closes its questions", async () => {
  const run = await start();
  await service.forWorkspace(workspaceId).provider.cancel(run.id); await finished(run.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0); expect(answers).toEqual([{ decision: "cancel" }]);
});
