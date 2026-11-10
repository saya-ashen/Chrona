import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { callerSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import { candidateAdmissionInputSchema, candidateReceiptSchema } from "../../../../contracts/src/steward/module-candidates";
import type { Caller } from "./module-call-types";
import { type ModuleContext, type ModuleVersion } from "./module-context";
import { StewardError } from "./errors";
import { isOwnerCaller } from "./module-owner";
import { assertExternalModule, assertExternalName } from "./module-identity";
import { assertModuleAvailable } from "./module-availability";

export type CandidateDb = Prisma.TransactionClient;
export const admissionRecordSchema = z.object({ input: candidateAdmissionInputSchema, issuer: callerSchema, receiptId: z.string().nullable() }).strict();
export type CandidateAdmissionRecord = z.infer<typeof admissionRecordSchema>;
export const candidateSetSchema = candidateReceiptSchema.omit({ members: true }).extend({ members: z.array(candidateReceiptSchema.shape.members.element.omit({ status: true, selected: true })).min(1).max(4) }).strict();
export type CandidateSet = z.infer<typeof candidateSetSchema>;
export function candidateDigest(value: unknown) {
  const canonical = JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash("sha256").update(canonical).digest("hex");
}
export function candidateRequestId(kind: "admission" | "submission", workspaceId: string, caller: Caller, requestKey: string) {
  return `candidate-${kind}:${candidateDigest({ workspaceId, caller, requestKey })}`;
}
export async function assertCandidateOwner(db: CandidateDb, workspaceId: string, caller: Caller) {
  if (!await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }) || !await isOwnerCaller(db, workspaceId, caller)) throw new StewardError("forbidden", "A current owner identity is required");
  if (caller.kind === "module") await assertExternalModule(db, workspaceId, caller.moduleId, "propose");
}
function matchesSubmitterCaller(caller: Caller | undefined, module: { id: string; name: string }, hash: string) {
  return !caller || (caller.kind === "module" && caller.moduleId === module.id && caller.hash === hash && caller.module === module.name);
}
export async function assertCandidateSubmitter(db: CandidateDb, workspaceId: string, submitter: CandidateSet["submitter"], caller?: Caller) {
  const module = await db.module.findFirst({ where: { id: submitter.moduleId, workspaceId, status: "active", activeHash: submitter.hash } });
  const version = module ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: submitter.hash } } }) : null;
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  if (!module || !version || version.status !== "approved" || !manifest || manifest.name !== module.name || module.name === "agent" || !matchesSubmitterCaller(caller, module, submitter.hash)) throw new StewardError("forbidden", "The admitted submitter identity is not current and approved");
  await assertExternalModule(db, workspaceId, module.id, "propose");
  return module;
}
export async function readCandidateAdmissionIn(context: ModuleContext, db: CandidateDb, admissionId: string) {
  const row = await db.candidateAdmission.findFirst({ where: { id: admissionId, workspaceId: context.workspaceId }, include: { receipt: { select: { id: true } } } });
  if (!row) throw new StewardError("not_found", "Candidate admission not found");
  const admission = admissionRecordSchema.parse({ input: { requestKey: row.requestKey, submitter: { moduleId: row.submitterModuleId, hash: row.submitterHash }, targets: row.targets }, issuer: row.issuer, receiptId: row.receipt?.id ?? null });
  // Replays read this record without repeating the baseline fence; availability still applies.
  for (const target of admission.input.targets) assertModuleAvailable(target.name);
  return admission;
}
export async function assertCandidateAdmissionIn(context: ModuleContext, db: CandidateDb, admission: CandidateAdmissionRecord, caller?: Caller) {
  await assertCandidateOwner(db, context.workspaceId, admission.issuer);
  await assertCandidateSubmitter(db, context.workspaceId, admission.input.submitter, caller);
  for (const target of admission.input.targets) {
    const module = await assertExternalName(db, context.workspaceId, target.name, "propose");
    if (target.moduleId === null) {
      if (module) throw new StewardError("conflict", "A new candidate target name is already occupied");
    } else if (!module || module.id !== target.moduleId || module.activeHash !== target.expectedActiveHash || module.status === "migrating") throw new StewardError("conflict", "Candidate target identity or active version changed");
  }
}
export async function readCandidateSetIn(context: ModuleContext, db: CandidateDb, receiptId: string): Promise<CandidateSet | null> {
  const row = await db.candidateReceipt.findFirst({ where: { id: receiptId, admission: { workspaceId: context.workspaceId } }, include: { admission: true } });
  return row ? candidateSetSchema.parse({ receiptId: row.id, admissionId: row.admissionId, requestKey: row.requestKey, submitter: { moduleId: row.admission.submitterModuleId, hash: row.admission.submitterHash }, state: row.state, approvalId: row.approvalId, members: row.members }) : null;
}
export async function findCandidateSet(context: ModuleContext, version: Pick<ModuleVersion, "id" | "moduleId" | "hash">): Promise<CandidateSet | null> {
  const binding = await context.db.candidateMember.findFirst({ where: { versionId: version.id, receipt: { admission: { workspaceId: context.workspaceId } } } });
  if (!binding) {
    const stored = await context.db.moduleVersion.findFirst({ where: { id: version.id, module: { workspaceId: context.workspaceId } }, select: { source: true } });
    if (stored?.source === "candidate") throw new StewardError("conflict", "Fixed candidate member binding is missing");
    return null;
  }
  const ref = binding;
  const set = await readCandidateSetIn(context, context.db, ref.receiptId);
  if (!set || !set.members.some(member => member.versionId === version.id && member.moduleId === version.moduleId && member.hash === version.hash)) throw new StewardError("conflict", "Candidate set binding is missing");
  return set;
}
function matchesCandidateTarget(member: CandidateSet["members"][number], target: CandidateAdmissionRecord["input"]["targets"][number] | undefined, module: { id: string; name: string; activeHash: string | null; status: string }) {
  return !!target && (target.moduleId === null || target.moduleId === module.id) && module.name === member.name && module.activeHash === member.expectedActiveHash && member.expectedActiveHash === target.expectedActiveHash && module.status !== "migrating";
}
async function assertCandidateMemberIn(context: ModuleContext, db: CandidateDb, set: CandidateSet, admission: CandidateAdmissionRecord, member: CandidateSet["members"][number]) {
  const module = await assertExternalModule(db, context.workspaceId, member.moduleId, "group");
  const target = admission.input.targets.find(item => item.name === member.name);
  const version = await db.moduleVersion.findUnique({ where: { id: member.versionId } });
  const binding = await db.candidateMember.findFirst({ where: { versionId: member.versionId, receipt: { admission: { workspaceId: context.workspaceId } } } });
  if (!matchesCandidateTarget(member, target, module) || !version || version.moduleId !== module.id || version.hash !== member.hash || !binding || binding.receiptId !== set.receiptId) throw new StewardError("conflict", "Candidate identity, baseline or member binding changed");
}
/** Final transaction fence, also called after a credential approval. */
export async function assertCandidateSetIn(context: ModuleContext, db: CandidateDb, set: CandidateSet) {
  const stored = await readCandidateSetIn(context, db, set.receiptId);
  if (!stored || stored.state === "approved" || stored.state === "rejected" || candidateDigest(stored) !== candidateDigest(set)) throw new StewardError("conflict", "Candidate receipt is no longer actionable");
  const admission = await readCandidateAdmissionIn(context, db, set.admissionId);
  if (admission.receiptId !== set.receiptId || admission.input.targets.length !== set.members.length || candidateDigest(admission.input.submitter) !== candidateDigest(set.submitter)) throw new StewardError("conflict", "Candidate admission binding changed");
  await assertCandidateOwner(db, context.workspaceId, admission.issuer);
  await assertCandidateSubmitter(db, context.workspaceId, set.submitter);
  for (const member of set.members) await assertCandidateMemberIn(context, db, set, admission, member);
}
export async function setCandidateSetStateIn(context: ModuleContext, db: CandidateDb, set: CandidateSet, state: CandidateSet["state"], approvalId: string | null = null) {
  const stored = await readCandidateSetIn(context, db, set.receiptId);
  if (!stored) throw new StewardError("conflict", "Candidate receipt is missing");
  if (stored.state === "approved" || stored.state === "rejected") {
    if (state !== stored.state) throw new StewardError("conflict", "Candidate receipt is terminal");
    return;
  }
  await db.candidateReceipt.update({ where: { id: set.receiptId }, data: { state, approvalId } });
}
