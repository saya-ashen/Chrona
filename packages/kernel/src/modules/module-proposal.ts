import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { parseInput, StewardError } from "../errors";
import { intentSchema, json, type ModuleContext, type BuildReport, type Proposal, type ModuleSource } from "./module-context";
import { storeVersionMaterial, moduleMaterialDigest, snapshotModuleMaterial } from "./module-artifacts";
import { moduleMaterialEntryPath } from "../../../contracts/src/steward/module-material";
import type { ModuleFile } from "./module-files";
import { assertExactReleaseUpdateIn, assertExactReleaseCandidate } from "./module-exact-release";
import type { ExactReleaseBaseline } from "./module-install-types";
import { assertExternalModule, assertExternalName } from "./module-identity";

type Manifest = z.output<typeof moduleManifestSchema>;
type ProposalInput = { dir: string; intent: z.input<typeof intentSchema>; root: string; allowed?: string[];
  /** Internal official installation/update path; never part of routed tool input. */
  exactReleaseUpdate?: ExactReleaseBaseline; expectedHash?: string; expectedModuleId?: string | null };
type Submission = { moduleId: string; hash: string; versionId: string; manifest: Manifest; intent: z.output<typeof intentSchema>; source: ModuleSource; report: BuildReport };
async function queueVersion(context: ModuleContext, submission: Submission) {
  const { db, ports } = context, { moduleId, hash, versionId, manifest, intent, source, report } = submission;
  return db.$transaction(async tx => {
    const module = await assertExternalModule(tx, context.workspaceId, moduleId, "propose");
    await assertExactReleaseUpdateIn(context, tx, moduleId, report, module);
    // Preserve submission order for failure streaks even within one millisecond.
    const latest = await tx.moduleVersion.findFirst({ where: { moduleId }, orderBy: { createdAt: "desc" } });
    const createdAt = new Date(Math.max(ports.now().getTime(), (latest?.createdAt.getTime() ?? 0) + 1));
    const row = await tx.moduleVersion.upsert({ where: { moduleId_hash: { moduleId, hash } }, create: { id: versionId, moduleId, hash, manifest: json(manifest), intent: json(intent), source, report: json(report), status: "building", createdAt }, update: {} });
    // A concurrent same-hash proposal owns its staging; never overwrite it.
    if (row.id !== versionId && row.status === "rejected") {
      const changed = await tx.moduleVersion.updateMany({ where: { id: row.id, status: "rejected" }, data: { id: versionId, status: "building", intent: json(intent), source, report: json(report), createdAt } });
      if (changed.count) {
        return { ...row, id: versionId, status: "building" };
      }
    }
    return row;
  });
}
function hasMigration(manifest: Manifest, files: { path: string }[]) {
  return !manifest.data.migrate || files.some(file => file.path === manifest.data.migrate);
}
type Issue = { path: PropertyKey[]; message: string; code?: string; errors?: Issue[][] };
/** A union's own message is only "Invalid input": report the closest branch's issues so the Provider can fix them. */
function manifestIssues(issues: readonly Issue[], prefix: PropertyKey[] = []): Issue[] {
  return issues.flatMap(issue => {
    const path = [...prefix, ...issue.path];
    if (issue.code !== "invalid_union" || !issue.errors?.length) return [{ ...issue, path }];
    const closest = issue.errors.reduce((best, branch) => branch.length < best.length ? branch : best);
    return manifestIssues(closest, path);
  });
}
async function readManifest(staging: string): Promise<{ manifest: Manifest } | { errors: string[] }> {
  let raw: unknown;
  // Invalid manifests have no validated identity; never expose JSON parser/host diagnostics.
  try { raw = JSON.parse(await readFile(join(staging, "module.json"), "utf8")); }
  catch (error) {
    console.error(JSON.stringify({ component: "module-proposal", event: "manifest.invalid", error: error instanceof SyntaxError ? "invalid JSON" : String(error) }));
    return { errors: ["module.json: missing or not valid JSON"] };
  }
  const parsed = moduleManifestSchema.safeParse(raw);
  // Schema issue paths and messages come from the contract, so the Provider can fix its manifest.
  return parsed.success ? { manifest: parsed.data } : { errors: manifestIssues(parsed.error.issues).slice(0, 10).map(issue => `${issue.path.join(".") || "module.json"}: ${issue.message}`.slice(0, 300)) };
}
function submissionErrors(manifest: Manifest, hasEntry: boolean, hasMigrate: boolean) {
  return [...(hasEntry ? [] : [`entry: ${manifest.entry} not found`]), ...(hasMigrate ? [] : [`data.migrate: ${manifest.data.migrate} not found`])];
}
function proposedModule(context: ModuleContext, manifest: Manifest, expectedModuleId?: string | null) {
  const { db, workspaceId, ports } = context;
  return db.$transaction(async tx => {
    const existing = await assertExternalName(tx, workspaceId, manifest.name, "propose");
    if (expectedModuleId !== undefined && (existing?.id ?? null) !== expectedModuleId) throw new StewardError("conflict", "Module identity changed before proposal");
    return existing ?? tx.module.create({ data: { workspaceId, name: manifest.name, createdAt: ports.now() } });
  });
}
async function writeStaging(staging: string, files: ModuleFile[]) {
  for (const file of files) {
    const target = join(staging, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { mode: file.executable ? 0o555 : 0o444 });
  }
}
function assertDeclared(name: string, allowed?: string[]) {
  if (allowed && !allowed.includes(name)) throw new StewardError("forbidden", `This build may submit only ${allowed.join(", ")}`);
}
async function submitStaging(context: ModuleContext, submission: Omit<Submission, "moduleId" | "manifest">, staging: string, files: ModuleFile[], input: ProposalInput): Promise<Proposal & { retained?: boolean }> {
  const { db } = context, { report, versionId } = submission;
  const { hash } = submission;
  await writeStaging(staging, files);
  const parsed = await readManifest(staging);
  if ("errors" in parsed) return { moduleId: null, hash, status: "rejected", report: { ...report, errors: parsed.errors } };
  const { manifest } = parsed;
  assertDeclared(manifest.name, input.allowed);
  const module = await proposedModule(context, manifest, input.expectedModuleId);
  await assertExactReleaseUpdateIn(context, db, module.id, report);
  await storeVersionMaterial(context.platform, files);
  const existing = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } });
  assertExactReleaseCandidate(existing, input.exactReleaseUpdate);
  const hasEntry = files.some(file => file.path === moduleMaterialEntryPath(manifest.entry));
  const hasMigrate = hasMigration(manifest, files);
  if (existing?.status === "approved") return { moduleId: module.id, hash, status: "approved", report: existing.report as BuildReport };
  if (!hasEntry || !hasMigrate) return { moduleId: module.id, hash, status: "rejected", report: { ...report, errors: submissionErrors(manifest, hasEntry, hasMigrate) } };
  if (existing && ["building", "testing", "pending_review"].includes(existing.status)) return { moduleId: module.id, hash, status: existing.status as Proposal["status"], report: existing.report as BuildReport };
  const queued = await queueVersion(context, { ...submission, hash, moduleId: module.id, manifest });
  if (queued.id !== versionId) return { moduleId: module.id, hash, status: queued.status as Proposal["status"], report: queued.report as BuildReport };
  return { moduleId: module.id, hash, status: "building", report, retained: true };
}
/** Proposals are read only from an explicitly supplied build or session directory. */
/** `allowed`: a build conversation submits only the modules it was asked to change (v2-15). */
export async function propose(context: ModuleContext, input: ProposalInput, source: ModuleSource): Promise<Proposal> {
  if (!["provider", "user", "build"].includes(source)) throw new StewardError("invalid", "Invalid module source");
  return submitProposal(context, input, source);
}
async function submitProposal(context: ModuleContext, input: ProposalInput, source: ModuleSource): Promise<Proposal> {
  const { platform } = context;
  const intent = parseInput(intentSchema, input.intent);
  const files = await snapshotModuleMaterial(input.root, input.dir);
  const hash = moduleMaterialDigest(files);
  if (input.expectedHash !== undefined && input.expectedHash !== hash) throw new StewardError("conflict", "Submitted material differs from the selected release");
  const report: BuildReport = { tests: [], ...(input.exactReleaseUpdate ? { exactReleaseUpdate: input.exactReleaseUpdate } : {}) };
  const versionId = randomUUID(), staging = join(platform, "staging", versionId);
  let retained = false;
  await mkdir(staging, { recursive: true });
  try {
    const result = await submitStaging(context, { hash, report, versionId, intent, source }, staging, files, input);
    retained = result.retained ?? false;
    const { retained: _retained, ...proposal } = result;
    return proposal;
  } finally { if (!retained) await rm(staging, { recursive: true, force: true }); }
}
