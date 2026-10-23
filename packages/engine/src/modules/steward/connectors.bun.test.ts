import { expect, test } from "bun:test";
import { mkdtemp, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecrets } from "./secrets";
import { createStewardService } from "./service";
import { createLocalTestSource } from "../../../../integrations/src/steward/local-test-source";
import { testDb } from "./test-db";
import { filesContent } from "./content";
import { testFilesContent } from "./test-content";
import { RUN_LIMITS } from "@chrona/contracts/steward";

test("secrets atomic replacement, permissions, invalid paths and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-secret-")), secrets = createSecrets(root);
  await secrets.write("connector", { password: "private" });
  expect((await stat(join(root, "secrets"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, "secrets/connector.json"))).mode & 0o777).toBe(0o600);
  await secrets.write("connector", { password: "replacement" });
  expect(await secrets.read("connector")).toEqual({ password: "replacement" });
  await expect(secrets.write("../escape", {})).rejects.toThrow("Invalid connector id");
  await symlink(join(root, "secrets/connector.json"), join(root, "secrets/link.json"));
  await expect(secrets.read("link")).rejects.toThrow();
  await secrets.remove("connector"); expect(await secrets.read("connector")).toBeNull();
});

test("connector files, dedupe, all rules, batch first-arrival window, isolation and removal", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-inbound-"));
  let time = new Date("2026-10-15T04:00:00Z");
  const local = createLocalTestSource();
  const ports = { db, dataDir, now: () => time, publicUrl: null, chat: null, deliveries: [], connectors: [local.adapter] };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "test" } })).id;
    const api = createStewardService(ports).forWorkspace(workspaceId);
    await testFilesContent(ports, workspaceId);
    const files = await filesContent(ports, workspaceId);
    const connector = await api.connectors.create({ kind: "local_test", label: "mail", secret: { password: "never-expose" } });
    await files.intake([{ path: `inbox/${connector.id}/rules.json`, bytes: new TextEncoder().encode(JSON.stringify({ rules: ["ignore", "digest_only", "wake_now"].map(action => ({ match: { subject: action }, action, note: `note:${action}` })), default: "batch" })) }]);
    expect(connector.hasCredentials).toBe(true); expect(JSON.stringify(await api.connectors.list())).not.toContain("never-expose");
    expect(connector).not.toHaveProperty("secretRef");
    await expect(api.connectors.create({ kind: "local_test", label: "bad", settings: { password: "leak" } })).rejects.toThrow();
    const push = (id: string) => local.push([{ externalId: id, from: "sender", subject: id, body: "plain text", receivedAt: time.toISOString(), url: null, attachments: [{ name: "bad.exe", mime: "application/octet-stream", bytes: new Uint8Array([1]) }] }]);
    push("ignore"); push("digest_only");
    await api.connectors.sync(connector.id);
    expect(await db.run.count()).toBe(0);
    expect((await api.connectors.items(connector.id)).map(i => i.status).sort()).toEqual(["delivered", "ignored"]);
    push("batch-first"); await api.connectors.sync(connector.id);
    time = new Date(time.getTime() + RUN_LIMITS.inboundBatchWindowMs - 1);
    push("batch-second"); await api.connectors.sync(connector.id);
    await api.connectors.flush(connector.id); expect(await db.run.count()).toBe(0);
    time = new Date(time.getTime() + 1); await api.connectors.flush(connector.id);
    expect(await db.run.count()).toBe(1);
    const run = await db.run.findFirstOrThrow(); expect(run.prompt).toContain("batch-first"); expect(run.prompt).toContain("batch-second");
    push("wake_now"); await api.connectors.sync(connector.id); expect(await db.run.count()).toBe(2);
    push("wake_now"); await api.connectors.sync(connector.id); expect(await db.inboundItem.count()).toBe(5);
    const items = await api.connectors.items(connector.id);
    for (const item of items) expect((await files.read(item.ref!.slice("files/".length))).content).toContain("plain text");
    expect((await files.list()).some(f => f.path.includes("attachment"))).toBe(false);
    for (let i = 0; i < RUN_LIMITS.maxItemsPerBatch; i++) push(`batch-${i}`);
    await api.connectors.sync(connector.id); expect(await db.run.count()).toBe(3);
    local.failNext(Object.assign(new Error("never-expose"), { code: "AUTHENTICATION_FAILED" }));
    await expect(api.connectors.sync(connector.id)).rejects.toThrow("Connector authorization required");
    expect((await api.connectors.list())[0]!.status).toBe("needs_authorization");
    expect(JSON.stringify(await api.connectors.list())).not.toContain("never-expose");
    const other = (await db.workspace.create({ data: { name: "other" } })).id;
    await expect(createStewardService(ports).forWorkspace(other).connectors.items(connector.id)).rejects.toThrow();
    await api.connectors.remove(connector.id); expect(await createSecrets(dataDir).read(connector.id)).toBeNull();
  } finally { await db.$disconnect(); }
});
