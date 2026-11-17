import { moduleMaterialEntryPath } from "../../../contracts/src/steward/module-material";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { candidateAdmissionInputSchema, candidateCheckInputSchema, candidateReceiptSchema, candidateSourceInputSchema, candidateSubmitInputSchema, type CandidateReceipt, type CandidateSubmitInput, type CandidateAdmissionOutput, type CandidateSourceOutput } from "../../../contracts/src/steward/module-candidates";
import type { Caller } from "./module-call-types";
import { CallError } from "./module-call-error";
import type { StewardPorts } from "../ports";
import { parseInput, StewardError } from "../errors";
import { json, moduleContext, type ModuleContext } from "./module-context";
import { checkoutModule } from "./module-files";
import { moduleMaterialDigest, snapshotModuleMaterial } from "./module-artifacts";
import { storeVersionMaterial, readStoredVersionMaterial } from "./module-artifacts";
import { assertCandidateAdmissionIn, assertCandidateOwner, assertCandidateSubmitter, candidateDigest, candidateRequestId, readCandidateAdmissionIn, readCandidateSetIn, type CandidateAdmissionRecord, type CandidateDb, type CandidateSet } from "./module-candidate-records";

async function confinedMaterial<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof StewardError || error instanceof CallError) throw error;
    console.error(JSON.stringify({ component: "module-candidates", event: "material.unavailable", error: String(error) }));
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
    await tx.candidateAdmission.create({ data: { id: admissionId, workspaceId, requestKey: input.requestKey, submitterModuleId: input.submitter.moduleId, submitterHash: input.submitter.hash, targets: json([input.target]), issuer: json(caller), createdAt: ports.now() } });
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
async function receiptMemberView(context: ModuleContext, db: CandidateDb, state: CandidateSet["state"], member: CandidateSet["member"]): Promise<CandidateReceipt["member"]> {
  const version = await db.moduleVersion.findUnique({ where: { id: member.versionId } });
  const module = await db.module.findFirst({ where: { id: member.moduleId, workspaceId: context.workspaceId } });
  if (!version || !module) {
    if ((state === "approved" || state === "rejected") && await db.moduleRemoval.findFirst({ where: { workspaceId: context.workspaceId, moduleId: member.moduleId } })) {
      return { ...member, status: state, selected: false };
    }
    throw new StewardError("conflict", "Fixed candidate member is missing");
  }
  if (version.moduleId !== member.moduleId || version.hash !== member.hash) throw new StewardError("conflict", "Fixed candidate member changed");
  return { ...member, status: candidateReceiptSchema.shape.member.shape.status.parse(version.status), selected: module.activeHash === member.hash };
}
async function receiptView(context: ModuleContext, db: CandidateDb, set: CandidateSet): Promise<CandidateReceipt> {
  const member = await receiptMemberView(context, db, set.state, set.member);
  const rejected = member.status === "rejected";
  const approved = member.status === "approved";
  let state = set.state;
  if (state !== "approved" && state !== "rejected") {
    if (rejected) state = "rejected";
    else if (approved) state = "approved";
  }
  // The stable receipt carries a persistent final result; selected remains a current projection.
  if (state !== set.state) {
    await db.candidateReceipt.update({ where: { id: set.receiptId }, data: { state } });
  }
  return { ...set, state, member };
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
function exactItem(admission: CandidateAdmissionRecord, input: CandidateSubmitInput) {
  if (admission.input.target.name !== input.item.name) throw new StewardError("conflict", "Submit exactly the admitted target");
}
/** Only the claimed system invocation can prove refusal; publication fences exclude competing direct calls. */
async function submissionRefusal<T>(proof: boolean, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (proof && error instanceof StewardError && error.code !== "conflict" && !("reason" in error)) throw new CallError(error.code, error.message, "submission_refused");
    throw error;
  }
}
async function freezeItem(context: ModuleContext, admission: CandidateAdmissionRecord, input: CandidateSubmitInput) {
  const root = await ownContent(context, admission.input.submitter.moduleId);
  const item = input.item;
  const files = await snapshotModuleMaterial(root, item.dir);
  const manifestFile = files.find(file => file.path === "module.json");
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(Buffer.from(manifestFile?.bytes ?? []).toString("utf8")); }
  catch (error) { throw new StewardError("invalid", `Candidate module.json is missing or invalid: ${error instanceof SyntaxError ? "invalid JSON" : "missing manifest"}`); }
  const manifest = parseInput(moduleManifestSchema, rawManifest);
  if (manifest.name !== item.name || !files.some(file => file.path === moduleMaterialEntryPath(manifest.entry)) || (manifest.data.migrate && !files.some(file => file.path === manifest.data.migrate))) throw new StewardError("invalid", "Candidate name, entry or migration material does not match its manifest");
  const target = admission.input.target;
  return { item, target, manifest, files, moduleId: target.moduleId ?? randomUUID(), versionId: randomUUID(), materialDigest: moduleMaterialDigest(files) };
}
async function submissionInvocation(db: CandidateDb, workspaceId: string, caller: Caller, input: CandidateSubmitInput) {
  if (caller.kind !== "module") return null;
  return db.moduleInvocation.findFirst({
    where: { workspaceId, caller: `module:${caller.moduleId}`, callerHash: caller.hash,
      targetIdentity: "system:modules", tool: "submit", key: input.requestKey, mode: "sync" },
    select: { id: true, status: true, errorReason: true },
  });
}
/** Retain verified material before exposing a runnable version to the checker. */
export async function submitCandidates(
  ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown,
  { invocationId }: { invocationId?: string } = {},
): Promise<CandidateReceipt> {
  const input = parseInput(candidateSubmitInputSchema, raw), context = moduleContext(ports, workspaceId);
  const initial = await ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return { previous };
    if (invocationId) {
      const invocation = await submissionInvocation(tx, workspaceId, caller, input);
      if (invocation?.id !== invocationId || invocation.status !== "running") throw new StewardError("conflict", "Candidate submission invocation is not current");
    }
    const admission = await submissionRefusal(!!invocationId, () => authorizedAdmission(context, tx, caller, input.admissionId));
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    exactItem(admission, input);
    await submissionRefusal(!!invocationId, () => assertCandidateAdmissionIn(context, tx, admission, caller));
    return { admission };
  });
  if (initial.previous) return initial.previous;
  // Classify explicit material refusals before confinedMaterial translates raw I/O errors.
  const frozen = await confinedMaterial(() => submissionRefusal(!!invocationId, () => freezeItem(context, initial.admission!, input)));
  // Identity can change while application content is being read. No runnable rows exist yet.
  const completed = await ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return previous;
    const admission = await submissionRefusal(!!invocationId, () => authorizedAdmission(context, tx, caller, input.admissionId));
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    await submissionRefusal(!!invocationId, () => assertCandidateAdmissionIn(context, tx, admission, caller));
    return null;
  });
  if (completed) return completed;
  await storeVersionMaterial(context.platform, frozen.files);
  return ports.db.$transaction(async tx => {
    const previous = await replay(context, tx, caller, input);
    if (previous) return previous;
    // The routed invocation owns this key until a terminal outcome, and after a
    // proven refusal. Run interruption can leave its handler executing as unknown.
    // Fence publication so direct calls already freezing cannot invalidate proof.
    const invocation = await submissionInvocation(tx, workspaceId, caller, input);
    if (invocation && invocation.id !== invocationId && (
      invocation.status !== "succeeded" && invocation.status !== "failed" || invocation.errorReason === "submission_refused"
    )) throw new StewardError("conflict", "Candidate submission belongs to a routed invocation");
    const admission = await authorizedAdmission(context, tx, caller, input.admissionId);
    if (admission.receiptId) throw new StewardError("conflict", "Candidate admission was already consumed");
    await assertCandidateAdmissionIn(context, tx, admission, caller);
    const receiptId = candidateRequestId("submission", workspaceId, caller, input.requestKey);
    const set: CandidateSet = {
      receiptId, admissionId: input.admissionId, requestKey: input.requestKey,
      submitter: admission.input.submitter, member: { name: frozen.item.name, moduleId: frozen.moduleId, hash: frozen.materialDigest, versionId: frozen.versionId, materialDigest: frozen.materialDigest, expectedActiveHash: frozen.target.expectedActiveHash }, state: "submitted", approvalId: null,
    };
    {
      const item = frozen;
      if (await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: item.moduleId, hash: frozen.materialDigest } } })) throw new StewardError("conflict", "Candidate version already exists; terminal versions cannot be resubmitted");
      if (item.target.moduleId === null) await tx.module.create({ data: { id: item.moduleId, workspaceId, name: item.item.name } });
      await tx.moduleVersion.create({ data: { id: item.versionId, moduleId: item.moduleId, hash: frozen.materialDigest, manifest: json(item.manifest), intent: json(item.item.intent), report: json({ tests: [] }), status: "building", source: "candidate", createdAt: ports.now() } });
    }
    await tx.candidateReceipt.create({ data: { id: receiptId, admissionId: input.admissionId, requestKey: input.requestKey, requestDigest: candidateDigest(input), state: set.state, approvalId: null, createdAt: ports.now(), members: json([set.member]), memberBindings: { create: { versionId: set.member.versionId } } } });
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
    if (!(admission.input.target.moduleId === input.moduleId && admission.input.target.expectedActiveHash === input.hash)) throw new StewardError("forbidden", "Source is outside this admission's exact target");
    const version = await db.moduleVersion.findFirst({ where: { moduleId: input.moduleId, hash: input.hash, status: "approved", module: { workspaceId } } });
    if (!version || !/^[a-f0-9]{64}$/.test(version.hash)) throw new StewardError("conflict", "An immutable material version is required");
    return admission;
  };
  const admission = await ports.db.$transaction(authorize);
  const files = await confinedMaterial(() => readStoredVersionMaterial(context.platform, input.hash));
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
