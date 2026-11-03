import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema, secretNames } from "@chrona/contracts/steward";
import type { ApprovedAction, StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { createApprovals } from "./approvals";
import { assertBuiltinUpgrade, expireModuleApprovals, groupPayloadSchema, json, moduleContext, requireModule, type ModuleContext, type ModuleVersion } from "./module-context";
import { declaredModules } from "./module-build-session";
import { dataEmpty } from "./module-data";
import { recordGeneration, switchActiveIn } from "./module-generation";
import { recordModuleActivation } from "./module-evolution";
import { audit } from "./audit";
import { insertCodeDiff } from "./module-preview";
import { activationNotice } from "./module-build";

/**
 * v2-15: one build may change several modules. Their candidates wait for one `activate_module` approval whose payload
 * (`kind: "activate_modules"`) binds every version; approving it activates all of them in one transaction and one generation.
 */
const reviewKey = (versionId: string) => `module-review:${versionId}`;
const reviewSchema = z.object({ prefix: z.string(), suffix: z.string(), codeDiff: z.string(), detail: z.string(), needsMigration: z.boolean() });

/** The build conversation that submitted a version (recorded by `modules.propose`). */
async function submittedBy(db: StewardPorts["db"], workspaceId: string, version: Pick<ModuleVersion, "moduleId" | "hash">) {
  const rows = await db.audit.findMany({ where: { workspaceId, kind: "module_submission", subjectId: version.moduleId }, orderBy: { createdAt: "desc" } });
  const found = rows.map(row => row.details as { hash?: unknown; sessionId?: unknown } | null).find(details => details?.hash === version.hash && typeof details.sessionId === "string");
  return found ? String(found.sessionId) : null;
}
/** Group candidates must never acquire a standalone approval, even if recording their review failed. */
export async function isGroupCandidate(context: ModuleContext, version: ModuleVersion) {
  if (version.source !== "build") return false;
  const sessionId = await submittedBy(context.db, context.workspaceId, version);
  return !!sessionId && ((await declaredModules(context.db, context.workspaceId, sessionId))?.length ?? 0) >= 2;
}
/** When the version belongs to a build that declared several modules, keep its review for the group approval and say so. */
export async function recordGroupReview(context: ModuleContext, version: ModuleVersion, review: z.input<typeof reviewSchema>) {
  if (!await isGroupCandidate(context, version)) return false;
  const row = { workspaceId: context.workspaceId, actorKey: "chrona", kind: "module_review", subjectId: version.id, details: json(review) };
  await context.db.audit.upsert({ where: { id: reviewKey(version.id) }, update: { details: row.details }, create: { ...row, id: reviewKey(version.id) } });
  return true;
}

/** Every declared module's review in one preview: mandatory text whole, code diffs share the rest; fail closed when that is impossible. */
function groupPreview(members: { name: string; hash: string; review: z.output<typeof reviewSchema> }[]) {
  const headers = members.map(member => `【${member.name}】\n`), mandatory = members.reduce((sum, member, index) => sum + headers[index]!.length + member.review.prefix.length + member.review.suffix.length + 2, 0);
  const share = Math.floor((20_000 - mandatory) / members.length);
  const sections = members.map((member, index) => {
    const { prefix, suffix, codeDiff } = member.review;
    const body = insertCodeDiff(prefix, suffix, codeDiff, member.hash, prefix.length + suffix.length + Math.max(0, share));
    return body === null ? null : headers[index]! + body;
  });
  const preview = sections.every(section => section !== null) ? sections.join("\n\n") : null;
  return preview !== null && preview.length <= 20_000 ? preview : null;
}

/** One declared module's candidate, checked for the group: submitted by this build, reviewed, waiting, no migration. */
async function groupMember(db: StewardPorts["db"], workspaceId: string, sessionId: string, name: string, hash: string) {
  const module = await db.module.findFirst({ where: { workspaceId, name } });
  const version = module ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } }) : null;
  if (!module || !version) throw new StewardError("not_found", `${name} ${hash} not found`);
  if (version.status !== "pending_review") throw new StewardError("conflict", `${name} ${hash} is ${version.status}, not waiting for review`);
  if (await submittedBy(db, workspaceId, version) !== sessionId) throw new StewardError("forbidden", `${name} ${hash} was not submitted by this build`);
  const review = reviewSchema.safeParse((await db.audit.findUnique({ where: { id: reviewKey(version.id) } }))?.details).data;
  if (!review) throw new StewardError("conflict", `${name} ${hash} has not been reviewed yet`);
  if (review.needsMigration) throw new StewardError("conflict", `${name} needs a data migration: build and approve it on its own first, then the rest together`);
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const previous = active ? moduleManifestSchema.parse(active.manifest) : null;
  const addsSecrets = secretNames(moduleManifestSchema.parse(version.manifest)).some(name => !previous || !secretNames(previous).includes(name));
  return { module, version, name, hash, review, addsSecrets };
}
/** `modules.request-group`: one approval for one version of every module the calling build declared. */
export async function requestGroup(ports: StewardPorts, workspaceId: string, sessionId: string | null, versions: { module: string; hash: string }[]) {
  const context = moduleContext(ports, workspaceId), { db } = context;
  const declared = sessionId ? await declaredModules(db, workspaceId, sessionId) : null;
  if (!sessionId || !declared || declared.length < 2) throw new StewardError("invalid", "Only a build that declared several modules asks for one approval; a single module gets its own");
  const names = versions.map(version => version.module);
  if (names.length !== declared.length || new Set(names).size !== names.length || !declared.every(name => names.includes(name))) throw new StewardError("invalid", `Give one version of each declared module: ${declared.join(", ")}`);
  const members: Awaited<ReturnType<typeof groupMember>>[] = [];
  for (const { module: name, hash } of versions) members.push(await groupMember(db, workspaceId, sessionId, name, hash));
  if (!members.some(member => member.addsSecrets)) {
    await db.$transaction(async tx => {
      for (const { module, hash } of members) {
        await expireModuleApprovals(context, module.id, tx);
        await approveMemberIn(context, tx, module.id, hash);
      }
      for (const { module, hash } of members) await switchActiveIn(context, tx, module.id, hash);
      const generation = await recordGeneration(context, tx, "activate");
      for (const { module, version, hash } of members) {
        await recordModuleActivation(context, tx, { moduleId: module.id, previousHash: module.activeHash, hash, generationId: generation.id });
        await audit(tx, { workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash, generationId: generation.id } });
        if (version.source !== "builtin") await activationNotice(context, tx, version, !!module.activeHash);
      }
    });
    return { status: "approved" as const };
  }
  const preview = groupPreview(members);
  if (preview === null) throw new StewardError("conflict", "The combined review does not fit one approval; split the change into smaller builds");
  for (const { module } of members) await expireModuleApprovals(context, module.id);
  const approval = await createApprovals(context).create({ action: "activate_module", title: `一起启用模块 ${names.join("、")}`.slice(0, 200),
    detail: `这组改动一起启用：${names.join("、")}。任何一个不能启用时，全部保持原样。${members[0]!.review.detail}`,
    payload: { kind: "activate_modules", versions: members.map(member => ({ moduleId: member.module.id, hash: member.hash })) }, preview });
  return { status: "pending_approval" as const, approvalId: approval.id };
}

/** Marks one group version approved, after the same checks as a single activation; no migration here. */
async function approveMemberIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string) {
  const { workspaceId } = context;
  const module = await requireModule(context, tx, moduleId);
  if (module.status === "migrating") throw new StewardError("conflict", `${module.name} is migrating`);
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (version?.status !== "pending_review") throw new StewardError("conflict", `${module.name} ${hash} is no longer waiting for review`);
  await assertBuiltinUpgrade(tx, workspaceId, moduleId, { hash });
  const to = moduleManifestSchema.parse(version.manifest).data.schema, from = module.dataSchema;
  if (from !== null && to > from && !await dataEmpty(join(context.platform, "data", moduleId))) throw new StewardError("conflict", `${module.name} now needs a data migration; approve it on its own`);
  await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
  await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
}
/** Activates every version of an approved group in the caller's transaction: all or none, one generation. */
export async function activateGroupIn(context: ModuleContext, tx: Prisma.TransactionClient, action: ApprovedAction) {
  const { workspaceId } = context, payload = groupPayloadSchema.parse(action.payload);
  const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "activate_module", status: "approved", moduleId: null } });
  if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(action.payload)) throw new StewardError("conflict", "Module approval does not match");
  for (const { moduleId, hash } of payload.versions) await approveMemberIn(context, tx, moduleId, hash);
  const previous = new Map((await tx.module.findMany({ where: { id: { in: payload.versions.map(item => item.moduleId) } }, select: { id: true, activeHash: true } })).map(module => [module.id, module.activeHash]));
  for (const { moduleId, hash } of payload.versions) await switchActiveIn(context, tx, moduleId, hash);
  const generation = await recordGeneration(context, tx, "activate");
  for (const { moduleId, hash } of payload.versions) {
    await recordModuleActivation(context, tx, { moduleId, previousHash: previous.get(moduleId) ?? null, hash, generationId: generation.id });
    await audit(tx, { workspaceId, actor: "chrona", kind: "module_activate", subjectId: moduleId, details: { hash, generationId: generation.id, approvalId: action.approvalId } });
  }
}
