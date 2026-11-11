import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { callSync, registerSystemModule, type Caller } from "./module-calls";
import type { StewardPorts } from "./ports";
import { createSecrets } from "./secrets";
import { secrets } from "./system/secrets";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(name: string) {
  registerSystemModule(secrets);
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-secret-claims-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "secrets" } })).id;
  const manifest = moduleManifestSchema.parse({ name: "consumer", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], secrets: [name] });
  const module = await db.module.create({ data: { workspaceId, name: manifest.name, activeHash: "v1" } });
  const where = { moduleId_hash: { moduleId: module.id, hash: "v1" } };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
  const caller: Extract<Caller, { kind: "module" }> = { kind: "module", moduleId: module.id, module: manifest.name, hash: "v1" };
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null };
  const direct = (identity: Caller = caller, tool = "get", args: Record<string, unknown> = { name }, workspace = workspaceId) => secrets.handle({ ports, workspaceId: workspace, caller: identity }, tool, args).then(value => tool === "list" ? (value as { items: unknown }).items : value);
  const routed = (tool = "get", args: Record<string, unknown> = { name }, identity: Caller = caller) => callSync(ports, { workspaceId, caller: identity, chain: [], path: [] }, `secrets.${tool}`, args);
  return { db, ports, dataDir, workspaceId, module, manifest, where, caller, direct, routed, store: createSecrets(dataDir) };
}

for (const name of ["qq_bot", "other_service"]) {
  test(`${name}: approved declarations read host defaults, saved values win, and list reads presence only`, async () => {
    const f = await fixture(name), hostReads: string[] = [];
    f.ports.secrets = async key => { hostReads.push(key); return { appId: "host-id", clientSecret: "host-private" }; };
    f.ports.secretConfigured = async key => key === name;
    const owner: Caller = { kind: "owner", via: null };
    expect(await f.direct(owner, "list", {})).toEqual([{ name, configured: true, updatedAt: null, modules: ["consumer"] }]);
    expect(hostReads).toEqual([]);
    expect((await f.routed()).output).toEqual({ value: { appId: "host-id", clientSecret: "host-private" } });
    expect(hostReads).toEqual([name]);
    await f.routed("set", { name, value: { appId: "saved-id", clientSecret: "saved-private" } }, owner);
    expect((await f.routed()).output).toEqual({ value: { appId: "saved-id", clientSecret: "saved-private" } });
    expect(hostReads).toEqual([name]);
    await f.routed("remove", { name }, owner);
    expect((await f.routed()).output).toEqual({ value: { appId: "host-id", clientSecret: "host-private" } });
    await expect(f.routed("get", { name: "undeclared" })).rejects.toMatchObject({ code: "forbidden" });
    expect(hostReads).toEqual([name, name]);
    const records = JSON.stringify([await f.db.moduleInvocation.findMany(), await f.db.moduleCall.findMany(), await f.db.audit.findMany()]);
    for (const value of ["host-private", "saved-private"]) expect(records).not.toContain(value);
  });

  test(`${name}: declarations bind to workspace, module identity, active hash and approved parsed manifest`, async () => {
    const f = await fixture(name);
    let hostReads = 0;
    f.ports.secrets = async () => { hostReads++; return { key: "private" }; };
    const elsewhere = (await f.db.workspace.create({ data: { name: "elsewhere" } })).id;
    await expect(f.direct(f.caller, "get", { name }, elsewhere)).rejects.toMatchObject({ code: "forbidden" });
    for (const identity of [
      { ...f.caller, moduleId: "missing" }, { ...f.caller, module: "forged" }, { ...f.caller, hash: "stale" },
      { kind: "owner", via: null }, { kind: "system", module: "consumer" }, { kind: "kernel" },
    ] satisfies Caller[]) await expect(f.direct(identity)).rejects.toMatchObject({ code: "forbidden" });
    for (const data of [{ status: "paused" }, { status: "failed" }, { status: "active", activeHash: "v2" }, { activeHash: null }]) {
      await f.db.module.update({ where: { id: f.module.id }, data });
      await expect(f.direct()).rejects.toMatchObject({ code: "forbidden" });
    }
    await f.db.module.update({ where: { id: f.module.id }, data: { status: "active", activeHash: "v1" } });
    await f.db.moduleVersion.update({ where: f.where, data: { status: "candidate" } });
    await expect(f.direct()).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.direct({ kind: "owner", via: null }, "list", {})).toEqual([]);
    for (const manifest of [{ name: "consumer", secrets: [name] }, { ...f.manifest, name: "forged" }, { ...f.manifest, secrets: [] }]) {
      await f.db.moduleVersion.update({ where: f.where, data: { status: "approved", manifest } });
      await expect(f.direct()).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(hostReads).toBe(0);
    await f.db.moduleVersion.update({ where: f.where, data: { manifest: f.manifest } });
    expect(await f.direct()).toEqual({ value: { key: "private" } });
  });
}

test("credential declarations and exact uses do not grant owner management authority", async () => {
  const f = await fixture("qq_bot");
  await f.db.moduleVersion.update({ where: f.where, data: { manifest: { ...f.manifest, uses: ["secrets.set", "secrets.list", "secrets.remove", "chat.send"], listen: "/" } } });
  const cases: [string, Record<string, unknown>][] = [["set", { name: "qq_bot", value: { key: "private" } }], ["remove", { name: "qq_bot" }], ["list", {}]];
  for (const [tool, args] of cases) {
    await expect(f.direct(f.caller, tool, args)).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.routed(tool, args)).rejects.toMatchObject({ code: "forbidden" });
  }
  await f.db.moduleVersion.update({ where: f.where, data: { manifest: { ...f.manifest, uses: ["*"],
      authority: "owner"
} } });
  await f.routed("set", { name: "qq_bot", value: { key: "private" } });
  expect((await f.routed()).output).toEqual({ value: { key: "private" } });
});

test("host failure is sanitized and unsafe saved files cannot fall through to host credentials", async () => {
  const f = await fixture("other_service");
  f.ports.secrets = async () => { throw new Error("host-secret-private"); };
  await expect(f.routed()).rejects.toMatchObject({ code: "unavailable", message: "Secret not configured" });
  expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain("host-secret-private");
  let hostReads = 0;
  f.ports.secrets = async () => { hostReads++; return { key: "private" }; };
  await f.store.write("other_service", { key: "saved" });
  await chmod(join(f.dataDir, "secrets", "other_service.json"), 0o644);
  await expect(f.routed()).rejects.toMatchObject({ code: "unavailable" });
  expect(hostReads).toBe(0);
});
