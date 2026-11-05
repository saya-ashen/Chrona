import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { entryConversations, memory } from "./memory";
import { createToday, workspaceToday } from "./today";
import { moduleContext } from "./module-context";
import { recordModuleActivation } from "./module-evolution";
import { recordModuleFailure, recordModuleRecovery, recordModuleOutputMismatch } from "./module-diagnostics";
import type { StewardPorts } from "./ports";
import { startOwnerBuildAsCaller } from "./owner-build";

async function healthFixture() {
  const db = testDb(), workspaceId = (await db.workspace.create({ data: { name: "today health" } })).id;
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date("2026-10-27T04:00:00Z"), publicUrl: null };
  async function app(name: string, workspace = workspaceId) {
    const module = await db.module.create({ data: { workspaceId: workspace, name, activeHash: "h" } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [] });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "h", manifest, source: "builtin", status: "approved", intent: {}, report: {} } });
    const activation = await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspace), tx, { moduleId: module.id, previousHash: null, hash: "h", generationId: "fixture" }));
    return { workspaceId: workspace, moduleId: module.id, activationId: activation.activationId, hash: "h" };
  }
  const fail = (input: Awaited<ReturnType<typeof app>>) => recordModuleFailure(db, { ...input, now: ports.now(), retry: false,
    evidence: { phase: "event", reason: "Disconnected", triggerId: "tool:fetch", runId: "r", delivery: "lost", pid: null, exitCode: null, signal: null, stderr: "", virtualMemoryMb: null } });
  return { db, workspaceId, ports, app, fail };
}

test("today problems share current health facts, exclude recovered and other workspaces, and stay read-only", async () => {
  const f = await healthFixture();
  try {
    const unresolved = await f.app("unresolved"), mismatch = await f.app("mismatch"), recovered = await f.app("recovered");
    await f.fail(unresolved); await f.fail(recovered);
    await recordModuleRecovery(f.ports, { ...recovered, triggerId: "tool:fetch", runId: "success" });
    await recordModuleOutputMismatch(f.db, { ...mismatch, tool: "fetch", callId: "call", issues: ["result"], now: f.ports.now() });
    const foreign = (await f.db.workspace.create({ data: { name: "foreign" } })).id;
    await f.fail(await f.app("foreign", foreign));
    const before = await f.db.audit.count();
    const problems = (await workspaceToday(f.ports, f.workspaceId).get()).problems;
    expect(problems).toEqual([
      { module: "unresolved", moduleId: unresolved.moduleId, incidentStatus: "unresolved", contractFailures: 0, nextAction: expect.any(String), since: f.ports.now().toISOString() },
      { module: "mismatch", moduleId: mismatch.moduleId, incidentStatus: null, contractFailures: 1, nextAction: null, since: null },
    ]);
    expect(await f.db.audit.count()).toBe(before);
  } finally { await f.db.$disconnect(); }
});

test("today upcoming excludes static polling before the limit, keeping runtime timers and wakes", async () => {
  const f = await healthFixture();
  try {
    const module = await f.app("calendar");
    const at = f.ports.now(), nextAt = new Date(at.getTime() + 60_000);
    for (let i = 0; i < 51; i++) await f.db.schedule.create({ data: { workspaceId: f.workspaceId, moduleId: module.moduleId, mode: "module", triggerId: `poll-${i}`, text: "poll", label: "轮询", rule: { kind: "every", minutes: 15 }, nextAt, createdBy: "chrona" } });
    for (const [mode, label, payload] of [["module", "申请截止前两天", {}], ["wake", "准备申请", undefined]] as const) {
      await f.db.schedule.create({ data: { workspaceId: f.workspaceId, moduleId: mode === "module" ? module.moduleId : null, mode, text: label, label, ...(payload ? { payload } : {}), rule: { kind: "at", at: new Date(at.getTime() + 120_000).toISOString() }, nextAt: new Date(at.getTime() + 120_000), createdBy: "chrona" } });
    }
    const view = await workspaceToday(f.ports, f.workspaceId).get();
    expect(view.upcoming.map(item => [item.mode, item.label])).toEqual([["module", "申请截止前两天"], ["wake", "准备申请"]]);
  } finally { await f.db.$disconnect(); }
});

test("today tolerates a failed optional health facts read", async () => {
  const f = await healthFixture();
  try {
    const today = createToday({ ...f.ports, workspaceId: f.workspaceId }, {
      provider: async () => ({ name: "unconfigured", available: false, sandboxed: false, lastError: null }), moduleSandbox: () => false,
      notifications: { list: async () => [], status: async () => null },
    }, async () => [], async () => { throw new Error("health read failed"); });
    expect((await today.get()).problems).toEqual([]);
  } finally { await f.db.$disconnect(); }
});

test("conversation views and memory admission recognize entry manifests, not built-in names", async () => {
  const db = testDb(), workspaceId = (await db.workspace.create({ data: { name: "entries" } })).id;
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date(), publicUrl: null };
  const included: string[] = [];
  try {
    for (const [name, uses, entry] of [
      ["new-entry", ["chat.send", "memory.status"], true],
      ["agent-entry", ["*"], true],
      ["approval-entry", ["approvals.resolve", "memory.status"], true],
      ["web", ["approvals.request", "memory.status"], false],
      ["qq", ["notify.send", "memory.status"], false],
      ["mcp", ["memory.status"], false],
    ] as const) {
      const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: [...uses], tests: ["test.ts"] });
      const module = await db.module.create({ data: { workspaceId, name, activeHash: "h" } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: "h", manifest, status: "approved", source: "builtin", intent: {}, report: {} } });
      // The source contract still has legacy labels; the entryModuleId is authoritative.
      const session = await db.session.create({ data: { workspaceId, key: `${name}:test`, source: "web", entryModuleId: module.id } });
      if (entry) included.push(session.id);
      const result = memory.handle({ ports, workspaceId, caller: { kind: "module", module: name, moduleId: module.id, hash: "h" } }, "status", {});
      if (entry) expect(await result).toMatchObject({ available: false });
      else await expect(result).rejects.toMatchObject({ code: "forbidden" });
      // Invalid build input reaches validation only for entries, irrespective of their names.
      const build = startOwnerBuildAsCaller(ports, workspaceId, { kind: "module", module: name, moduleId: module.id, hash: "h" }, {});
      await expect(build).rejects.toMatchObject(entry ? { name: "ZodError" } : { code: "forbidden" });
    }
    await expect(startOwnerBuildAsCaller(ports, workspaceId, { kind: "owner", via: null }, {})).rejects.toMatchObject({ name: "ZodError" });
    await db.session.create({ data: { workspaceId, key: "old", source: "web" } });
    await db.session.create({ data: { workspaceId, key: "build", source: "build" } });
    expect((await db.session.findMany({ where: { workspaceId, ...await entryConversations(db, workspaceId) } })).map(row => row.id).sort()).toEqual(included.sort());
    const today = createToday({ db, workspaceId, now: ports.now }, {
      provider: async () => ({ name: "unconfigured", available: false, sandboxed: false, lastError: null }), moduleSandbox: () => false,
      notifications: { list: async () => [], status: async () => null },
    });
    expect((await today.get()).sessions.map(row => row.id).sort()).toEqual(included.sort());
  } finally { await db.$disconnect(); }
});
