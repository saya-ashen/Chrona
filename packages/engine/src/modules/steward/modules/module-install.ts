import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { z } from "zod";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { recordModuleUpstream, submitMergedCommit } from "./module-upstream";
import { moduleContext, type ModuleContext, type ModuleVersion } from "./module-context";
import { verifyModuleGitBundle } from "./module-git-upstream";
import { propose } from "./module-proposal";
import { moduleSourceFiles, storeModuleArtifacts } from "./module-artifacts";
import { checkoutModule } from "./module-files";
import { moduleInitializationStateSchema, moduleInstallRequestSchema, moduleInstallResultSchema, OFFICIAL_EXTERNAL_MODULE_NAMES, PREINSTALLED_MODULE_NAMES, type ModuleInstallRequest, type ModuleInstallResult } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import type { ExternalModuleInstaller, InstallationRequest } from "./module-install-types";
import { readReleaseMaterial, resolveExternalRelease, type ModuleRelease } from "./module-release";
import { assertExternalName } from "./module-identity";
import { parseInput, StewardError } from "../errors";
import { isModulePaused, ModuleUnavailableError } from "./module-availability";
import { rejectedUpdateNotice } from "./module-activation-notice";
import { prepareExactReleaseUpdate, readExactReleaseBaselineIn } from "./module-exact-release";
import type { Caller } from "./module-call-types";
import { diagnosticText } from "./module-diagnostics";
import type { BuildReport } from "./module-context";

export function rejectionSummary(report: unknown): string {
  const build = report as Partial<BuildReport> | null;
  const error = build?.errors?.find(error => error.trim())
    ?? build?.typecheck?.errors?.find(error => error.message.trim())?.message;
  const failed = [...(build?.tests ?? []), ...(build?.migration ? [build.migration] : [])].find(test => test.exitCode !== 0 && (test.stderr.trim() || test.stdout.trim()));
  const message = error ?? (failed?.stderr.trim() ? failed.stderr : failed?.stdout) ?? "Module checks failed; inspect the version report";
  return diagnosticText(message, 300, !error && !!failed).slice(0, 300);
}

export const installationId = (workspaceId: string, requestKey: string) => `module-install:${createHash("sha256").update(workspaceId).update("\0").update(requestKey).digest("hex")}`;
const submissionId = (workspaceId: string, key: string) => `${installationId(workspaceId, key)}:submission`;
const activeSubmissions = new WeakMap<StewardPorts["db"], Set<string>>();
const submissionSchema = z.object({
  hash: z.string(), moduleId: z.string().nullable(), existingVersionId: z.string().nullable(), marker: z.string(),
  phase: z.enum(["prepared", "proposing", "submitted"]), error: z.string().nullable(),
});
type Submission = z.infer<typeof submissionSchema>;
function installationResult(row: Prisma.ModuleInstallationGetPayload<object>): ModuleInstallResult {
  return moduleInstallResultSchema.parse({ package: row.package, requestKey: row.requestKey, status: row.status, moduleId: row.moduleId, hash: row.hash, approvalId: row.approvalId,
    error: row.errorCode === null ? null : { code: row.errorCode, reason: row.errorReason, message: row.errorMessage } });
}
function resultData(result: ModuleInstallResult) {
  const { error, ...data } = result;
  return { ...data, errorCode: error?.code ?? null, errorReason: error?.reason ?? null, errorMessage: error?.message ?? null };
}
function failure(result: ModuleInstallResult, reason: string, message: string, code: NonNullable<ModuleInstallResult["error"]>["code"] = "failed"): ModuleInstallResult {
  return { ...result, status: "failed", approvalId: null, error: { code, reason, message: redactSensitiveText(message).slice(0, 1000) } };
}
/** Queue only: tests, dependency installation and activation remain in the existing background build. */
export function createExternalModuleInstaller(ports: StewardPorts): ExternalModuleInstaller {
  return async ({ workspaceId, request, release, exactReleaseUpdate }) => {
    // Re-resolve immediately before copying; never trust an adapter argument as a host path.
    const trusted = await revalidateInstallationRelease(ports, request.package, release);
    if (!trusted.git) throw new StewardError("invalid", "Official installation requires a pinned Git release");
    // The update destination is independent of whether this exact offline commit has been published.
    const shipped = PREINSTALLED_MODULE_NAMES.some(name => name === request.package) || request.package === "qq";
    const git = { ...trusted.git, ...(shipped ? { defaultRepository: `https://github.com/chrona-core/chrona-module-${request.package}` } : {}) };
    const { id, marker, submission } = await prepareSubmission(ports, workspaceId, request, release.hash);
    const root = await realpath(await mkdtemp(join(tmpdir(), "chrona-install-")));
    try {
      const context = moduleContext(ports, workspaceId), intent = { changes: [marker], preserves: [] };
      await copyRelease(trusted, root, request.package, context.platform);
      const prepared = async (commit: string) => {
        submission.hash = commit;
        submission.existingVersionId = submission.moduleId ? (await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: submission.moduleId, hash: commit } } }))?.id ?? null : null;
        submission.phase = "proposing";
        await ports.db.moduleInstallationSubmission.update({ where: { id }, data: submission });
      };
      let proposal;
      if (request.mode === "exact-release" && submission.moduleId) {
        if (!exactReleaseUpdate) throw new StewardError("forbidden", "Exact release selection requires an owner baseline");
        const { baseline, expectedLocal } = await prepareExactReleaseUpdate(context, submission.moduleId, trusted, exactReleaseUpdate);
        const associated = await ports.db.moduleUpstream.findUnique({ where: { moduleId: submission.moduleId } });
        const bundle = { ...git, ...(associated?.repository ? { repository: null, defaultRepository: undefined } : {}) };
        await prepared(git.commit);
        proposal = await propose(context, { root, dir: request.package, intent, allowed: [request.package], sourceCommit: git.commit, gitBundle: bundle, expectedLocal, expectedModuleId: submission.moduleId, exactReleaseUpdate: baseline }, "user");
        if (proposal.hash !== git.commit) throw new StewardError("conflict", "Proposal commit differs from the selected release");
      } else if (request.mode === "update" && submission.moduleId) {
        proposal = await submitMergedCommit(context, { moduleId: submission.moduleId, commit: git.commit, bundle: git, intent, onPrepared: prepared });
      } else {
        await prepared(trusted.git.commit);
        proposal = await propose(context, { root, dir: request.package, intent, allowed: [request.package], sourceCommit: git.commit, gitBundle: git, expectedModuleId: null }, "user");
        if (proposal.hash !== trusted.git.commit) throw new StewardError("conflict", "Proposal commit differs from the selected release");
      }
      if (proposal.moduleId) {
        await recordModuleUpstream(ports, workspaceId, proposal.moduleId, { ...git, repository: git.repository ?? git.defaultRepository ?? null });
      }
      submission.moduleId = proposal.moduleId ?? submission.moduleId;
      submission.phase = "submitted";
      await ports.db.moduleInstallationSubmission.update({ where: { id }, data: submission });
      const result: ModuleInstallResult = { package: request.package, requestKey: request.requestKey, status: "building", moduleId: submission.moduleId, hash: proposal.hash, approvalId: proposal.approvalId ?? null, error: null };
      return proposal.status === "rejected" ? failure(result, "installation_rejected", rejectionSummary(proposal.report)) : installationFacts(ports, workspaceId, result);
    } catch (error) {
      if (submission.phase === "prepared") {
        submission.error = redactSensitiveText(error instanceof Error ? error.message : "Release copy failed").slice(0, 1000);
        await ports.db.moduleInstallationSubmission.update({ where: { id }, data: submission });
      }
      throw error;
    } finally { await rm(root, { recursive: true, force: true }); }
  };
}
/** Mutable bootstrap evidence is rechecked in the activation transaction; names/intent alone grant nothing. */
export async function matchesInitialInstallation(context: ModuleContext, version: ModuleVersion, module: { id: string; name: string; activeHash: string | null; status: string }) {
  const { db, workspaceId } = context;
  const name = PREINSTALLED_MODULE_NAMES.find(name => name === module.name);
  if (!name || module.activeHash !== null || module.status !== "active" || version.source !== "user") return false;
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const settings = workspace.settings as { moduleInitialization?: unknown } | null;
  const state = moduleInitializationStateSchema.safeParse(settings?.moduleInitialization).data;
  const initial = state?.packages[name], requestKey = `initialize:v1:${name}:1`;
  if (state?.status !== "pending" || initial?.attempts !== 1 || initial.requestKey !== requestKey || !["pending", "building", "pending_approval"].includes(initial.status)) return false;
  if (initial.moduleId !== module.id || initial.hash !== version.hash) return false;
  const receipt = await db.moduleInstallation.findUnique({ where: { id: installationId(workspaceId, requestKey) }, include: { submission: true } });
  const submission = submissionSchema.safeParse(receipt?.submission).data;
  if (receipt?.workspaceId !== workspaceId || receipt.requestKey !== requestKey || receipt.mode !== "install" || receipt.package !== name || receipt.moduleId !== module.id || receipt.hash !== version.hash || !["building", "pending_approval"].includes(receipt.status) || receipt.approvalId !== null) return false;
  if (!submission || submission.phase !== "submitted" || submission.moduleId !== module.id || submission.hash !== version.hash || submission.existingVersionId !== null || !attributedVersion(version, submission)) return false;
  // An unselected/previously active version must not regain release authority through bootstrap.
  if (await db.moduleActivation.findFirst({ where: { moduleId: module.id } }) || await db.moduleVersion.findFirst({ where: { moduleId: module.id, status: "approved" } })) return false;
  // A receipt may refresh to pending_approval before a card exists; an actual review/decision remains authoritative.
  return !await db.approval.findFirst({ where: { workspaceId, moduleId: module.id, action: "activate_module" } });
}
/** Only the host's checksum/tree-verified pinned release can carry first-install approval. */
export async function isTrustedInitialInstallation(context: ModuleContext, version: ModuleVersion, module: Parameters<typeof matchesInitialInstallation>[2]) {
  if (!await matchesInitialInstallation(context, version, module)) return false;
  try {
    // Reuse checksum, pinned commit, source tree, artifact and executable-mode verification.
    const release = await resolveExternalRelease(context.ports, module.name as ModuleInstallRequest["package"], version.hash);
    return release.git?.commit === version.hash && JSON.stringify(release.manifest) === JSON.stringify(version.manifest);
  } catch (error) {
    console.error(JSON.stringify({ component: "module-install", event: "initial_release.verification_failed", moduleId: module.id, hash: version.hash, error: redactSensitiveText(String(error)) }));
    return false;
  }
}
async function revalidateInstallationRelease(ports: StewardPorts, name: ModuleInstallRequest["package"], release: Parameters<ExternalModuleInstaller>[0]["release"]) {
  const trusted = await resolveExternalRelease(ports, name);
  if (release.name !== trusted.name || release.origin !== "external" || release.codeDir !== trusted.codeDir || release.hash !== trusted.hash || JSON.stringify(release.git) !== JSON.stringify(trusted.git)) throw new StewardError("conflict", "External release changed before submission");
  return trusted;
}
async function prepareSubmission(ports: StewardPorts, workspaceId: string, request: InstallationRequest, hash: string) {
  const id = submissionId(workspaceId, request.requestKey);
  const previous = await ports.db.moduleInstallationSubmission.findUnique({ where: { id } });
  if (previous) throw new StewardError("conflict", "Installation submission already exists; reconcile the original request");
  const module = await assertExternalName(ports.db, workspaceId, request.package, "install");
  if ((request.mode === "install") === Boolean(module)) throw new StewardError("conflict", "Module identity changed before installation; reconcile the original request");
  const existing = module ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } }) : null;
  const marker = `Official installation ${installationId(workspaceId, request.requestKey)}`;
  const submission: Submission = { hash, moduleId: module?.id ?? null, existingVersionId: existing?.id ?? null, marker, phase: "prepared", error: null };
  // This evidence survives a crash after propose has queued a version but before the receipt returns.
  await ports.db.moduleInstallationSubmission.create({ data: { id, installationId: installationId(workspaceId, request.requestKey), ...submission } });
  return { id, marker, submission };
}
async function copyRelease(trusted: Awaited<ReturnType<typeof resolveExternalRelease>>, root: string, name: string, platform: string) {
  const files = await readReleaseMaterial(trusted.codeDir), source = moduleSourceFiles(files);
  if (!trusted.git) throw new StewardError("invalid", "Official installation requires Git provenance");
  const revision = await verifyModuleGitBundle(trusted.git);
  if (source.length !== revision.files.length || source.some((file, index) => file.path !== revision.files[index]?.path || !Buffer.from(file.bytes).equals(revision.files[index]!.bytes) || !!file.executable !== !!revision.files[index]!.executable)) throw new StewardError("conflict", "External release changed while copying");
  await storeModuleArtifacts(platform, files);
  await checkoutModule(root, name, files);
}
async function installationFacts(ports: StewardPorts, workspaceId: string, result: ModuleInstallResult): Promise<ModuleInstallResult> {
  if (!result.moduleId || !result.hash) return result;
  const module = await ports.db.module.findFirst({ where: { id: result.moduleId, workspaceId, name: result.package } });
  if (!module) return failure(result, "module_removed", "The submitted module was removed; explicitly install it again", "not_found");
  if (module.builtin) return failure(result, "module_identity_conflict", "The installation target is now immutable", "conflict");
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: result.hash } } });
  if (!version) return failure(result, "version_missing", "The submitted version is missing; inspect diagnostics before retrying", "not_found");
  if (version.status === "approved") return approvedInstallation(result, module.activeHash);
  if (version.status === "rejected") return failure(result, "installation_rejected", rejectionSummary(version.report));
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
  // Refresh official packages' latest receipts in ticks. Older keys reconcile on explicit lookup.
  const pointers = await ports.db.moduleInstallationHead.findMany({ where: { workspaceId, package: { in: [...OFFICIAL_EXTERNAL_MODULE_NAMES] } }, select: { installationId: true } });
  const ids = pointers.map(pointer => pointer.installationId);
  await refreshReceipts(ports, workspaceId, ids);
}
async function refreshReceipts(ports: StewardPorts, workspaceId: string, ids: string[]): Promise<void> {
  const rows = await ports.db.moduleInstallation.findMany({ where: { workspaceId, id: { in: ids } } });
  for (const row of rows) {
    const result = installationResult(row);
    if (!["pending", "building", "pending_approval"].includes(result.status) || activeSubmissions.get(ports.db)?.has(row.id)) continue;
    if (isModulePaused(result.package)) {
      await recordInstallationResult(ports, workspaceId, installationFailure(result, new ModuleUnavailableError(result.package)));
      continue;
    }
    if (result.status === "pending") {
      const recovered = await recoverSubmission(ports, workspaceId, row, result);
      if (!recovered) continue;
      result.moduleId = recovered.moduleId; result.hash = recovered.hash;
    }
    await recordInstallationResult(ports, workspaceId, await installationFacts(ports, workspaceId, result));
  }
}
async function removedSubmission(ports: StewardPorts, workspaceId: string, createdAt: Date, name: string, hash: string) {
  return ports.db.moduleRemoval.findFirst({ where: { workspaceId, name, hash, createdAt: { gte: createdAt } }, orderBy: { createdAt: "asc" } });
}
function attributedVersion(version: { id: string; intent: unknown } | null, submission: Submission): version is NonNullable<typeof version> {
  const changes = (version?.intent as { changes?: unknown } | null)?.changes;
  return !!version && (version.id === submission.existingVersionId || Array.isArray(changes) && changes.includes(submission.marker));
}
async function recoverSubmission(ports: StewardPorts, workspaceId: string, row: { createdAt: Date }, result: ModuleInstallResult) {
  const stored = await ports.db.moduleInstallationSubmission.findUnique({ where: { id: submissionId(workspaceId, result.requestKey) } });
  if (!stored) return null; // An adapter may report an unknown outcome without our proposal evidence; do not guess.
  const submission = submissionSchema.parse(stored);
  if (submission.phase === "prepared") {
    await recordInstallationResult(ports, workspaceId, failure(result, "submission_not_started", submission.error ?? "Resource preparation was interrupted before proposal; explicitly retry with a new request key"));
    return null;
  }
  if (!submission.moduleId) {
    const removed = await removedSubmission(ports, workspaceId, row.createdAt, result.package, submission.hash);
    if (removed?.moduleId) {
      await recordInstallationResult(ports, workspaceId, failure({ ...result, moduleId: removed.moduleId, hash: submission.hash }, "module_removed", "The submitted module was removed; a same-name installation cannot take over its receipt", "not_found"));
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
async function resumeInstallation(tx: Prisma.TransactionClient, request: InstallationRequest, previous: Prisma.ModuleInstallationGetPayload<object>) {
  if (previous.package !== request.package || previous.mode !== request.mode) throw new StewardError("conflict", "Install requestKey already belongs to another request");
  const previousResult = installationResult(previous);
  const result = isModulePaused(request.package) ? installationFailure(previousResult, new ModuleUnavailableError(request.package)) : previousResult;
  if (isModulePaused(request.package)) await tx.moduleInstallation.update({ where: { id: previous.id }, data: resultData(result) });
  return { result, claimed: false, exactReleaseUpdate: undefined };
}
export async function installExternal(ports: StewardPorts, workspaceId: string, raw: ModuleInstallRequest): Promise<ModuleInstallResult> {
  return installRequest(ports, workspaceId, parseInput(moduleInstallRequestSchema, raw));
}
/** Host-only stopped-service CLI selection. Routed install/Author inputs cannot select source commits. */
export async function installExactRelease(ports: StewardPorts, workspaceId: string, raw: ModuleInstallRequest, caller: Caller): Promise<ModuleInstallResult> {
  if (caller.kind !== "owner") throw new StewardError("forbidden", "Exact release selection requires local owner administration");
  const request = parseInput(moduleInstallRequestSchema, raw);
  if (request.mode !== "update") throw new StewardError("invalid", "Exact release selection requires update");
  return installRequest(ports, workspaceId, { ...request, mode: "exact-release" });
}
async function installRequest(ports: StewardPorts, workspaceId: string, request: InstallationRequest): Promise<ModuleInstallResult> {
  const id = installationId(workspaceId, request.requestKey);
  const claim = await ports.db.$transaction(async tx => {
    const previous = await tx.moduleInstallation.findUnique({ where: { id } });
    if (previous) return resumeInstallation(tx, request, previous);
    const module = await assertExternalName(tx, workspaceId, request.package, "install");
    const paused = isModulePaused(request.package);
    if (!paused && module && request.mode === "install") throw new StewardError("conflict", "Module already installed; explicitly select update");
    if (!paused && !module && request.mode !== "install") throw new StewardError("not_found", "Module not installed; explicitly select install");
    const exactReleaseUpdate = request.mode === "exact-release" ? await readExactReleaseBaselineIn(tx, module!) : undefined;
    const moduleId = module?.id ?? null;
    const pending: ModuleInstallResult = { package: request.package, requestKey: request.requestKey, status: "pending", moduleId, hash: null, approvalId: null, error: null };
    const result = paused ? installationFailure(pending, new ModuleUnavailableError(request.package)) : pending;
    await tx.moduleInstallation.create({ data: { id, workspaceId, mode: request.mode, ...resultData(result), createdAt: ports.now() } });
    await tx.moduleInstallationHead.upsert({ where: { workspaceId_package: { workspaceId, package: request.package } }, create: { workspaceId, package: request.package, installationId: id }, update: { installationId: id } });
    return { result, claimed: !paused, exactReleaseUpdate };
  });
  if (!claim.claimed) {
    if (["pending", "building", "pending_approval"].includes(claim.result.status)) {
      await refreshReceipts(ports, workspaceId, [id]);
      const row = await ports.db.moduleInstallation.findUniqueOrThrow({ where: { id } });
      return installationResult(row);
    }
    return claim.result;
  }
  let active = activeSubmissions.get(ports.db);
  if (!active) { active = new Set(); activeSubmissions.set(ports.db, active); }
  active.add(id);
  let result: ModuleInstallResult;
  try {
    const release = await resolveExternalRelease(ports, request.package);
    result = ports.moduleExternalInstaller ? moduleInstallResultSchema.parse(await ports.moduleExternalInstaller({
      workspaceId, request, release, exactReleaseUpdate: claim.exactReleaseUpdate,
    })) : {
      ...claim.result, status: "unavailable", error: { code: "unavailable", reason: "installer_unavailable", message: "External proposal adapter is not configured" },
    };
    if (result.package !== request.package || result.requestKey !== request.requestKey) throw new StewardError("invalid", "Installer returned a different request identity");
  } catch (error) {
    console.error(JSON.stringify({ component: "module-install", event: "submission.failed", package: request.package, requestKey: request.requestKey, error: redactSensitiveText(String(error)) }));
    const submission = await ports.db.moduleInstallationSubmission.findUnique({ where: { id: submissionId(workspaceId, request.requestKey) } });
    result = submission ? { ...claim.result, status: "pending", error: null } : installationFailure(claim.result, error);
  }
  try {
    await recordInstallationResult(ports, workspaceId, result);
  } finally { active.delete(id); }
  if (result.status === "pending") {
    await refreshReceipts(ports, workspaceId, [id]);
    const row = await ports.db.moduleInstallation.findUniqueOrThrow({ where: { id } });
    return installationResult(row);
  }
  return result;
}
/** B updates this same receipt after the existing build/approval completes, then initialization can converge. */
export async function recordInstallationResult(ports: StewardPorts, workspaceId: string, raw: ModuleInstallResult) {
  const result = moduleInstallResultSchema.parse(raw), id = installationId(workspaceId, result.requestKey);
  await ports.db.$transaction(async tx => {
    const row = await tx.moduleInstallation.findUniqueOrThrow({ where: { id } });
    if (row.package !== result.package) throw new StewardError("conflict", "Installation receipt identity mismatch");
    await tx.moduleInstallation.update({ where: { id }, data: resultData(result) });
    if (row.mode !== "install" && result.error?.reason === "installation_rejected" && result.moduleId && result.hash) {
      const module = await tx.module.findFirst({ where: { id: result.moduleId, workspaceId, name: result.package, builtin: false } });
      if (module) await rejectedUpdateNotice({ ports, workspaceId, tx, module, hash: result.hash, error: result.error.message });
    }
  });
}
export async function externalPackageCatalog(ports: StewardPorts, workspaceId: string) {
  return Promise.all(OFFICIAL_EXTERNAL_MODULE_NAMES.map(async name => {
    const module = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
    const pointer = await ports.db.moduleInstallationHead.findUnique({ where: { workspaceId_package: { workspaceId, package: name } }, include: { installation: true } });
    const receipt = pointer ? installationResult(pointer.installation) : null;
    // Read current candidate facts even before the next tick reconciles the stored receipt.
    const installation = receipt && ["building", "pending_approval"].includes(receipt.status) && !isModulePaused(name)
      ? await installationFacts(ports, workspaceId, receipt) : receipt;
    try {
      const release = await resolveExternalRelease(ports, name);
      return { name, ...releaseCatalogDetails(release), moduleId: module?.id ?? null, installation, error: null };
    } catch (error) {
      return { name, description: null, available: false, releaseHash: null, git: null, moduleId: module?.id ?? null, installation, error: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Release unavailable" };
    }
  }));
}

function releaseCatalogDetails(release: ModuleRelease) {
  return { description: release.manifest.description ?? null, available: true, releaseHash: release.hash, git: release.git ? { repository: release.git.repository, branch: release.git.branch, commit: release.git.commit } : null };
}

function installationFailure(result: ModuleInstallResult, error: unknown): ModuleInstallResult {
  return { ...result, status: error instanceof ModuleUnavailableError ? "unavailable" : "failed", error: { code: error instanceof ModuleUnavailableError ? "unavailable" : error instanceof StewardError ? error.code : "failed", reason: error instanceof Error && "reason" in error ? String(error.reason) : "installation_failed", message: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Installation failed" } };
}
