import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { installationId, installExternal } from "./module-install";
import { callSync, enqueueCall, runDueCalls } from "./module-calls";
import { drainSchedules } from "./schedule-delivery";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const now = new Date("2026-10-22T12:00:00Z");
const source = resolve(import.meta.dirname, "external/remind");
const retainedFiles = ["module.json", "index.ts", "test.ts", "page.ts", "activation-harness.ts", "package.json", "bun.lock", "reminders.ts", "rules.ts", "reminders.test.ts", "reminders.bun.test.ts"];
const paused = { code: "unavailable", reason: "module_paused" };
let db: ReturnType<typeof testDb>, ports: StewardPorts, resources: string;
let installerCalls: number, processStarts: number;
let manifest: Record<string, string | boolean | object>;
const origin = { workspaceId: "w", caller: { kind: "owner", via: null }, chain: [], path: [] } as const;
beforeEach(async () => {
  db = testDb();
  await db.workspace.create({ data: { id: "w", name: "Paused reminders" } });
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-remind-paused-"));
  resources = join(dataDir, "resources/external");
  await cp(source, join(resources, "remind"), { recursive: true });
  manifest = JSON.parse(await readFile(join(resources, "remind/module.json"), "utf8"));
  installerCalls = 0;
  processStarts = 0;
  ports = {
    db, dataDir, now: () => now, publicUrl: null, moduleExternalResources: resources,
    moduleExternalInstaller: async () => { installerCalls++; throw new Error("Paused remind reached installer"); },
    sandbox: { available: true, isolated: false, startModule: () => { processStarts++; throw new Error("Paused remind started a process"); }, runModule: async () => { processStarts++; throw new Error("Paused remind ran author tests"); } },
  };
});
afterEach(async () => {
  await db.$disconnect();
  await rm(ports.dataDir, { recursive: true, force: true });
});
async function retainedModule() {
  const module = await db.module.create({ data: { workspaceId: "w", name: "remind", builtin: false, status: "active", activeHash: "a".repeat(64) } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: module.activeHash!, status: "approved", source: "user", manifest, intent: {}, report: {} } });
  return module;
}
async function expectSourcesRetained() {
  for (const file of retainedFiles) expect(await readFile(join(resources, "remind", file))).toEqual(await readFile(join(source, file)));
  expect(installerCalls).toBe(0);
  expect(processStarts).toBe(0);
}
async function expectNoExecution() {
  expect(await db.moduleRun.count()).toBe(0);
  expect(await db.moduleCall.count()).toBe(0);
  expect(await db.run.count()).toBe(0);
  expect(await db.message.count()).toBe(0);
  expect(await db.approval.count()).toBe(0);
  await expectSourcesRetained();
}

test.each(["install", "update"] as const)("external remind %s is gated before proposals, checks or source changes", async mode => {
  const module = mode === "update" ? await retainedModule() : null;
  // Source compatibility does not grant installation authority to a paused application.
  expect(manifest).not.toHaveProperty("triggers");
  expect(moduleManifestSchema.safeParse(manifest).success).toBe(true);
  await expect(installExternal(ports, "w", { package: "remind", mode, requestKey: `paused-${mode}` })).rejects.toMatchObject(paused);
  expect(await db.module.count()).toBe(module ? 1 : 0);
  expect(await db.moduleVersion.count()).toBe(module ? 1 : 0);
  if (module) expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toEqual(module);
  expect(await db.moduleInstallationSubmission.count()).toBe(0);
  expect(await db.audit.count({ where: { kind: "module_proposed" } })).toBe(0);
  await expectNoExecution();
});

test.each(["pending", "building", "installed"] as const)("replaying a retained %s install receipt reports paused without resubmission", async status => {
  const module = await retainedModule();
  const request = { package: "remind", mode: "install", requestKey: `retained-${status}` } as const;
  const result = { package: "remind", requestKey: request.requestKey, status, moduleId: module.id, hash: module.activeHash, approvalId: null, error: null };
  const id = installationId("w", request.requestKey);
  await db.moduleInstallation.create({ data: { id, workspaceId: "w", ...request, status: result.status, moduleId: result.moduleId, hash: result.hash, approvalId: result.approvalId } });
  const unavailable = await installExternal(ports, "w", request);
  expect(unavailable).toMatchObject({ ...result, status: "unavailable", error: paused });
  expect(await installExternal(ports, "w", request)).toEqual(unavailable);
  expect(await db.moduleInstallation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "unavailable", errorReason: unavailable.error?.reason });
  expect(await db.moduleInstallation.count()).toBe(1);
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toEqual(module);
  expect((await db.moduleVersion.findFirstOrThrow()).manifest).toEqual(manifest);
  await expectNoExecution();
});

test("retained approved remind cannot receive synchronous or newly queued owner calls", async () => {
  const module = await retainedModule();
  for (const [tool, args] of [["create", { rule: JSON.stringify({ kind: "at", at: now.toISOString() }), text: "喝水", label: "Drink water" }], ["list", {}], ["cancel", { key: "old-reminder" }]] as const) {
    await expect(callSync(ports, { ...origin, chain: [], path: [] }, `remind.${tool}`, args)).rejects.toMatchObject(paused);
    await expect(db.$transaction(tx => enqueueCall({ tx, ports, origin: { ...origin, chain: [], path: [] }, target: `remind.${tool}`, raw: args }, { key: `paused-${tool}` }))).rejects.toMatchObject(paused);
  }
  expect(await db.moduleInvocation.count()).toBe(0);
  expect(await db.schedule.count()).toBe(0);
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toEqual(module);
  await expectNoExecution();
});

test("due private reminder rows stay inert and an old async call backs off without dispatch", async () => {
  const module = await retainedModule();
  const timer = await db.schedule.create({ data: { workspaceId: "w", moduleId: module.id, mode: "module", rule: { kind: "at", at: now.toISOString() }, text: "retained-reminder", label: "Retained reminder", payload: { text: "喝水" }, createdBy: "user", nextAt: now } });
  const api = createStewardService(ports).forWorkspace("w");
  expect(api).not.toHaveProperty("schedules");
  // These drains settle recorded deliveries; a retained timer is not a calendar producer.
  await drainSchedules(ports, "w");
  expect(await runDueCalls(ports, "w")).toBe(0);
  expect(await db.moduleInvocation.count()).toBe(0);
  expect(await db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toEqual(timer);
  const queued = await db.moduleInvocation.create({ data: { workspaceId: "w", caller: "owner", target: "remind", tool: "create", mode: "async", key: "retained-call", args: { text: "喝水" }, idempotent: true, nextAttemptAt: now } });
  expect(await runDueCalls(ports, "w")).toBe(1);
  const deferred = await db.moduleInvocation.findUniqueOrThrow({ where: { id: queued.id } });
  expect(deferred).toMatchObject({ status: "queued", attempts: 1, nextAttemptAt: new Date(now.getTime() + 30_000), leaseToken: null, leaseUntil: null, finishedAt: null });
  expect(deferred.error).toContain("Module remind is unavailable");
  expect(await runDueCalls(ports, "w")).toBe(0);
  await drainSchedules(ports, "w");
  expect(await db.moduleInvocation.count()).toBe(1);
  expect(await db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toEqual(timer);
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toEqual(module);
  await expectNoExecution();
});
