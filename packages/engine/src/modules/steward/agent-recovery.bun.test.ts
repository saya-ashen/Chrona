import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { runtimeOperationSchema, runtimeOutcomeSchema } from "@chrona/contracts/steward";
import { admitContextPrimitive } from "./agent-context";
import { reconcileAgentStops } from "./agent-recovery";
import { createRuns } from "./runs";
import { registerLocalModule } from "./module-registry";
import { tool } from "./system/shared";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test.each([false, true])("restart reconciles only a persisted stop receipt (confirmed=%s), never starts another Provider", async confirmed => {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-stop-recovery-");
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }), () => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "recovery" } });
  const application = await db.module.create({ data: { workspaceId: workspace.id, name: "entry", activeHash: "version" } });
  const principal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module" as const, moduleId: application.id, hash: "version" } };
  const ports = { db, dataDir, publicUrl: null, now: () => new Date() };
  const context = await admitContextPrimitive(ports, principal, "context", { requestKey: "context" }) as { contextId: string };
  await admitContextPrimitive(ports, principal, "run", { contextId: context.contextId, requestKey: "run", prompt: "offline", lane: "foreground", tools: [], content: [] });
  const runs = createRuns(ports, workspace.id), run = (await runs.claimNext("foreground"))!;
  await db.providerLaunch.create({ data: { runId: run.id, digest: "fixed" } });
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "disconnected" });
  await db.audit.deleteMany();
  const calls: string[] = [];
  registerLocalModule({ name: "agent", description: "receipt-only fixture", unrecorded: ["status"], tools: [tool("status", "Persisted stop receipt", {}, [], { input: runtimeOperationSchema, output: runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean() }), visibility: ["kernel"] })],
    async handle(_context, name, input) {
      calls.push(name);
      return { operationId: String(input.operationId), outcome: confirmed ? { outcome: "finished", sessionId: "continued", error: null } : null, failure: !confirmed };
    },
  }, db);
  await reconcileAgentStops(ports, workspace.id);
  expect(calls).toEqual(["status"]);
  expect(await db.run.count()).toBe(1);
  expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ stopStatus: confirmed ? "confirmed" : "unknown", status: confirmed ? "finished" : "failed" });
  if (confirmed) expect(await db.session.findUniqueOrThrow({ where: { id: context.contextId } })).toMatchObject({ providerSessionId: "continued" });
});
