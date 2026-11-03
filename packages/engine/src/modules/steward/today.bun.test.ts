import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { entryConversations, memory } from "./memory";
import { createToday } from "./today";
import type { StewardPorts } from "./ports";
import { startOwnerBuildAsCaller } from "./owner-build";

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
