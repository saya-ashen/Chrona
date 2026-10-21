import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { requireAffair } from "./affairs";
import { effectivePolicyIn } from "./grants";
import { parseInput, StewardError } from "./errors";
import { intentSchema, json, type ModuleContext, type BuildReport, type Proposal, type ModuleSource } from "./module-context";
import { snapshotModule } from "./workspace-fs";

type Manifest = z.output<typeof moduleManifestSchema>;
type Submission = { moduleId: string; hash: string; versionId: string; manifest: Manifest; intent: z.output<typeof intentSchema>; source: ModuleSource; report: BuildReport };
async function queueVersion(context: ModuleContext, submission: Submission) {
  const { db, ports } = context, { moduleId, hash, versionId, manifest, intent, source, report } = submission;
  return db.$transaction(async tx => {
    // Preserve submission order for failure streaks even within one millisecond.
    const latest = await tx.moduleVersion.findFirst({ where: { moduleId }, orderBy: { createdAt: "desc" } });
    const createdAt = new Date(Math.max(ports.now().getTime(), (latest?.createdAt.getTime() ?? 0) + 1));
    const row = await tx.moduleVersion.upsert({ where: { moduleId_hash: { moduleId, hash } }, create: { id: versionId, moduleId, hash, manifest: json(manifest), intent: json(intent), source, report: json(report), status: "building", createdAt }, update: {} });
    // A concurrent same-hash proposal owns its staging; never overwrite it.
    if (row.id !== versionId && row.status === "rejected") {
      const changed = await tx.moduleVersion.updateMany({ where: { id: row.id, status: "rejected" }, data: { id: versionId, status: "building", intent: json(intent), source, report: json(report), createdAt } });
      if (changed.count) return { ...row, id: versionId, status: "building" };
    }
    return row;
  });
}
async function permittedProposal(context: ModuleContext, affairId: string) {
  let permitted = true;
  for (const action of ["activate_module", "notify_user"] as const) {
    if ((await effectivePolicyIn(context.db, context.workspaceId, action, { affairId }, context.ports.now())).mode === "never") permitted = false;
  }
  return permitted;
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
  catch { return { errors: ["module.json: missing or not valid JSON"] }; }
  const parsed = moduleManifestSchema.safeParse(raw);
  // Schema issue paths and messages come from the contract, so the Provider can fix its manifest.
  return parsed.success ? { manifest: parsed.data } : { errors: manifestIssues(parsed.error.issues).slice(0, 10).map(issue => `${issue.path.join(".") || "module.json"}: ${issue.message}`.slice(0, 300)) };
}
function submissionErrors(manifest: Manifest, permitted: boolean, hasEntry: boolean, hasMigrate: boolean) {
  return [...(permitted ? [] : ["policy: module activation or notifications are set to never"]), ...(hasEntry ? [] : [`entry: ${manifest.entry} not found`]), ...(hasMigrate ? [] : [`data.migrate: ${manifest.data.migrate} not found`])];
}
async function submitStaging(context: ModuleContext, submission: Omit<Submission, "moduleId" | "manifest">, affairId: string, staging: string, files: { path: string; bytes: Uint8Array }[]): Promise<Proposal & { retained?: boolean }> {
  const { db, workspaceId, ports } = context, { hash, report, versionId } = submission;
  for (const file of files) {
    const target = join(staging, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { mode: 0o444 });
  }
  const parsed = await readManifest(staging);
  if ("errors" in parsed) return { moduleId: null, hash, status: "rejected", report: { ...report, errors: parsed.errors } };
  const { manifest } = parsed;
  const module = await db.module.upsert({ where: { affairId_name: { affairId, name: manifest.name } }, create: { workspaceId, affairId, name: manifest.name, createdAt: ports.now() }, update: {} });
  const existing = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } });
  const hasEntry = files.some(file => file.path === manifest.entry);
  const hasMigrate = hasMigration(manifest, files);
  const permitted = await permittedProposal(context, affairId);
  if (existing?.status === "approved") return { moduleId: module.id, hash, status: permitted ? "approved" : "rejected", report: existing.report as BuildReport };
  if (!permitted || !hasEntry || !hasMigrate) return { moduleId: module.id, hash, status: "rejected", report: { ...report, errors: submissionErrors(manifest, permitted, hasEntry, hasMigrate) } };
  if (existing && ["building", "testing", "pending_review"].includes(existing.status)) return { moduleId: module.id, hash, status: existing.status as Proposal["status"], report: existing.report as BuildReport };
  const queued = await queueVersion(context, { ...submission, moduleId: module.id, manifest });
  if (queued.id !== versionId) return { moduleId: module.id, hash, status: queued.status as Proposal["status"], report: queued.report as BuildReport };
  return { moduleId: module.id, hash, status: "building", report, retained: true };
}
/** `root` is a Chrona-owned build directory (build lane); otherwise `dir` is inside the affair. */
export async function propose(context: ModuleContext, input: { affairId: string; dir: string; intent: z.input<typeof intentSchema>; root?: string }, source: ModuleSource): Promise<Proposal> {
  const { db, workspaceId, fs, platform } = context;
  const intent = parseInput(intentSchema, input.intent);
  // Validate runtime callers too, without an impossible comparison on the typed union.
  if (!["provider", "user", "build"].includes(source)) throw new StewardError("invalid", "Invalid module source");
  const affair = await requireAffair(db, workspaceId, input.affairId);
  const files = input.root ? await snapshotModule(input.root, input.dir) : await fs.forAffair(affair.dirName).snapshotModule(input.dir);
  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  const hash = digest.digest("hex"), report: BuildReport = { tests: [] };
  const versionId = randomUUID(), staging = join(platform, "staging", versionId);
  let retained = false;
  await mkdir(staging, { recursive: true });
  try {
    const result = await submitStaging(context, { hash, report, versionId, intent, source }, affair.id, staging, files);
    retained = result.retained ?? false;
    const { retained: _retained, ...proposal } = result;
    return proposal;
  } finally { if (!retained) await rm(staging, { recursive: true, force: true }); }
}
