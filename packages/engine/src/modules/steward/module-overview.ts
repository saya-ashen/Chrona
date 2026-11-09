import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError, type Json } from "./module-calls";
import { createSecrets } from "./secrets";
import { secretView } from "./secret-fields";
import { addedCapabilities } from "./module-capabilities";
import { modelUsage, moduleModelSettings } from "./settings";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

/** Read stored permissions, secret readiness and usage without executing module or model code. */
export async function modulePermissions(ports: StewardPorts, workspaceId: string, name: string) {
  const { db } = ports, module = await db.module.findFirst({ where: { workspaceId, OR: [{ id: name }, { name }] } });
  if (!module) throw new CallError("not_found", `Module ${name} not found`);
  const version = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data ?? null;
  const saved = new Map((await createSecrets(ports.dataDir).list()).map(row => [row.name, row.updatedAt]));
  const grants = (await db.grant.findMany({ where: { workspaceId, revokedAt: null } })).filter(grant => (grant.scope as { moduleId?: string }).moduleId === module.id && !(grant.once && grant.consumedAt));
  return json({
    module: module.name, activeHash: module.activeHash,
    capabilities: manifest ? addedCapabilities(null, manifest) : [],
    secrets: await Promise.all((manifest?.secrets ?? []).map(async declared => {
      const name = typeof declared === "string" ? declared : declared.name;
      // Field metadata stays local; adapters expose only whether an environment-held credential is configured.
      const value = saved.has(name) ? await createSecrets(ports.dataDir).read(name).catch(() => null) : null;
      return { name, configured: saved.has(name) || await ports.secretConfigured?.(name) === true, updatedAt: saved.get(name) ?? null, ...secretView(declared, value) };
    })),
    model: manifest?.model ? await moduleModelView(ports, workspaceId, module.name, manifest.model) : null,
    grants: grants.map(grant => ({ id: grant.id, action: grant.action, mode: grant.mode, once: grant.once, createdAt: grant.createdAt.toISOString() })),
    approvals: (await db.approval.findMany({ where: { workspaceId, moduleId: module.id }, orderBy: { createdAt: "desc" }, take: 10 }))
      .map(row => ({ id: row.id, title: row.title, status: row.status, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
  });
}
async function moduleModelView(ports: StewardPorts, workspaceId: string, name: string, model: NonNullable<ReturnType<typeof moduleManifestSchema.parse>["model"]>) {
  const workspace = await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }), settings = moduleModelSettings(workspace.settings);
  const usage = (await modelUsage(ports.db, workspaceId, workspace.settings, ports.now())).find(row => row.module === name);
  return { tier: model.tier, maxCallsPerEvent: model.maxCalls, dailyCap: settings?.moduleDailyCalls?.[name] ?? null, today: usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 } };
}
