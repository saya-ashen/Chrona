import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { moduleUpstreamRequestSchema, type ModuleUpstreamRequest } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { moduleContext, json, type ModuleContext, type Proposal } from "./module-context";
import { assertExternalModule } from "./module-identity";
import { checkoutModule } from "./module-files";
import { getModuleLocalHead } from "./module-git";
import { fetchModuleUpstream, getModuleUpstreamHead, importModuleGitBundle, mergeModuleUpstream } from "./module-git-upstream";
import { propose } from "./module-proposal";
import type { ModuleReleaseGit } from "./module-release";
import { parseInput, StewardError } from "./errors";

const upstreamSchema = z.object({ repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/).nullable(), branch: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
const descriptorId = (moduleId: string) => `module-upstream:${moduleId}`;
export async function recordModuleUpstream(ports: StewardPorts, workspaceId: string, moduleId: string, git: z.infer<typeof upstreamSchema>, db: Prisma.TransactionClient = ports.db) {
  const details = { repository: git.repository, branch: git.branch, commit: git.commit };
  await db.audit.upsert({ where: { id: descriptorId(moduleId) }, create: { id: descriptorId(moduleId), workspaceId, actorKey: "kernel", kind: "module_git_upstream", subjectId: moduleId, details, createdAt: ports.now() }, update: { details } });
}
/** Both offline release updates and fetched upstream updates retain local ancestry and use the checked queue. */
export async function submitMergedCommit(context: ModuleContext, input: { moduleId: string; commit: string; intent: { changes: string[]; preserves: string[] }; bundle?: ModuleReleaseGit; onPrepared: (commit: string) => Promise<void> }): Promise<Proposal> {
  const module = await assertExternalModule(context.db, context.workspaceId, input.moduleId, "update");
  const location = { platform: context.platform, moduleId: module.id };
  const expectedLocal = await getModuleLocalHead(location);
  if (!expectedLocal) throw new StewardError("conflict", "Module has no local Git source; inspect its source before updating");
  if (input.bundle) await importModuleGitBundle({ ...location, ...input.bundle });
  const merged = await mergeModuleUpstream({ ...location, versionId: randomUUID(), upstreamCommit: input.commit });
  const root = await mkdtemp(join(tmpdir(), "chrona-module-merge-"));
  try {
    await checkoutModule(root, module.name, merged.files);
    const current = await assertExternalModule(context.db, context.workspaceId, module.id, "update");
    if (current.activeHash !== module.activeHash) throw new StewardError("conflict", "Active module version changed during upstream merge");
    await input.onPrepared(merged.commit);
    return await propose(context, { root, dir: module.name, allowed: [module.name], intent: input.intent, sourceCommit: merged.commit, expectedLocal, expectedModuleId: module.id }, "user");
  } finally { await rm(root, { recursive: true, force: true }); }
}
type UpstreamResult = { moduleId: string; repository: string | null; branch: string | null; localCommit: string | null; fetchedCommit: string | null; proposal: Proposal | null };
type MergeReceipt = { request: Extract<ModuleUpstreamRequest, { action: "merge" }>; commit: string | null; result: UpstreamResult | null; failed: boolean };
export async function moduleUpstream(ports: StewardPorts, workspaceId: string, raw: ModuleUpstreamRequest): Promise<UpstreamResult> {
  const request = parseInput(moduleUpstreamRequestSchema, raw), context = moduleContext(ports, workspaceId);
  const module = await assertExternalModule(ports.db, workspaceId, request.moduleId, "update");
  const row = await ports.db.audit.findFirst({ where: { id: descriptorId(module.id), workspaceId, subjectId: module.id } });
  const descriptor = row ? upstreamSchema.parse(row.details) : null;
  const location = { platform: context.platform, moduleId: module.id };
  const result = await readUpstreamStatus(location, descriptor);
  if (request.action === "status") return result;
  if (!descriptor?.repository) throw new StewardError("not_found", "Module upstream is not configured; offline release installation remains available");
  if (request.action === "fetch") {
    const fetched = await fetchModuleUpstream({ ...location, repository: descriptor.repository, branch: descriptor.branch });
    return { ...result, fetchedCommit: fetched.commit };
  }
  return mergeUpstream(context, request, result, module.activeHash);
}
async function readUpstreamStatus(location: { platform: string; moduleId: string }, descriptor: z.infer<typeof upstreamSchema> | null): Promise<UpstreamResult> {
  return { moduleId: location.moduleId, repository: descriptor?.repository ?? null, branch: descriptor?.branch ?? null, localCommit: await getModuleLocalHead(location) ?? null, fetchedCommit: descriptor ? await getModuleUpstreamHead({ ...location, branch: descriptor.branch }) ?? null : null, proposal: null };
}
async function mergeUpstream(context: ModuleContext, request: Extract<ModuleUpstreamRequest, { action: "merge" }>, result: UpstreamResult, activeHash: string | null): Promise<UpstreamResult> {
  const { db, ports, workspaceId } = context;
  const id = `module-upstream-merge:${createHash("sha256").update(workspaceId).update("\0").update(request.requestKey).digest("hex")}`;
  const previous = await db.audit.findUnique({ where: { id } });
  if (previous) {
    const receipt = previous.details as unknown as MergeReceipt;
    if (JSON.stringify(receipt.request) !== JSON.stringify(request)) throw new StewardError("conflict", "Upstream requestKey already belongs to another request");
    if (receipt.result) return receipt.result;
    if (receipt.commit && !receipt.failed) {
      const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: request.moduleId, hash: receipt.commit } } });
      if (version) return { ...result, proposal: { moduleId: request.moduleId, hash: version.hash, status: version.status as Proposal["status"], report: version.report as Proposal["report"] } };
    }
    throw new StewardError("conflict", "Original upstream merge did not return a confirmed proposal; inspect it before submitting a new request");
  }
  if (activeHash !== request.baseHash) throw new StewardError("conflict", "Active module version changed before upstream merge");
  if (result.fetchedCommit !== request.commit) throw new StewardError("conflict", "Select the explicitly fetched upstream commit");
  const receipt: MergeReceipt = { request, commit: null, result: null, failed: false };
  await db.audit.create({ data: { id, workspaceId, actorKey: "kernel", kind: "module_upstream_merge", subjectId: request.moduleId, details: json(receipt), createdAt: ports.now() } });
  try {
    const proposal = await submitMergedCommit(context, { moduleId: request.moduleId, commit: request.commit, intent: { changes: [`Merge upstream ${request.commit}`], preserves: ["Local module changes"] }, onPrepared: async commit => {
      receipt.commit = commit;
      await db.audit.update({ where: { id }, data: { details: json(receipt) } });
    } });
    receipt.result = { ...result, localCommit: proposal.hash, proposal };
    await db.audit.update({ where: { id }, data: { details: json(receipt) } });
    return receipt.result;
  } catch (error) {
    receipt.failed = true;
    await db.audit.update({ where: { id }, data: { details: json(receipt) } });
    throw error;
  }
}
