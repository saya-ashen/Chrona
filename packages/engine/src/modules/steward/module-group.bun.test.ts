import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleManifest, type SecretSpec } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import { onApproved } from "./module-activation";
import { moduleContext } from "./module-context";
import { recordGroupReview, requestGroup } from "./module-group";
import type { OAuthDefinition } from "./oauth-definition";
import { testDb } from "./test-db";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const oauth: OAuthDefinition = { provider: "google", authorizationUrl: "https://accounts.example.test/authorize", tokenUrl: "https://accounts.example.test/token", scopes: ["mail.read", "profile"], authorizationParams: { access_type: "offline", prompt: "consent" } };
const credential = (definition = oauth): SecretSpec => ({ name: "mail_account", label: "Mail account", fields: [], oauth: definition });
type Secrets = ModuleManifest["secrets"];
async function fixture(after: Secrets, before: Secrets = [credential()]) {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-group-oauth-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "group OAuth" } });
  const ports = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-08T12:00:00Z") };
  const context = moduleContext(ports, workspace.id), approvals = createApprovals(context);
  const session = await db.session.create({ data: { workspaceId: workspace.id, key: "build", source: "build" } });
  await db.buildTargets.create({ data: { sessionId: session.id, name: "alpha", modules: ["alpha", "beta"] } });
  const versions: { module: string; moduleId: string; hash: string }[] = [];
  for (const [index, name] of ["alpha", "beta"].entries()) {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: "a".repeat(64), dataSchema: 1 } });
    for (const [hash, secrets] of [["a".repeat(64), before], ["b".repeat(64), after]] as const) {
      const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], secrets: index === 1 ? secrets : [] });
      const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: hash.startsWith("a") ? "user" : "build", status: hash.startsWith("a") ? "approved" : "pending_review", intent: { changes: ["Update group member"], preserves: [] }, report: {} } });
      if (version.status === "pending_review") {
        await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { buildSessionId: session.id } });
        expect(await recordGroupReview(context, version, { prefix: name, suffix: "", codeDiff: "", detail: "credential review", needsMigration: false })).toBe(true);
      }
    }
    versions.push({ module: name, moduleId: module.id, hash: "b".repeat(64) });
  }
  return { db, context, approvals, versions,
    request: () => requestGroup(ports, workspace.id, session.id, versions.map(({ module, hash }) => ({ module, hash }))),
    activeHashes: async () => (await db.module.findMany({ orderBy: { name: "asc" } })).map(module => module.activeHash),
  };
}

const approvalCases: { name: string; before?: Secrets; after: Secrets }[] = [
  { name: "OAuth added to an existing secret", before: ["mail_account"], after: [credential()] },
  { name: "provider changed", after: [credential({ ...oauth, provider: "microsoft" })] },
  { name: "authorization URL changed", after: [credential({ ...oauth, authorizationUrl: "https://other.example.test/authorize" })] },
  { name: "token URL changed", after: [credential({ ...oauth, tokenUrl: "https://other.example.test/token" })] },
  { name: "scope added", after: [credential({ ...oauth, scopes: [...oauth.scopes, "mail.write"] })] },
  { name: "scope removed", after: [credential({ ...oauth, scopes: ["mail.read"] })] },
  { name: "multiple accounts enabled", after: [credential({ ...oauth, accounts: true })] },
  { name: "authorization parameters changed", after: [credential({ ...oauth, authorizationParams: { access_type: "offline", prompt: "select_account" } })] },
  { name: "authorization parameters removed", after: [credential({ ...oauth, authorizationParams: undefined })] },
  { name: "new secret name", after: [credential(), "other_account"] },
];
test.each(approvalCases)("group requires one approval when $name", async ({ before, after }) => {
  const f = await fixture(after, before), result = await f.request();
  expect(result.status).toBe("pending_approval");
  if (result.status !== "pending_approval") throw new Error("Expected credential approval");
  expect(await f.activeHashes()).toEqual(["a".repeat(64), "a".repeat(64)]);
  expect(await f.db.moduleVersion.count({ where: { status: "pending_review" } })).toBe(2);
  expect(await f.db.generation.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(1);
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } });
  expect(approval).toMatchObject({ action: "activate_module", status: "open", moduleId: null,
    payload: { kind: "activate_modules", versions: f.versions.map(({ moduleId, hash }) => ({ moduleId, hash })) } });
  await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  await onApproved(f.context, { workspaceId: f.context.workspaceId, approvalId: approval.id, payload: approval.payload });
  expect(await f.activeHashes()).toEqual(["b".repeat(64), "b".repeat(64)]);
  expect(await f.db.moduleVersion.count({ where: { status: "pending_review" } })).toBe(0);
  expect(await f.db.generation.count()).toBe(1);
  expect(await f.db.grant.count()).toBe(0);
});

const automaticCases: { name: string; after: Secrets }[] = [
  { name: "OAuth definition unchanged", after: [credential()] },
  { name: "scopes reordered and duplicated", after: [credential({ ...oauth, scopes: ["profile", "mail.read", "profile"] })] },
  { name: "authorization parameter keys reordered", after: [credential({ ...oauth, authorizationParams: { prompt: "consent", access_type: "offline" } })] },
  { name: "accounts explicitly false", after: [credential({ ...oauth, accounts: false })] },
  { name: "credential presentation changed", after: [{ ...credential(), label: "Renamed account", fields: [{ name: "clientId", label: "Client ID" }] }] },
  { name: "OAuth definition removed", after: ["mail_account"] },
  { name: "credential removed", after: [] },
];
test.each(automaticCases)("group automatically activates with $name", async ({ after }) => {
  const f = await fixture(after);
  expect(await f.request()).toEqual({ status: "approved" });
  expect(await f.activeHashes()).toEqual(["b".repeat(64), "b".repeat(64)]);
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.generation.count()).toBe(1);
});

test("OAuth group approval keeps exact approval binding and once-only scope", async () => {
  const f = await fixture([credential({ ...oauth, accounts: true })]), result = await f.request();
  if (result.status !== "pending_approval") throw new Error("Expected credential approval");
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } });
  const action = { workspaceId: f.context.workspaceId, approvalId: approval.id, payload: approval.payload };
  await expect(onApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  await expect(f.approvals.resolve(approval.id, { decision: "approve", scope: "always" })).rejects.toMatchObject({ code: "invalid" });
  await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  await expect(onApproved(f.context, { ...action, approvalId: "wrong-approval" })).rejects.toMatchObject({ code: "conflict" });
  await expect(onApproved(f.context, { ...action, payload: { kind: "activate_modules", versions: f.versions.map(({ moduleId }) => ({ moduleId, hash: "a".repeat(64) })) } })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.activeHashes()).toEqual(["a".repeat(64), "a".repeat(64)]);
  expect(await f.db.generation.count()).toBe(0);
  await onApproved(f.context, action);
  await expect(onApproved(f.context, action)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.activeHashes()).toEqual(["b".repeat(64), "b".repeat(64)]);
  expect(await f.db.generation.count()).toBe(1);
});

test("stale OAuth group member rolls back approval of every other member", async () => {
  const f = await fixture([credential({ ...oauth, accounts: true })]), result = await f.request();
  if (result.status !== "pending_approval") throw new Error("Expected credential approval");
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } });
  await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  const stale = f.versions[1]!;
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: stale.moduleId, hash: stale.hash } }, data: { status: "rejected" } });
  await expect(onApproved(f.context, { workspaceId: f.context.workspaceId, approvalId: approval.id, payload: approval.payload })).rejects.toMatchObject({ code: "conflict" });
  expect(await f.activeHashes()).toEqual(["a".repeat(64), "a".repeat(64)]);
  expect(await f.db.moduleVersion.count({ where: { hash: "b".repeat(64), status: "pending_review" } })).toBe(1);
  expect(await f.db.generation.count()).toBe(0);
});
