import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import { readModuleFiles } from "./module-preview";
import { moduleInstallRequestSchema, moduleInstallResultSchema, OFFICIAL_EXTERNAL_MODULE_NAMES, type ModuleInstallRequest, type ModuleInstallResult } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { ExternalModuleInstaller } from "./module-install-types";
import { resolveExternalRelease } from "./module-release";
import { assertExternalName } from "./module-identity";
import { parseInput, StewardError } from "./errors";

export const installationId = (workspaceId: string, requestKey: string) => `module-install:${createHash("sha256").update(workspaceId).update("\0").update(requestKey).digest("hex")}`;
const detailsOf = (request: ModuleInstallRequest, result: ModuleInstallResult) => ({ request, result });
const latestInstallationId = (workspaceId: string, name: string) => `module-install-latest:${createHash("sha256").update(workspaceId).update("\0").update(name).digest("hex")}`;
const submissionId = (workspaceId: string, key: string) => `${installationId(workspaceId, key)}:submission`;
const activeSubmissions = new WeakMap<StewardPorts["db"], Set<string>>();
type Submission = { hash: string; moduleId: string | null; existingVersionId: string | null; marker: string; phase: "prepared" | "proposing" | "submitted"; error?: string };
function failure(result: ModuleInstallResult, reason: string, message: string, code: NonNullable<ModuleInstallResult["error"]>["code"] = "failed"): ModuleInstallResult {
  return { ...result, status: "failed", approvalId: null, error: { code, reason, message: redactSensitiveText(message).slice(0, 1000) } };
}
/** Queue only: tests, dependency installation and activation remain in the existing background build. */
export function createExternalModuleInstaller(ports: StewardPorts): ExternalModuleInstaller {
  return async ({ workspaceId, request, release }) => {
    // Re-resolve immediately before copying; never trust an adapter argument as a host path.
    const trusted = await resolveExternalRelease(ports, request.package);
    if (release.name !== trusted.name || release.origin !== "external" || release.codeDir !== trusted.codeDir || release.hash !== trusted.hash) throw new StewardError("conflict", "External release changed before submission");
    const { id, marker, submission } = await prepareSubmission(ports, workspaceId, request, release.hash);
    const root = await realpath(await mkdtemp(join(tmpdir(), "chrona-install-")));
    try {
      await copyRelease(trusted, root, request.package);
      submission.phase = "proposing";
      await ports.db.audit.update({ where: { id }, data: { details: submission } });
      const proposal = await propose(moduleContext(ports, workspaceId), { root, dir: request.package, intent: { changes: [marker], preserves: [] }, allowed: [request.package] }, "user");
      if (proposal.hash !== trusted.hash) throw new StewardError("conflict", "Proposal hash differs from the selected release");
      submission.moduleId = proposal.moduleId;
      submission.phase = "submitted";
      await ports.db.audit.update({ where: { id }, data: { subjectId: proposal.moduleId, details: submission } });
      const result: ModuleInstallResult = { package: request.package, requestKey: request.requestKey, status: "building", moduleId: proposal.moduleId, hash: proposal.hash, approvalId: proposal.approvalId ?? null, error: null };
      return proposal.status === "rejected" ? failure(result, "installation_rejected", proposalRejection(proposal.report.errors)) : installationFacts(ports, workspaceId, result);
    } catch (error) {
      if (submission.phase === "prepared") {
        submission.error = redactSensitiveText(error instanceof Error ? error.message : "Release copy failed").slice(0, 1000);
        await ports.db.audit.update({ where: { id }, data: { details: submission } });
      }
      throw error;
    } finally { await rm(root, { recursive: true, force: true }); }
  };
}
async function prepareSubmission(ports: StewardPorts, workspaceId: string, request: ModuleInstallRequest, hash: string) {
  const id = submissionId(workspaceId, request.requestKey);
  const previous = await ports.db.audit.findUnique({ where: { id } });
  if (previous) throw new StewardError("conflict", "Installation submission already exists; reconcile the original request");
  const module = await assertExternalName(ports.db, workspaceId, request.package, "install");
  if ((request.mode === "install") === Boolean(module)) throw new StewardError("conflict", "Module identity changed before installation; reconcile the original request");
  const existing = module ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } }) : null;
  const marker = `Official installation ${installationId(workspaceId, request.requestKey)}`;
  const submission: Submission = { hash, moduleId: module?.id ?? null, existingVersionId: existing?.id ?? null, marker, phase: "prepared" };
  // This evidence survives a crash after propose has queued a version but before the receipt returns.
  await ports.db.audit.create({ data: { id, workspaceId, actorKey: "kernel", kind: "module_installation_submission", subjectId: module?.id ?? null, details: submission, createdAt: ports.now() } });
  return { id, marker, submission };
}
async function copyRelease(trusted: Awaited<ReturnType<typeof resolveExternalRelease>>, root: string, name: string) {
  const files = (await readModuleFiles(trusted.codeDir, "Unsafe official release file")).sort((a, b) => a.path.localeCompare(b.path));
  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  if (digest.digest("hex") !== trusted.hash) throw new StewardError("conflict", "External release changed while copying");
  const target = join(root, name);
  await mkdir(target);
  for (const file of files) {
    const path = join(target, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes, { mode: 0o600 });
  }
}
async function installationFacts(ports: StewardPorts, workspaceId: string, result: ModuleInstallResult): Promise<ModuleInstallResult> {
  if (!result.moduleId || !result.hash) return result;
  const module = await ports.db.module.findFirst({ where: { id: result.moduleId, workspaceId, name: result.package } });
  if (!module) return failure(result, "module_removed", "The submitted module was removed; explicitly install it again", "not_found");
  if (module.builtin) return failure(result, "module_identity_conflict", "The installation target is now immutable", "conflict");
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: result.hash } } });
  if (!version) return failure(result, "version_missing", "The submitted version is missing; inspect diagnostics before retrying", "not_found");
  if (version.status === "approved") return approvedInstallation(result, module.activeHash);
  if (version.status === "rejected") {
    const errors = (version.report as { errors?: unknown } | null)?.errors;
    return failure(result, "installation_rejected", Array.isArray(errors) ? errors.filter(e => typeof e === "string").join("; ") : "Module checks failed; inspect the version report");
  }
  if (version.status === "pending_review" || module.status === "migrating") {
    return installationApproval(ports, workspaceId, module.id, result);
  }
  return { ...result, status: "building", approvalId: null, error: null };
}
function approvedInstallation(result: ModuleInstallResult, activeHash: string | null): ModuleInstallResult {
  return activeHash === result.hash ? { ...result, status: "installed", approvalId: null, error: null }
    : failure(result, "candidate_inactive", "Checks approved this version but it is not selected; inspect the current version before updating", "conflict");
}
async function installationApproval(ports: StewardPorts, workspaceId: string, moduleId: string, result: ModuleInstallResult): Promise<ModuleInstallResult> {
  const approvals = await ports.db.approval.findMany({ where: { workspaceId, moduleId, action: "activate_module" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const approval = approvals.find(row => (row.payload as { hash?: unknown } | null)?.hash === result.hash);
  if (approval && ["denied", "expired"].includes(approval.status)) return failure(result, "approval_unavailable", "Installation approval was denied or expired; inspect the candidate before retrying", "conflict");
  return { ...result, status: "pending_approval", approvalId: approval?.id ?? null, error: null };
}
/** Recover from persisted proposal/version facts, never repeat a possibly executed proposal. */
export async function refreshInstallationReceipts(ports: StewardPorts, workspaceId: string): Promise<void> {
  // Four official packages: refresh their latest receipts in ticks. Older keys reconcile on explicit lookup.
  const pointers = await Promise.all(OFFICIAL_EXTERNAL_MODULE_NAMES.map(name => ports.db.audit.findUnique({ where: { id: latestInstallationId(workspaceId, name) } })));
  const ids = pointers.flatMap(pointer => {
    const id = (pointer?.details as { installationId?: unknown } | null)?.installationId;
    return typeof id === "string" ? [id] : [];
  });
  await refreshReceipts(ports, workspaceId, ids);
}
async function refreshReceipts(ports: StewardPorts, workspaceId: string, ids: string[]): Promise<void> {
  const rows = await ports.db.audit.findMany({ where: { workspaceId, kind: "module_installation", id: { in: ids } } });
  for (const row of rows) {
    const result = moduleInstallResultSchema.parse((row.details as unknown as ReturnType<typeof detailsOf>).result);
    if (!["pending", "building", "pending_approval"].includes(result.status) || activeSubmissions.get(ports.db)?.has(row.id)) continue;
    if (result.status === "pending") {
      const recovered = await recoverSubmission(ports, workspaceId, row, result);
      if (!recovered) continue;
      result.moduleId = recovered.moduleId; result.hash = recovered.hash;
    }
    await recordInstallationResult(ports, workspaceId, await installationFacts(ports, workspaceId, result));
  }
}
async function removedSubmission(ports: StewardPorts, workspaceId: string, createdAt: Date, name: string, hash: string) {
  const removals = await ports.db.audit.findMany({ where: { workspaceId, kind: "module_removed", createdAt: { gte: createdAt } } });
  return removals.find(event => (event.details as { name?: unknown; hash?: unknown } | null)?.name === name && (event.details as { hash?: unknown } | null)?.hash === hash);
}
function attributedVersion(version: { id: string; intent: unknown } | null, submission: Submission): version is NonNullable<typeof version> {
  const changes = (version?.intent as { changes?: unknown } | null)?.changes;
  return !!version && (version.id === submission.existingVersionId || Array.isArray(changes) && changes.includes(submission.marker));
}
async function recoverSubmission(ports: StewardPorts, workspaceId: string, row: { createdAt: Date }, result: ModuleInstallResult) {
  const audit = await ports.db.audit.findUnique({ where: { id: submissionId(workspaceId, result.requestKey) } });
  if (!audit) return null; // An adapter may report an unknown outcome without our proposal evidence; do not guess.
  const submission = audit.details as unknown as Submission;
  if (submission.phase === "prepared") {
    await recordInstallationResult(ports, workspaceId, failure(result, "submission_not_started", submission.error ?? "Resource preparation was interrupted before proposal; explicitly retry with a new request key"));
    return null;
  }
  if (!submission.moduleId) {
    const removed = await removedSubmission(ports, workspaceId, row.createdAt, result.package, submission.hash);
    if (removed?.subjectId) {
      await recordInstallationResult(ports, workspaceId, failure({ ...result, moduleId: removed.subjectId, hash: submission.hash }, "module_removed", "The submitted module was removed; a same-name installation cannot take over its receipt", "not_found"));
      return null;
    }
  }
  const module = submission.moduleId
    ? await ports.db.module.findFirst({ where: { id: submission.moduleId, workspaceId, name: result.package } })
    : await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name: result.package } } });
  if (!module) {
    const removedId = submission.moduleId;
    await recordInstallationResult(ports, workspaceId, removedId
      ? failure({ ...result, moduleId: removedId, hash: submission.hash }, "module_removed", "The submitted module was removed; explicitly install it again", "not_found")
      : { ...result, error: { code: "conflict", reason: "submission_unconfirmed", message: "Proposal was started but no attributable module remains; inspect diagnostics before explicitly retrying" } });
    return null;
  }
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: submission.hash } } });
  if (!attributedVersion(version, submission)) {
    await recordInstallationResult(ports, workspaceId, { ...result, error: { code: "conflict", reason: "submission_unconfirmed", message: "Proposal outcome cannot be attributed to this request; inspect the recorded candidate and diagnostics before explicitly retrying" } });
    return null;
  }
  return { moduleId: module.id, hash: version.hash };
}
export async function installExternal(ports: StewardPorts, workspaceId: string, raw: ModuleInstallRequest): Promise<ModuleInstallResult> {
  const request = parseInput(moduleInstallRequestSchema, raw), id = installationId(workspaceId, request.requestKey);
  const claim = await ports.db.$transaction(async tx => {
    const previous = await tx.audit.findUnique({ where: { id } });
    if (previous) {
      const details = previous.details as unknown as ReturnType<typeof detailsOf>;
      if (details.request.package !== request.package || details.request.mode !== request.mode) throw new StewardError("conflict", "Install requestKey already belongs to another request");
      return { result: moduleInstallResultSchema.parse(details.result), claimed: false };
    }
    const module = await assertExternalName(tx, workspaceId, request.package, "install");
    if (module && request.mode === "install") throw new StewardError("conflict", "Module already installed; explicitly select update");
    if (!module && request.mode === "update") throw new StewardError("not_found", "Module not installed; explicitly select install");
    const result: ModuleInstallResult = { package: request.package, requestKey: request.requestKey, status: "pending", moduleId: module?.id ?? null, hash: null, approvalId: null, error: null };
    await tx.audit.create({ data: { id, workspaceId, actorKey: "kernel", kind: "module_installation", subjectId: module?.id ?? null, details: detailsOf(request, result), createdAt: ports.now() } });
    await tx.audit.upsert({ where: { id: latestInstallationId(workspaceId, request.package) }, create: { id: latestInstallationId(workspaceId, request.package), workspaceId, actorKey: "kernel", kind: "module_installation_latest", details: { installationId: id }, createdAt: ports.now() }, update: { details: { installationId: id } } });
    return { result, claimed: true };
  });
  if (!claim.claimed) {
    if (["pending", "building", "pending_approval"].includes(claim.result.status)) {
      await refreshReceipts(ports, workspaceId, [id]);
      const row = await ports.db.audit.findUniqueOrThrow({ where: { id } });
      return moduleInstallResultSchema.parse((row.details as unknown as ReturnType<typeof detailsOf>).result);
    }
    return claim.result;
  }
  let active = activeSubmissions.get(ports.db);
  if (!active) { active = new Set(); activeSubmissions.set(ports.db, active); }
  active.add(id);
  let result: ModuleInstallResult;
  try {
    const release = await resolveExternalRelease(ports, request.package);
    result = ports.moduleExternalInstaller ? moduleInstallResultSchema.parse(await ports.moduleExternalInstaller({ workspaceId, request, release })) : {
      ...claim.result, status: "unavailable", error: { code: "unavailable", reason: "installer_unavailable", message: "External proposal adapter is not configured" },
    };
    if (result.package !== request.package || result.requestKey !== request.requestKey) throw new StewardError("invalid", "Installer returned a different request identity");
  } catch (error) {
    const submission = await ports.db.audit.findUnique({ where: { id: submissionId(workspaceId, request.requestKey) } });
    result = submission ? { ...claim.result, status: "pending", error: null } : installationFailure(claim.result, error);
  }
  try {
    await recordInstallationResult(ports, workspaceId, result);
  } finally { active.delete(id); }
  if (result.status === "pending") {
    await refreshReceipts(ports, workspaceId, [id]);
    const row = await ports.db.audit.findUniqueOrThrow({ where: { id } });
    return moduleInstallResultSchema.parse((row.details as unknown as ReturnType<typeof detailsOf>).result);
  }
  return result;
}
/** B updates this same receipt after the existing build/approval completes, then initialization can converge. */
export async function recordInstallationResult(ports: StewardPorts, workspaceId: string, raw: ModuleInstallResult) {
  const result = moduleInstallResultSchema.parse(raw), id = installationId(workspaceId, result.requestKey);
  await ports.db.$transaction(async tx => {
    const row = await tx.audit.findUniqueOrThrow({ where: { id } });
    const previous = row.details as unknown as ReturnType<typeof detailsOf>;
    if (previous.request.package !== result.package) throw new StewardError("conflict", "Installation receipt identity mismatch");
    await tx.audit.update({ where: { id }, data: { subjectId: result.moduleId, details: detailsOf(previous.request, result) } });
  });
}
export async function externalPackageCatalog(ports: StewardPorts, workspaceId: string) {
  return Promise.all(OFFICIAL_EXTERNAL_MODULE_NAMES.map(async name => {
    const module = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
    const pointer = await ports.db.audit.findUnique({ where: { id: latestInstallationId(workspaceId, name) } });
    const receiptId = (pointer?.details as { installationId?: string } | null)?.installationId;
    const receipt = receiptId ? await ports.db.audit.findUnique({ where: { id: receiptId } }) : null;
    const installation = receipt ? moduleInstallResultSchema.parse((receipt.details as unknown as ReturnType<typeof detailsOf>).result) : null;
    try {
      const release = await resolveExternalRelease(ports, name);
      return { name, description: release.manifest.description ?? null, available: true, releaseHash: release.hash, moduleId: module?.id ?? null, installation, error: null };
    } catch (error) {
      return { name, description: null, available: false, releaseHash: null, moduleId: module?.id ?? null, installation, error: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Release unavailable" };
    }
  }));
}

function installationFailure(result: ModuleInstallResult, error: unknown): ModuleInstallResult {
  return { ...result, status: "failed", error: { code: error instanceof StewardError ? error.code : "failed", reason: error instanceof Error && "reason" in error ? String(error.reason) : "installation_failed", message: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Installation failed" } };
}

function proposalRejection(errors: string[] | undefined) {
  return errors?.join("; ") ?? "Official module proposal was rejected";
}
