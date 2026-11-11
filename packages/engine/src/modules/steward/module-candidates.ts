import { moduleMaterialEntryPath } from "../../../../contracts/src/steward/module-material";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { candidateAdmissionInputSchema, candidateCheckInputSchema, candidateReceiptSchema, candidateSourceInputSchema, candidateSubmitInputSchema, type CandidateReceipt, type CandidateSubmitInput, type CandidateAdmissionOutput, type CandidateSourceOutput } from "../../../../contracts/src/steward/module-candidates";
import type { Caller } from "./module-call-types";
import type { StewardPorts } from "./ports";
import { parseInput, StewardError } from "./errors";
import { json, moduleContext, type ModuleContext } from "./module-context";
import { checkoutModule } from "./module-files";
import { moduleMaterialDigest, snapshotModuleMaterial } from "./module-artifacts";
import { commitModuleSource, readModuleMaterial, type ModuleGitRevision } from "./module-git";
import { assertCandidateAdmissionIn, assertCandidateOwner, assertCandidateSubmitter, candidateDigest, candidateRequestId, readCandidateAdmissionIn, readCandidateSetIn, type CandidateAdmissionRecord, type CandidateDb, type CandidateSet } from "./module-candidate-records";
export { findCandidateSet } from "./module-candidate-records";

async function confinedMaterial<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof StewardError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new StewardError(code === "ENOENT" ? "not_found" : "invalid", "Candidate material is unavailable or unsafe");
  }
}
async function ownContent(context: ModuleContext, moduleId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(moduleId)) throw new StewardError("forbidden", "Unsafe content identity");
  for (const directory of [context.platform, join(context.platform, "content"), join(context.platform, "content", moduleId)]) {
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== resolve(directory)) throw new StewardError("forbidden", "Unsafe content directory");
  }
  return join(context.platform, "content", moduleId);
}
/** Owner grants exactly one complete material submission to an approved application identity. */
export async function admitCandidates(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown): Promise<CandidateAdmissionOutput> {
  const input = parseInput(candidateAdmissionInputSchema, raw), context = moduleContext(ports, workspaceId);
  const admissionId = candidateRequestId("admission", workspaceId, caller, input.requestKey);
  return ports.db.$transaction(async tx => {
    await assertCandidateOwner(tx, workspaceId, caller);
    const previous = await tx.candidateAdmission.findFirst({ where: { id: admissionId, workspaceId } });
    if (previous) {
      const stored = await readCandidateAdmissionIn(context, tx, admissionId);
      if (candidateDigest(stored.input) !== candidateDigest(input)) throw new StewardError("conflict", "Admission request key was already used with different arguments");
      await assertCandidateSubmitter(tx, workspaceId, input.submitter);
      return { admissionId, ...input };
    }
    const admission: CandidateAdmissionRecord = { input, issuer: caller, receiptId: null };
    await assertCandidateAdmissionIn(context, tx, admission);
    await tx.candidateAdmission.create({ data: { id: admissionId, workspaceId, requestKey: input.requestKey, submitterModuleId: input.submitter.moduleId, submitterHash: input.submitter.hash, targets: json(input.targets), issuer: json(caller), createdAt: ports.now() } });
    return { admissionId, ...input };
  });
}
async function authorizedAdmission(context: ModuleContext, db: CandidateDb, caller: Caller, admissionId: string) {
  const admission = await readCandidateAdmissionIn(context, db, admissionId);
  await assertCandidateSubmitter(db, context.workspaceId, admission.input.submitter, caller);
  await assertCandidateOwner(db, context.workspaceId, admission.issuer);
  return admission;
}
/** Project one fixed member, retaining the terminal result after a recorded module removal. */
async function receiptMemberView(context: ModuleContext, db: CandidateDb, state: CandidateSet["state"], member: CandidateSet["members"][number]): Promise<CandidateReceipt["members"][number]> {
  const version = await db.moduleVersion.findUnique({ where: { id: member.versionId } });
  const module = await db.module.findFirst({ where: { id: member.moduleId, workspaceId: context.workspaceId } });
  if (!version || !module) {
    if ((state === "approved" || state === "rejected") && await db.moduleRemoval.findFirst({ where: { workspaceId: context.workspaceId, moduleId: member.moduleId } })) {
      return { ...member, status: state, selected: false };
    }
    throw new StewardError("conflict", "Fixed candidate member is missing");
  }
  if (version.moduleId !== member.moduleId || version.hash !== member.hash) throw new StewardError("conflict", "Fixed candidate member changed");
  return { ...member, status: candidateReceiptSchema.shape.members.element.shape.status.parse(version.status), selected: module.activeHash === member.hash };
}
async function receiptView(context: ModuleContext, db: CandidateDb, set: CandidateSet): Promise<CandidateReceipt> {
  const members: CandidateReceipt["members"] = [];
  for (const member of set.members) members.push(await receiptMemberView(context, db, set.state, member));
  const rejected = members.some(member => member.status === "rejected");
  const approved = members.every(member => member.status === "approved");
  let state = set.state;
  if (state !== "approved" && state !== "rejected") {
    if (rejected) state = "rejected";
    else if (approved) state = "approved";
  }
  // The stable receipt carries a persistent final result; selected remains a current projection.
  if (state !== set.state) {
    await db.candidateReceipt.update({ where: { id: set.receiptId }, data: { state } });
  }
  return { ...set, state, members };
}
async function replay(context: ModuleContext, db: CandidateDb, caller: Caller, input: CandidateSubmitInput) {
  const receiptId = candidateRequestId("submission", context.workspaceId, caller, input.requestKey);
  const row = await db.candidateReceipt.findFirst({ where: { id: receiptId, admission: { workspaceId: context.workspaceId } } });
  if (!row) return null;
  if (row.requestDigest !== candidateDigest(input)) throw new StewardError("conflict", "Submission request key was already used with different arguments");
  await authorizedAdmission(context, db, caller, input.admissionId);
  const set = (await readCandidateSetIn(context, db, receiptId))!;
  return receiptView(context, db, set);
}
function exactItems(admission: CandidateAdmissionRecord, input: CandidateSubmitInput) {
  if (admission.input.targets.length !== input.items.length || !admission.input.targets.every(target => input.items.some(item => item.name === target.name))) throw new StewardError("conflict", "Submit exactly the complete admitted target set");
}
async function freezeItems(context: ModuleContext, admission: CandidateAdmissionRecord, input: CandidateSubmitInput) {
  const root = await ownContent(context, admission.input.submitter.moduleId);
  const frozen = [];
  for (const item of input.items) {
    const files = await snapshotModuleMaterial(root, item.dir);
    const manifestFile = files.find(file => file.path === "module.json");
    let rawManifest: unknown;
    try { rawManifest = JSON.parse(Buffer.from(manifestFile?.bytes ?? []).toString("utf8")); }
    catch { throw new StewardError("invalid", "Candidate module.json is missing or invalid"); }
    const manifest = parseInput(moduleManifestSchema, rawManifest);
    if (manifest.name !== item.name || !files.some(file => file.path === moduleMaterialEntryPath(manifest.entry)) || (manifest.data.migrate && !files.some(file => file.path === manifest.data.migrate))) throw new StewardError("invalid", "Candidate name, entry or migration material does not match its manifest");
    const target = admission.input.targets.find(target => target.name === item.name)!;
    frozen.push({ item, target, manifest, files, moduleId: target.moduleId ?? randomUUID(), versionId: randomUUID(), materialDigest: moduleMaterialDigest(files) });
  }
  return frozen;
}
/** Freeze all bytes and Git revisions before exposing any version to the checker. */
export async function submitCandidates(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown): Promise<CandidateReceipt> {
  const input = parseInput(candidateSubmitInputSchema, raw), context = moduleContext(ports, workspaceId);
  const initial = await ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return { previous };
    const admission = await authorizedAdmission(context, tx, caller, input.admissionId);
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    exactItems(admission, input);
    await assertCandidateAdmissionIn(context, tx, admission, caller);
    return { admission };
  });
  if (initial.previous) return initial.previous;
  const frozen = await confinedMaterial(() => freezeItems(context, initial.admission!, input));
  // Identity can change while application content is being read. No runnable rows exist yet.
  const completed = await ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return previous;
    const admission = await authorizedAdmission(context, tx, caller, input.admissionId);
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    await assertCandidateAdmissionIn(context, tx, admission, caller);
    return null;
  });
  if (completed) return completed;
  const revisions: ModuleGitRevision[] = [];
  try {
    for (const item of frozen) revisions.push(await commitModuleSource({ platform: context.platform, moduleId: item.moduleId, versionId: item.versionId, files: item.files, message: item.item.intent.changes.join("; ") }));
  } catch (error) {
    // A parallel identical request can win the Git branch update. Its durable
    // receipt is still authoritative; private unreferenced objects grant nothing.
    const previous = await ports.db.$transaction(tx => replay(context, tx, caller, input));
    if (previous) return previous;
    throw error;
  }
  return ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return previous;
    const admission = await authorizedAdmission(context, tx, caller, input.admissionId);
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    await assertCandidateAdmissionIn(context, tx, admission, caller);
    const receiptId = candidateRequestId("submission", workspaceId, caller, input.requestKey);
    const set: CandidateSet = { receiptId, admissionId: input.admissionId, requestKey: input.requestKey, submitter: admission.input.submitter, members: [], state: "submitted", approvalId: null };
    for (const [index, item] of frozen.entries()) {
      const revision = revisions[index]!;
      if (await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: item.moduleId, hash: revision.commit } } })) throw new StewardError("conflict", "Candidate version already exists; terminal versions cannot be resubmitted");
      if (item.target.moduleId === null) await tx.module.create({ data: { id: item.moduleId, workspaceId, name: item.item.name } });
      await tx.moduleVersion.create({ data: { id: item.versionId, moduleId: item.moduleId, hash: revision.commit, manifest: json(item.manifest), intent: json(item.item.intent), report: json({ tests: [], git: revision }), status: "building", source: "candidate", createdAt: ports.now() } });
      set.members.push({ name: item.item.name, moduleId: item.moduleId, hash: revision.commit, versionId: item.versionId, materialDigest: item.materialDigest, expectedActiveHash: item.target.expectedActiveHash });
    }
    await tx.candidateReceipt.create({ data: { id: receiptId, admissionId: input.admissionId, requestKey: input.requestKey, requestDigest: candidateDigest(input), state: set.state, approvalId: null, createdAt: ports.now(), members: json(set.members), memberBindings: { create: set.members.map(member => ({ versionId: member.versionId })) } } });
    return receiptView(context, tx, set);
  });
}
/** Export only an admitted target's expected approved baseline, into the real caller's own content. */
export async function candidateSource(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown): Promise<CandidateSourceOutput> {
  const input = parseInput(candidateSourceInputSchema, raw), context = moduleContext(ports, workspaceId);
  const authorize = async (db: CandidateDb) => {
    const admission = await authorizedAdmission(context, db, caller, input.admissionId);
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    await assertCandidateAdmissionIn(context, db, admission, caller);
    if (!admission.input.targets.some(target => target.moduleId === input.moduleId && target.expectedActiveHash === input.hash)) throw new StewardError("forbidden", "Source is outside this admission's exact targets");
    const version = await db.moduleVersion.findFirst({ where: { moduleId: input.moduleId, hash: input.hash, status: "approved", module: { workspaceId } } });
    if (!version || !/^[a-f0-9]{40}$/.test(version.hash)) throw new StewardError("conflict", "An immutable Git source version is required");
    return admission;
  };
  const admission = await ports.db.$transaction(authorize);
  const files = await confinedMaterial(() => readModuleMaterial({ platform: context.platform, moduleId: input.moduleId, commit: input.hash }));
  const root = await confinedMaterial(() => ownContent(context, admission.input.submitter.moduleId));
  await ports.db.$transaction(async tx => {
    await authorize(tx);
    await confinedMaterial(() => checkoutModule(root, input.to, files));
    await authorize(tx);
  });
  return { moduleId: input.moduleId, hash: input.hash, materialDigest: moduleMaterialDigest(files) };
}
/** Query a fixed receipt. This never selects latest, retries a build or authorizes execution. */
export async function checkCandidates(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown): Promise<CandidateReceipt> {
  const input = parseInput(candidateCheckInputSchema, raw), context = moduleContext(ports, workspaceId);
  return ports.db.$transaction(async tx => {
    let set: CandidateSet | null;
    if ("receiptId" in input) set = await readCandidateSetIn(context, tx, input.receiptId);
    else {
      const admission = await readCandidateAdmissionIn(context, tx, input.admissionId);
      set = admission.receiptId ? await readCandidateSetIn(context, tx, admission.receiptId) : null;
      if (set && set.requestKey !== input.requestKey) throw new StewardError("conflict", "Submission request key does not match the fixed receipt");
    }
    if (!set) throw new StewardError("not_found", "Candidate receipt not found");
    if (caller.kind === "module" && caller.moduleId === set.submitter.moduleId) await assertCandidateSubmitter(tx, workspaceId, set.submitter, caller);
    else await assertCandidateOwner(tx, workspaceId, caller);
    return receiptView(context, tx, set);
  });
}
