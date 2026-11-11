import { fenceExecutionVersionChange } from "./execution-delivery-controls";
import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { ApprovedAction, StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { createApprovals } from "./approvals";
import { assertDynamicModuleActivation, expireModuleApprovals, groupPayloadSchema, json, moduleContext, type ModuleContext, type ModuleVersion } from "./module-context";
import { declaredModules } from "./module-build-targets";
import { dataEmpty } from "./module-data";
import { recordGeneration, switchActiveIn } from "./module-generation";
import { recordModuleActivation } from "./module-evolution";
import { audit } from "./audit";
import { insertCodeDiff } from "./module-preview";
import { activationNotice } from "./module-activation-notice";
import { assertExternalModule } from "./module-identity";
import { requiresCapabilityApproval } from "./module-owner";
import { assertCandidateSetIn, findCandidateSet, readCandidateSetIn, setCandidateSetStateIn, type CandidateSet } from "./module-candidate-records";
import { recordApprovalFact, recordWithdrawal } from "./notification-facts";
import { ModuleIdentityError } from "./module-identity";
import { ModuleUnavailableError } from "./module-availability";
import { assertExecutionModuleIdle } from "./execution-module-guard";

/**
 * v2-15: one build may change several modules. Their candidates wait for one `activate_module` approval whose payload
 * (`kind: "activate_modules"`) binds every version; approving it activates all of them in one transaction and one generation.
 */
const reviewSchema = z.object({ prefix: z.string(), suffix: z.string(), codeDiff: z.string(), detail: z.string(), needsMigration: z.boolean() });

/** The build conversation that submitted a version (recorded by `modules.propose`). */
async function submittedBy(db: Prisma.TransactionClient, workspaceId: string, version: Pick<ModuleVersion, "moduleId" | "hash">) {
  const row = await db.moduleVersion.findFirst({ where: { moduleId: version.moduleId, hash: version.hash, module: { workspaceId } }, select: { buildSessionId: true } });
  return row?.buildSessionId ?? null;
}
/** Group candidates must never acquire a standalone approval, even if recording their review failed. */
export async function isGroupCandidate(context: ModuleContext, version: ModuleVersion) {
  if (await findCandidateSet(context, version)) return true;
  if (version.source !== "build") return false;
  const sessionId = await submittedBy(context.db, context.workspaceId, version);
  return !!sessionId && ((await declaredModules(context.db, context.workspaceId, sessionId))?.length ?? 0) >= 2;
}
/** When the version belongs to a build that declared several modules, keep its review for the group approval and say so. */
export async function recordGroupReview(context: ModuleContext, version: ModuleVersion, review: z.input<typeof reviewSchema>) {
  if (!await isGroupCandidate(context, version)) return false;
  await context.db.moduleReview.upsert({ where: { versionId: version.id }, create: { versionId: version.id, ...review }, update: review });
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
async function groupMember(db: Prisma.TransactionClient, workspaceId: string, sessionId: string, name: string, hash: string) {
  const module = await db.module.findFirst({ where: { workspaceId, name } });
  const version = module ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } }) : null;
  if (!module || !version) throw new StewardError("not_found", `${name} ${hash} not found`);
  await assertExternalModule(db, workspaceId, module.id, "group");
  if (version.status !== "pending_review") throw new StewardError("conflict", `${name} ${hash} is ${version.status}, not waiting for review`);
  if (await submittedBy(db, workspaceId, version) !== sessionId) throw new StewardError("forbidden", `${name} ${hash} was not submitted by this build`);
  const review = reviewSchema.safeParse(await db.moduleReview.findUnique({ where: { versionId: version.id }, select: { prefix: true, suffix: true, codeDiff: true, detail: true, needsMigration: true } })).data;
  if (!review) throw new StewardError("conflict", `${name} ${hash} has not been reviewed yet`);
  if (review.needsMigration) throw new StewardError("conflict", `${name} needs a data migration: build and approve it on its own first, then the rest together`);
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const previous = active ? moduleManifestSchema.parse(active.manifest) : null;
  const manifest = moduleManifestSchema.parse(version.manifest);
  const addsCredentials = requiresCapabilityApproval(manifest, previous);
  return { module, version, name, hash, review, addsCredentials };
}
function checkedGroupNames(declared: string[], versions: { module: string; hash: string }[]) {
  const names = versions.map(version => version.module);
  if (names.length !== declared.length || new Set(names).size !== names.length || !declared.every(name => names.includes(name))) throw new StewardError("invalid", `Give one version of each declared module: ${declared.join(", ")}`);
  return names;
}
/** `modules.request-group`: one approval for one version of every module the calling build declared. */
export async function requestGroup(ports: StewardPorts, workspaceId: string, sessionId: string | null, versions: { module: string; hash: string }[]) {
  const context = moduleContext(ports, workspaceId), { db } = context;
  const invalidBuild = "Only a build that declared several modules asks for one approval; a single module gets its own";
  if (!sessionId) throw new StewardError("invalid", invalidBuild);
  const declared = await declaredModules(db, workspaceId, sessionId);
  if (!declared || declared.length < 2) throw new StewardError("invalid", invalidBuild);
  const names = checkedGroupNames(declared, versions);
  const members: Awaited<ReturnType<typeof groupMember>>[] = [];
  for (const { module: name, hash } of versions) {
    const member = await groupMember(db, workspaceId, sessionId, name, hash);
    if (await findCandidateSet(context, member.version)) throw new StewardError("conflict", "Fixed candidates advance only through their receipt");
    members.push(member);
  }
  if (!members.some(member => member.addsCredentials)) {
    for (const member of members) await fenceExecutionVersionChange(ports, workspaceId, member.module.id, member.hash);
    await db.$transaction(async tx => {
      for (const { module, hash } of members) {
        await expireModuleApprovals(context, module.id, tx);
        await approveMemberIn(context, tx, module.id, hash);
      }
      for (const { module, hash } of members) await switchActiveIn(context, tx, module.id, hash);
      const generation = await recordGeneration(context, tx, "activate");
      await audit(tx, { workspaceId, actor: "chrona", kind: "module_group_activation", subjectId: generation.id, details: { modules: members.map(member => member.module.id) } });
      for (const { module, version, hash } of members) {
        await recordModuleActivation(context, tx, { moduleId: module.id, previousHash: module.activeHash, hash, generationId: generation.id, grouped: true });
        await audit(tx, { workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash, generationId: generation.id } });
        await activationNotice(context, tx, version, !!module.activeHash);
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
  const module = await assertExternalModule(tx, workspaceId, moduleId, "group");
  if (module.status === "migrating") throw new StewardError("conflict", `${module.name} is migrating`);
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (version?.status !== "pending_review") throw new StewardError("conflict", `${module.name} ${hash} is no longer waiting for review`);
  await assertDynamicModuleActivation(tx, workspaceId, moduleId, { hash });
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
  for (const { moduleId, hash } of payload.versions) {
    const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
    const set = version ? await fixedSetIn(context, tx, version) : null;
    if (set) {
      await approveFixedSetIn(context, tx, set, action, payload.versions);
      return;
    }
  }
  for (const { moduleId, hash } of payload.versions) await approveMemberIn(context, tx, moduleId, hash);
  const previous = new Map((await tx.module.findMany({ where: { id: { in: payload.versions.map(item => item.moduleId) } }, select: { id: true, activeHash: true } })).map(module => [module.id, module.activeHash]));
  for (const { moduleId, hash } of payload.versions) await switchActiveIn(context, tx, moduleId, hash);
  const generation = await recordGeneration(context, tx, "activate");
  await audit(tx, { workspaceId, actor: "chrona", kind: "module_group_activation", subjectId: generation.id, details: { modules: payload.versions.map(member => member.moduleId) } });
  for (const { moduleId, hash } of payload.versions) {
    await recordModuleActivation(context, tx, { moduleId, previousHash: previous.get(moduleId) ?? null, hash, generationId: generation.id, grouped: true });
    await audit(tx, { workspaceId, actor: "chrona", kind: "module_activate", subjectId: moduleId, details: { hash, generationId: generation.id, approvalId: action.approvalId } });
  }
}

/** Receipt membership applies to every source, including a single fixed candidate. */
async function fixedSetIn(context: ModuleContext, tx: Prisma.TransactionClient, version: Pick<ModuleVersion, "id" | "moduleId" | "hash">) {
  return findCandidateSet({ ...context, db: tx as ModuleContext["db"] }, version);
}
function candidateConflict(error: unknown): error is Error {
  return error instanceof StewardError || error instanceof ModuleIdentityError || error instanceof ModuleUnavailableError;
}
async function rejectFixedSetIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet, reason: string) {
  await setCandidateSetStateIn(context, tx, set, "rejected");
  for (const member of set.members) {
    const version = await tx.moduleVersion.findUnique({ where: { id: member.versionId } });
    if (!version || !["building", "testing", "pending_review"].includes(version.status)) continue;
    const report = version.report && typeof version.report === "object" && !Array.isArray(version.report) ? version.report : {};
    await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json({ ...report, errors: [reason] }) } });
  }
  if (set.approvalId) {
    await tx.approval.updateMany({ where: { id: set.approvalId, workspaceId: context.workspaceId, status: "open" }, data: { status: "expired", resolvedAt: context.now() } });
    await recordWithdrawal(tx, context.workspaceId, `approval:${set.approvalId}`, context.now());
  }
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_candidate_rejected", subjectId: set.receiptId, details: { reason } });
  return { ...set, state: "rejected" as const };
}
/** Load exactly the immutable version recorded by the candidate set. */
async function fixedVersionIn(tx: Prisma.TransactionClient, member: CandidateSet["members"][number]) {
  const version = await tx.moduleVersion.findUnique({ where: { id: member.versionId } });
  if (!version || version.moduleId !== member.moduleId || version.hash !== member.hash) throw new StewardError("conflict", `${member.name} fixed version changed`);
  return version;
}
/** Recheck capability approval requirements against the current active version. */
async function fixedMemberCapabilities(tx: Prisma.TransactionClient, module: Awaited<ReturnType<typeof assertExternalModule>>, version: ModuleVersion) {
  const manifest = moduleManifestSchema.parse(version.manifest);
  const active = module.activeHash ? await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const previous = active ? moduleManifestSchema.parse(active.manifest) : null;
  return requiresCapabilityApproval(manifest, previous);
}
/** Readiness and all mutable activation facts are checked before any member is approved. */
async function fixedMembersIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet) {
  await assertCandidateSetIn(context, tx, set);
  const members = [];
  let ready = true;
  for (const member of set.members) {
    const module = await assertExternalModule(tx, context.workspaceId, member.moduleId, "group");
    const version = await fixedVersionIn(tx, member);
    if (module.status === "migrating" || version.status === "rejected") throw new StewardError("conflict", `${member.name} cannot activate with this candidate set`);
    if (["building", "testing"].includes(version.status)) { ready = false; continue; }
    if (version.status !== "pending_review") throw new StewardError("conflict", `${member.name} is no longer waiting for review`);
    const review = reviewSchema.safeParse(await tx.moduleReview.findUnique({ where: { versionId: version.id }, select: { prefix: true, suffix: true, codeDiff: true, detail: true, needsMigration: true } })).data;
    if (!review) { ready = false; continue; }
    if (review.needsMigration && set.members.length !== 1) throw new StewardError("conflict", `${member.name} needs a migration; fixed sets cannot partially migrate`);
    const addsCredentials = review.needsMigration || await fixedMemberCapabilities(tx, module, version);
    members.push({ module, version, name: member.name, hash: member.hash, review, addsCredentials });
  }
  return ready ? members : null;
}
type FixedMembers = NonNullable<Awaited<ReturnType<typeof fixedMembersIn>>>;
/** Only the execution guard is retryable; other activation conflicts invalidate the fixed set. */
class FixedCandidateExecutionConflict extends StewardError {
  constructor(message: string) { super("conflict", message); }
}
async function assertFixedExecutionIdle(tx: Prisma.TransactionClient, moduleId: string) {
  try { await assertExecutionModuleIdle(tx, moduleId); }
  catch (error) {
    if (!(error instanceof StewardError) || error.code !== "conflict") throw error;
    throw new FixedCandidateExecutionConflict(error.message);
  }
}
async function activateFixedSetIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet, members: FixedMembers, approvalId?: string) {
  // Check every member before approving or switching any of them.
  for (const member of members) if (member.module.activeHash !== member.hash) await assertFixedExecutionIdle(tx, member.module.id);
  for (const member of members) {
    await expireModuleApprovals(context, member.module.id, tx);
    await approveMemberIn(context, tx, member.module.id, member.hash);
  }
  for (const member of members) await switchActiveIn(context, tx, member.module.id, member.hash);
  const generation = await recordGeneration(context, tx, "activate");
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_group_activation", subjectId: generation.id, details: { receiptId: set.receiptId, modules: members.map(member => member.module.id) } });
  for (const { module, version, hash } of members) {
    await recordModuleActivation(context, tx, { moduleId: module.id, previousHash: module.activeHash, hash, generationId: generation.id, grouped: true });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: approvalId ? "module_activate" : "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash, generationId: generation.id, ...(approvalId ? { approvalId } : {}) } });
    if (!approvalId) await activationNotice(context, tx, version, !!module.activeHash);
  }
  await setCandidateSetStateIn(context, tx, set, "approved", approvalId ?? null);
  return { ...set, state: "approved" as const, approvalId: approvalId ?? null };
}
/** The receipt and its approval are written atomically, so recovery cannot create an unbound card. */
async function requestFixedApprovalIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet, members: FixedMembers) {
  const preview = groupPreview(members);
  if (preview === null) return rejectFixedSetIn(context, tx, set, "The fixed candidate review exceeds one approval");
  for (const member of members) await expireModuleApprovals(context, member.module.id, tx);
  const single = members.length === 1 ? members[0]! : null;
  const approval = await tx.approval.create({ data: {
    workspaceId: context.workspaceId, ...(single ? { moduleId: single.module.id } : {}), action: "activate_module",
    title: `启用模块 ${members.map(member => member.name).join("、")}`.slice(0, 200),
    detail: "这组固定材料一起启用；任何成员失效时全部保持原样。此版本需要新的凭据或 owner 权限。", preview,
    payload: single ? { kind: "activate_module", moduleId: single.module.id, hash: single.hash } : { kind: "activate_modules", versions: members.map(member => ({ moduleId: member.module.id, hash: member.hash })) },
    createdAt: context.now(),
  } });
  await recordApprovalFact(tx, approval);
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "approval_created", subjectId: approval.id, details: { action: "activate_module", receiptId: set.receiptId } });
  await setCandidateSetStateIn(context, tx, set, "pending_approval", approval.id);
  return { ...set, state: "pending_approval" as const, approvalId: approval.id };
}
/** Reuse the approved-action validators; a changed card must never reach ordinary activation. */
async function recoverFixedApprovalIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet) {
  const approval = set.approvalId ? await tx.approval.findFirst({ where: { id: set.approvalId, workspaceId: context.workspaceId } }) : null;
  if (!approval || approval.status === "denied" || approval.status === "expired") return rejectFixedSetIn(context, tx, set, "Fixed candidate approval was denied, expired or lost");
  if (approval.status !== "approved") return set;
  const action = { workspaceId: context.workspaceId, approvalId: approval.id, payload: approval.payload };
  const group = groupPayloadSchema.safeParse(approval.payload);
  const single = z.object({ kind: z.literal("activate_module"), moduleId: z.string(), hash: z.string() }).strict().safeParse(approval.payload);
  const versions = group.success ? group.data.versions : single.success ? [single.data] : [];
  if (!exactFixedPayload(set, versions)) throw new StewardError("conflict", "Approval does not bind the exact fixed candidate set");
  if (group.success) await activateGroupIn(context, tx, action);
  else if (!await activateFixedCandidateApprovedIn(context, tx, action)) throw new StewardError("conflict", "Approval does not bind a fixed candidate");
  return readCandidateSetIn(context, tx, set.receiptId);
}
/** Synchronize a single candidate with ordinary activation, or wait while its migration owns progress. */
async function reconcileSingleFixedCandidateIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet): Promise<boolean> {
  if (set.members.length !== 1) return false;
  const member = set.members[0]!;
  const module = await tx.module.findUnique({ where: { id: member.moduleId } });
  const version = await tx.moduleVersion.findUnique({ where: { id: member.versionId } });
  if (module?.activeHash === member.hash && version?.status === "approved") {
    await setCandidateSetStateIn(context, tx, set, "approved", set.approvalId);
    return true;
  }
  return module?.status === "migrating";
}
/** Runs after each recorded review/failure and during recovery; it never activates a subset. */
export async function advanceFixedCandidateSet(context: ModuleContext, version: Pick<ModuleVersion, "id" | "moduleId" | "hash">): Promise<CandidateSet | null> {
  const found = await findCandidateSet(context, version);
  if (!found) return null;
  try {
    const ready = await context.db.$transaction(async tx => {
      const set = await readCandidateSetIn(context, tx, found.receiptId);
      if (!set || set.state === "approved" || set.state === "rejected") return null;
      if (await reconcileSingleFixedCandidateIn(context, tx, set)) return null;
      const members = await fixedMembersIn(context, tx, set);
      if (!members) return null;
      if (set.state === "pending_approval") {
        const approval = set.approvalId ? await tx.approval.findUnique({ where: { id: set.approvalId } }) : null;
        return approval?.status === "approved" ? members : null;
      }
      return members.some(member => member.addsCredentials) ? null : members;
    });
    for (const member of ready ?? []) await fenceExecutionVersionChange(context.ports, context.workspaceId, member.module.id, member.hash);
    return await context.db.$transaction(async tx => {
      const set = await readCandidateSetIn(context, tx, found.receiptId);
      if (!set || set.state === "approved" || set.state === "rejected") return set;
      if (set.members.length === 1 && (await tx.module.findUnique({ where: { id: set.members[0]!.moduleId } }))?.status === "migrating") return set;
      const members = await fixedMembersIn(context, tx, set);
      if (set.state === "pending_approval") return recoverFixedApprovalIn(context, tx, set);
      if (!members) return set;
      return members.some(member => member.addsCredentials) ? requestFixedApprovalIn(context, tx, set, members) : activateFixedSetIn(context, tx, set, members);
    });
  } catch (error) {
    if (!candidateConflict(error)) throw error;
    // Activation may have written several members before a permanent conflict.
    // Reject only after that entire transaction has rolled back.
    return context.db.$transaction(async tx => {
      const set = await readCandidateSetIn(context, tx, found.receiptId);
      if (!set || set.state === "approved" || set.state === "rejected" || error instanceof FixedCandidateExecutionConflict) return set;
      return rejectFixedSetIn(context, tx, set, error.message);
    });
  }
}
function exactFixedPayload(set: CandidateSet, versions: { moduleId: string; hash: string }[]) {
  return versions.length === set.members.length && new Set(versions.map(member => member.moduleId)).size === versions.length
    && set.members.every(member => versions.some(version => version.moduleId === member.moduleId && version.hash === member.hash));
}
async function approveFixedSetIn(context: ModuleContext, tx: Prisma.TransactionClient, set: CandidateSet, action: ApprovedAction, versions: { moduleId: string; hash: string }[]) {
  if (action.workspaceId !== context.workspaceId || set.state !== "pending_approval" || set.approvalId !== action.approvalId || !exactFixedPayload(set, versions)) throw new StewardError("conflict", "Approval does not bind the exact fixed candidate set");
  let members: FixedMembers | null;
  try {
    members = await fixedMembersIn(context, tx, set);
    if (!members) throw new StewardError("conflict", "Every fixed candidate must have a recorded review");
  } catch (error) {
    if (!candidateConflict(error)) throw error;
    await rejectFixedSetIn(context, tx, set, error.message);
    return;
  }
  await activateFixedSetIn(context, tx, set, members, action.approvalId);
}
/** Recognize single-version activation fields without excluding extensions checked against the stored approval. */
function isSingleActivationPayload(payload: ApprovedAction["payload"]): payload is { kind: "activate_module"; moduleId: string; hash: string } {
  return !!payload && typeof payload === "object" && !Array.isArray(payload) && payload.kind === "activate_module" && typeof payload.moduleId === "string" && typeof payload.hash === "string";
}
/** Called before ordinary single activation. A single payload can never activate one member of a larger receipt. */
export async function activateFixedCandidateApprovedIn(context: ModuleContext, tx: Prisma.TransactionClient, action: ApprovedAction): Promise<boolean> {
  const payload = action.payload;
  if (!isSingleActivationPayload(payload)) return false;
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: payload.moduleId, hash: payload.hash } } });
  if (!version) return false;
  const set = await fixedSetIn(context, tx, version);
  if (!set) return false;
  const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId: context.workspaceId, action: "activate_module", status: "approved", moduleId: payload.moduleId } });
  if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(payload) || "restore" in payload) throw new StewardError("conflict", "Module approval does not match the fixed candidate");
  const members = await fixedMembersIn(context, tx, set);
  if (set.members.length === 1 && members?.[0]?.review.needsMigration) {
    await assertCandidateSetIn(context, tx, set);
    if (!exactFixedPayload(set, [{ moduleId: version.moduleId, hash: version.hash }])) throw new StewardError("conflict", "Migration approval does not bind the fixed candidate");
    await assertFixedExecutionIdle(tx, version.moduleId);
    return false; // The existing approved single-version migration owns backup, actual stop and recovery.
  }
  await approveFixedSetIn(context, tx, set, action, [{ moduleId: version.moduleId, hash: version.hash }]);
  return true;
}
