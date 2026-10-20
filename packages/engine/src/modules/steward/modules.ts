import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema, moduleOutputSchema, type ModuleOutput, RUN_LIMITS } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { createWorkspaceFs } from "./workspace-fs";
import { requireAffair } from "./affairs";
import { createApprovals, type ApprovedAction } from "./approvals";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { notificationSettings } from "./settings";
import { createRuns } from "./runs";
import { createNotifications } from "./notify";
import { parseInput, StewardError } from "./errors";

const intentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
type TestReport = { stdout: string; stderr: string; exitCode: number }[];
type ContinuityReport = { status: "passed" | "failed" | "skipped"; reason?: string; fromSchema: number | null; toSchema: number; migrated: boolean; effects?: ModuleOutput["effects"]; migration?: TestReport[number]; output?: TestReport[number] };
type BuildReport = { tests: TestReport; continuity?: ContinuityReport; migration?: TestReport[number] };
type Proposal = { moduleId: string | null; hash: string; status: "building" | "testing" | "rejected" | "pending_review" | "approved"; approvalId?: string; report: BuildReport };
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function dataEmpty(live: string) {
  try {
    if (!(await lstat(live)).isDirectory()) throw new Error("Unsafe data directory");
    return (await readdir(live)).length === 0;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return true; }
}
async function copyData(live: string, data: string): Promise<boolean> {
  if (!(await lstat(live)).isDirectory()) throw new Error("Unsafe data directory");
  await mkdir(data, { recursive: true });
  let bytes = 0, count = 0;
  async function copy(relative: string): Promise<boolean> {
    for (const entry of await readdir(join(live, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name, source = join(live, path), target = join(data, path);
      if (entry.isDirectory()) { await mkdir(target); if (!await copy(path)) return false; }
      else if (entry.isFile()) {
        const info = await lstat(source);
        if (!info.isFile()) throw new Error("Unsafe data file");
        if (++count > 5000 || (bytes += info.size) > 50 * 1024 * 1024) return false;
        const content = await readFile(source);
        bytes += content.length - info.size;
        if (bytes > 50 * 1024 * 1024) return false;
        await writeFile(target, content);
      } else throw new Error("Unsafe data file");
    }
    return true;
  }
  return copy("");
}
async function runOffline(ports: StewardPorts, codeDir: string, dataDir: string, entry: string, input: unknown) {
  if (!ports.sandbox?.available || !ports.sandbox.runModule) throw new Error("Sandbox unavailable");
  const result = await ports.sandbox.runModule({ codeDir, dataDir, entry, input, network: false, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
  const output = { stdout: result.output.slice(0, RUN_LIMITS.jobOutputBytes), stderr: (result.error ?? "").slice(0, RUN_LIMITS.jobOutputBytes), exitCode: result.exitCode ?? 1 };
  return { result, output, succeeded: result.status === "succeeded" && result.exitCode === 0 && Buffer.byteLength(result.output) <= RUN_LIMITS.jobOutputBytes };
}

// Bound LCS work for large/generated files; a full replacement is still a valid line diff.
function lineDiff(before: string, after: string): string[] {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  if ((a.length + 1) * (b.length + 1) > 1_000_000) return [...a.map(line => `- ${line}`), ...b.map(line => `+ ${line}`)];
  const width = b.length + 1, lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lcs[i * width + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * width + j + 1]! : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  }
  const lines: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(`  ${a[i]}`); i++; j++; }
    else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) lines.push(`- ${a[i++]}`);
    else lines.push(`+ ${b[j++]}`);
  }
  return lines;
}

export function createModules(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, fs = createWorkspaceFs(ports.dataDir);
  const platform = join(ports.dataDir, "platform"), store = join(platform, "store");
  const context = { db, workspaceId, now: ports.now };
  async function requireModule(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.module.findFirst({ where: { id, workspaceId } });
    if (!row) throw new StewardError("not_found", "Module not found");
    return row;
  }
  async function activateIn(tx: Prisma.TransactionClient, moduleId: string, hash: string, reason: "activate" | "rollback") {
    const module = await requireModule(tx, moduleId);
    const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
    if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
    const affair = await requireAffair(tx, workspaceId, module.affairId);
    if (affair.status !== "active") throw new StewardError("conflict", "Affair is not active");
    const manifest = moduleManifestSchema.parse(version.manifest), now = ports.now();
    const zone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
    await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active" }, data: { status: "cancelled", nextAt: null } });
    for (const trigger of manifest.triggers) {
      let nextAt = nextOccurrence(trigger.schedule, now, zone);
      if (!nextAt && trigger.schedule.kind === "at") nextAt = now;
      await tx.schedule.create({ data: { workspaceId, affairId: module.affairId, moduleId, triggerId: trigger.id, mode: "module", rule: json(trigger.schedule), text: `${manifest.name}:${trigger.id}`, label: manifest.name, createdBy: "chrona", createdAt: now, nextAt, status: nextAt ? "active" : "done" } });
    }
    await tx.module.update({ where: { id: moduleId }, data: { activeHash: hash, status: "active" } });
    const modules = await tx.module.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
    const previous = await tx.generation.findFirst({ where: { workspaceId }, orderBy: { seq: "desc" } });
    const generation = await tx.generation.create({ data: { workspaceId, seq: (previous?.seq ?? 0) + 1, modules: Object.fromEntries(modules.map(row => [row.id, row.activeHash])), reason, createdAt: now } });
    await audit(tx, { workspaceId, actor: "chrona", kind: `module_${reason}`, subjectId: moduleId, details: { hash, generationId: generation.id } });
    return generation;
  }
  async function expireModuleApprovals(moduleId: string) {
    const open = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
    const ids = open.filter(row => { const payload = row.payload; return payload && typeof payload === "object" && !Array.isArray(payload) && payload.moduleId === moduleId; }).map(row => row.id);
    await db.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
  }
  async function snapshotAt(moduleId: string, schema: number) {
    try {
      const info = await lstat(join(platform, "snapshots", moduleId, `schema-${schema}`));
      if (!info.isDirectory()) throw new StewardError("conflict", "Unsafe data snapshot");
      return info.mtime.toISOString();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
  }
  async function propose(input: { affairId: string; dir: string; intent: z.input<typeof intentSchema> }, source: "provider" | "user"): Promise<Proposal> {
    const intent = parseInput(intentSchema, input.intent);
    if (source !== "provider" && source !== "user") throw new StewardError("invalid", "Invalid module source");
    const affair = await requireAffair(db, workspaceId, input.affairId);
    const files = await fs.forAffair(affair.dirName).snapshotModule(input.dir);
    const digest = createHash("sha256");
    for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
    const hash = digest.digest("hex"), report: BuildReport = { tests: [] };
    const versionId = randomUUID(), staging = join(platform, "staging", versionId);
    let retained = false;
    await mkdir(staging, { recursive: true });
    try {
      for (const file of files) {
        const target = join(staging, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { mode: 0o444 });
      }
      let manifest;
      try { manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(staging, "module.json"), "utf8"))); }
      // An invalid manifest has no validated module identity. Never persist a guessed name
      // or expose parser/host diagnostics through the public test-only report.
      catch { return { moduleId: null, hash, status: "rejected", report }; }
      const module = await db.module.upsert({ where: { affairId_name: { affairId: affair.id, name: manifest.name } }, create: { workspaceId, affairId: affair.id, name: manifest.name, createdAt: ports.now() }, update: {} });
      const existing = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash } } });
      let permitted = true;
      const hasEntry = files.some(file => file.path === manifest.entry);
      const hasMigrate = !manifest.data.migrate || files.some(file => file.path === manifest.data.migrate);
      for (const action of ["activate_module", "notify_user"] as const) {
        if ((await effectivePolicyIn(db, workspaceId, action, { affairId: affair.id }, ports.now())).mode === "never") permitted = false;
      }
      if (existing?.status === "approved") return { moduleId: module.id, hash, status: permitted ? "approved" : "rejected", report: existing.report as BuildReport };
      if (!permitted || !hasEntry || !hasMigrate) return { moduleId: module.id, hash, status: "rejected", report };
      if (existing && ["building", "testing", "pending_review"].includes(existing.status)) return { moduleId: module.id, hash, status: existing.status as Proposal["status"], report: existing.report as BuildReport };
      const queued = await db.$transaction(async tx => {
        // Preserve submission order for failure streaks even within one millisecond.
        const latest = await tx.moduleVersion.findFirst({ where: { moduleId: module.id }, orderBy: { createdAt: "desc" } });
        const createdAt = new Date(Math.max(ports.now().getTime(), (latest?.createdAt.getTime() ?? 0) + 1));
        const row = await tx.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: module.id, hash } }, create: { id: versionId, moduleId: module.id, hash, manifest: json(manifest), intent: json(intent), source, report: json(report), status: "building", createdAt }, update: {} });
        // A concurrent same-hash proposal owns its staging; never overwrite it.
        if (row.id !== versionId && row.status === "rejected") {
          const changed = await tx.moduleVersion.updateMany({ where: { id: row.id, status: "rejected" }, data: { id: versionId, status: "building", intent: json(intent), source, report: json(report), createdAt } });
          if (changed.count) return { ...row, id: versionId, status: "building" };
        }
        return row;
      });
      if (queued.id !== versionId) return { moduleId: module.id, hash, status: queued.status as Proposal["status"], report: queued.report as BuildReport };
      retained = true;
      return { moduleId: module.id, hash, status: "building", report };
    } finally { if (!retained) await rm(staging, { recursive: true, force: true }); }
  }
  async function buildVersion(version: Awaited<ReturnType<typeof db.moduleVersion.findFirstOrThrow>>): Promise<Proposal> {
    const { hash } = version, staging = join(platform, "staging", version.id), report: BuildReport = { tests: [] };
    try {
      const module = await requireModule(db, version.moduleId);
      const affair = await requireAffair(db, workspaceId, module.affairId);
      const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
      const files: { path: string; bytes: Buffer }[] = [];
      async function walk(relative: string): Promise<void> {
        for (const entry of await readdir(join(staging, relative), { withFileTypes: true })) {
          const path = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path);
          else if (entry.isFile()) files.push({ path, bytes: await readFile(join(staging, path)) });
          else throw new StewardError("forbidden", "Unsafe module staging file");
        }
      }
      try { await walk(""); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        report.tests.push({ stdout: "", stderr: "Module staging files are missing; build interrupted. Submit the module again.", exitCode: 1 });
        await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
        return { moduleId: module.id, hash, status: "rejected", report };
      }
      let passed = true, needsMigration = false;
      for (const entry of manifest.tests) {
        const data = await mkdtemp(join(tmpdir(), "chrona-module-test-"));
        try {
          if (!ports.sandbox?.available || !ports.sandbox.runModule) { passed = false; break; }
          const result = await ports.sandbox.runModule({ codeDir: staging, dataDir: data, entry, input: { now: ports.now().toISOString(), params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) }, network: false, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
          report.tests.push({ stdout: result.output.slice(0, RUN_LIMITS.jobOutputBytes), stderr: (result.error ?? "").slice(0, RUN_LIMITS.jobOutputBytes), exitCode: result.exitCode ?? 1 });
          if (result.status !== "succeeded" || result.exitCode !== 0) passed = false;
        } catch { passed = false; }
        finally { await rm(data, { recursive: true, force: true }); }
      }
      if (passed) {
        const from = module.dataSchema, to = manifest.data.schema, live = join(platform, "data", module.id);
        const continuity: ContinuityReport = { status: "skipped", reason: "no data", fromSchema: from, toSchema: to, migrated: false };
        report.continuity = continuity;
        const fail = (reason: string) => { passed = false; continuity.status = "failed"; continuity.reason = reason; };
        let data: string | undefined;
        try {
          const empty = await dataEmpty(live);
          needsMigration = from !== null && to > from && !empty;
          if (from !== null && to < from) fail("schema 不能降低；降级只能经回滚");
          else if (from !== null && to > from && !empty && !manifest.data.migrate) fail("schema 升级需要 migrate");
          else if (module.activeHash && !empty) {
            data = await mkdtemp(join(tmpdir(), "chrona-module-continuity-"));
            if (!await copyData(live, data)) continuity.reason = "data too large";
            else {
              const now = ports.now().toISOString();
              const run = (entry: string, input: unknown) => runOffline(ports, staging, data!, entry, input);
              if (from !== null && to > from) {
                const migration = await run(manifest.data.migrate!, { migrate: { from, to }, now });
                continuity.migration = migration.output;
                if (!migration.succeeded) fail("migrate failed");
                else continuity.migrated = true;
              }
              if (passed) {
                const entry = await run(manifest.entry, { trigger: { id: manifest.triggers[0]!.id, kind: "schedule", firedAt: now }, now, params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) });
                continuity.output = entry.output;
                if (!entry.succeeded) fail("entry failed");
                else {
                  let output: ModuleOutput | undefined;
                  try { output = moduleOutputSchema.parse(JSON.parse(entry.result.output)); } catch { /* Public output only; no parser diagnostics. */ }
                  if (!output) fail("invalid moduleOutput");
                  else { continuity.status = "passed"; delete continuity.reason; continuity.effects = output.effects; }
                }
              }
            }
          }
        } catch { fail("continuity check failed"); }
        finally { if (data) await rm(data, { recursive: true, force: true }); }
      }
      // Only engine-owned immutable copies are tested, hashed and installed.
      const destination = join(store, hash);
      if (passed) {
        await mkdir(store, { recursive: true });
        try {
          await rename(staging, destination);
        } catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      }
      const status = passed ? "pending_review" : "rejected";
      await db.moduleVersion.update({ where: { id: version.id }, data: { report: json(report), status } });
      if (!passed) return { moduleId: module.id, hash, status, report };
      const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
      const diff = ["--- active", "+++ proposed", ...JSON.stringify(active?.manifest ?? null, null, 2).split("\n").map(line => `- ${line}`), ...JSON.stringify(manifest, null, 2).split("\n").map(line => `+ ${line}`)].join("\n");
      const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
      const prefix = `联网：${manifest.effects.includes("network") ? "是" : "否"}\n${diff}\n`;
      const continuity = report.continuity!;
      const effects = JSON.stringify(continuity.effects ?? []), effectLimit = 6000;
      const continuityPreview = `数据 schema：${continuity.fromSchema ?? "null"} → ${continuity.toSchema}；${needsMigration ? "需要迁移" : "无需迁移"}\n连续性：${continuity.status}${continuity.reason ? ` (${continuity.reason})` : ""}\n按当前数据新版本会产生的 effects：\n${effects.length > effectLimit ? effects.slice(0, effectLimit) + "\n…effects 过长，已截断；完整列表见构建报告" : effects}\n`;
      const suffix = `${continuityPreview}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
      let preview = prefix + suffix;
      // The existing approval contract caps previews at 20,000 characters. Fail closed
      // rather than silently hiding part of the manifest or intent being approved.
      if (preview.length > 20_000) {
        await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected" } });
        return { moduleId: module.id, hash, status: "rejected", report };
      }
      const previous = new Map<string, Buffer>();
      async function readActive(relative: string): Promise<void> {
        for (const entry of await readdir(join(store, module.activeHash!, relative), { withFileTypes: true })) {
          const path = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await readActive(path);
          else if (entry.isFile()) previous.set(path, await readFile(join(store, module.activeHash!, path)));
          else throw new StewardError("forbidden", "Unsafe module store file");
        }
      }
      if (module.activeHash) await readActive("");
      const proposed = new Map(files.map(file => [file.path, Buffer.from(file.bytes)]));
      const code: string[] = ["代码差异："], unchanged: string[] = [];
      for (const path of [...new Set([...previous.keys(), ...proposed.keys()])].sort()) {
        const before = previous.get(path), after = proposed.get(path);
        if (before && after && before.equals(after)) { unchanged.push(path); continue; }
        code.push(`=== ${path} (${!before ? "added" : !after ? "removed" : "changed"}) ===`);
        for (const line of lineDiff(before?.toString("utf8") ?? "", after?.toString("utf8") ?? "")) code.push(line);
      }
      if (unchanged.length) code.push("未变化:", ...unchanged);
      const codeDiff = code.join("\n") + "\n", available = 20_000 - preview.length;
      if (codeDiff.length <= available) preview = prefix + codeDiff + suffix;
      else {
        const marker = `…代码差异过长，已截断；完整代码可用 chrona_module_checkout 检出 hash ${hash}`;
        // Leave the mandatory review text intact, even when it leaves no room for the marker.
        if (available < marker.length + 2) {
          await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected" } });
          return { moduleId: module.id, hash, status: "rejected", report };
        }
        preview = prefix + codeDiff.slice(0, available - marker.length - 2) + "\n" + suffix + "\n" + marker;
      }
      await expireModuleApprovals(module.id);
      const approval = await createApprovals(context).create({ affairId: affair.id, action: "activate_module", title: `启用模块 ${manifest.name}`, detail: "审查此版本的清单、意图与测试结果", payload: { kind: "activate_module", moduleId: module.id, hash }, preview });
      return { moduleId: module.id, hash, status, approvalId: approval.id, report };
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async function buildPending(now = ports.now()) {
    // No schema lease column: an internal audit records the claim time without
    // changing the version's submission timestamp or exposing it as test output.
    await db.$transaction(async tx => {
      const testing = await tx.moduleVersion.findMany({ where: { module: { workspaceId }, status: "testing" } });
      for (const version of testing) {
        const claim = await tx.audit.findFirst({ where: { workspaceId, kind: "module_build_started", subjectId: version.id }, orderBy: { createdAt: "desc" } });
        if ((claim?.createdAt ?? version.createdAt).getTime() <= now.getTime() - 15 * 60_000) await tx.moduleVersion.updateMany({ where: { id: version.id, status: "testing" }, data: { status: "building" } });
      }
    });
    const pending = await db.moduleVersion.findMany({ where: { module: { workspaceId }, status: "building" }, orderBy: { createdAt: "asc" }, take: 3 });
    for (const version of pending) {
      const claimed = await db.$transaction(async tx => {
        const changed = await tx.moduleVersion.updateMany({ where: { id: version.id, status: "building" }, data: { status: "testing" } });
        if (changed.count) await tx.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "module_build_started", subjectId: version.id, details: {}, createdAt: now } });
        return changed.count > 0;
      });
      if (!claimed) continue;
      const result = await buildVersion(version);
      if (result.status !== "rejected" || version.source !== "provider") continue;
      const module = await requireModule(db, version.moduleId);
      const versions = await db.moduleVersion.findMany({ where: { moduleId: module.id, status: { in: ["rejected", "pending_review", "approved"] } }, orderBy: { createdAt: "desc" } });
      let failures = 0;
      for (const row of versions) { if (row.status !== "rejected") break; failures++; }
      if (failures >= 3) {
        // Key the streak by the preceding successful build, not by a failure:
        // submissions may share a timestamp, and later failures must not re-notify.
        await createNotifications(ports, workspaceId).enqueue({ affairId: module.affairId, level: "digest", title: `模块 ${module.name} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。", dedupeKey: `module-build-failed:${module.id}:${versions[failures]?.id ?? "initial"}` });
      } else {
        // Keep continuity diagnostics visible even when successful tests printed a lot.
        const summary = result.report.continuity ? { continuity: result.report.continuity } : result.report;
        const publicReport = JSON.stringify(summary, (key, value: unknown) => ["stdout", "stderr"].includes(key) && typeof value === "string" ? value.slice(0, 1500) : value);
        await createRuns(ports, workspaceId).enqueue({ affairId: module.affairId, lane: "background", trigger: "schedule", label: module.name, prompt: `Module ${module.name} build failed (untrusted test output):\n${publicReport.slice(0, 8000)}` });
      }
    }
  }
  const activate = (moduleId: string, hash: string, reason: "activate" | "rollback") => db.$transaction(tx => activateIn(tx, moduleId, hash, reason));
  async function onApproved(action: ApprovedAction) {
    const payload = action.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.kind !== "activate_module") return;
    if (action.workspaceId !== workspaceId || typeof payload.moduleId !== "string" || typeof payload.hash !== "string") throw new StewardError("invalid", "Invalid module approval");
    const { moduleId, hash } = payload;
    let restore: { schema: number; snapshotAt: string } | undefined;
    if (payload.restore !== undefined) {
      const value = payload.restore;
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.schema !== "number" || !Number.isInteger(value.schema) || value.schema < 1 || typeof value.snapshotAt !== "string") throw new StewardError("invalid", "Invalid module restore approval");
      restore = { schema: value.schema, snapshotAt: value.snapshotAt };
    }
    const live = join(platform, "data", moduleId);
    const prepared = await db.$transaction(async tx => {
      const module = await requireModule(tx, moduleId);
      if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
      const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "activate_module", status: "approved", grantId: action.grantId } });
      if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(payload)) throw new StewardError("conflict", "Module approval does not match");
      for (const action of ["activate_module", "notify_user"] as const) {
        const decision = await effectivePolicyIn(tx, workspaceId, action, { affairId: module.affairId }, ports.now());
        if (decision.mode === "never" || (action === "activate_module" && decision.mode === "ask")) throw new StewardError("forbidden", "Policy no longer allows module activation");
      }
      await consumeOnce(tx, workspaceId, action.grantId, ports.now());
      const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
      if (!version || version.status !== (restore ? "approved" : "pending_review")) throw new StewardError("conflict", restore ? "Module version is not approved" : "Module version is not pending review");
      const manifest = moduleManifestSchema.parse(version.manifest), from = module.dataSchema, to = manifest.data.schema;
      if (restore && (restore.schema !== to || await snapshotAt(moduleId, to) !== restore.snapshotAt)) throw new StewardError("conflict", "Module restore snapshot is missing or changed");
      if (restore || (from !== null && to > from && !await dataEmpty(live))) {
        await startMigration(tx, moduleId, hash, from, to);
        return { module, version, manifest, from, to };
      }
      await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
      await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
      await activateIn(tx, moduleId, hash, "activate");
      return null;
    });
    if (!prepared) return;
    await migrateData(prepared, restore ? "rollback" : "activate", restore);
  }
  async function startMigration(tx: Prisma.TransactionClient, moduleId: string, hash: string, from: number | null, to: number) {
    await tx.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
    await tx.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash, from, to }, createdAt: ports.now() } });
  }
  async function migrateData(prepared: { module: Awaited<ReturnType<typeof requireModule>>; version: Awaited<ReturnType<typeof db.moduleVersion.findFirstOrThrow>>; manifest: z.output<typeof moduleManifestSchema>; from: number | null; to: number }, reason: "activate" | "rollback", restore?: { schema: number; snapshotAt: string }) {
    const { module, version, manifest, from, to } = prepared, moduleId = module.id, hash = version.hash;
    const live = join(platform, "data", moduleId), next = join(platform, "data-next", moduleId), old = join(platform, "data-old", moduleId);
    let output: TestReport[number] = { stdout: "", stderr: "Data migration failed", exitCode: 1 }, moved = false, swapped = false;
    try {
      const snapshots = join(platform, "snapshots", moduleId);
      let backupAt = ports.now().toISOString();
      if (restore) {
        const latest = (await readdir(snapshots)).filter(name => name.startsWith("before-rollback-")).sort().at(-1);
        const previous = latest ? Date.parse(latest.slice("before-rollback-".length)) : NaN;
        if (Number.isFinite(previous)) backupAt = new Date(Math.max(ports.now().getTime(), previous + 1)).toISOString();
      }
      const snapshot = join(snapshots, restore ? `before-rollback-${backupAt}` : `schema-${from}`);
      if (!restore) await rm(snapshot, { recursive: true, force: true });
      if (restore && await snapshotAt(moduleId, to) !== restore.snapshotAt) throw new Error("Snapshot changed");
      // Missing live data is also a valid empty backup when restoring a snapshot.
      if (restore && await dataEmpty(live)) await mkdir(snapshot, { recursive: true });
      else if (!await copyData(live, snapshot)) throw new Error("Data too large");
      if (restore) {
        const backups = (await readdir(snapshots)).filter(name => name.startsWith("before-rollback-")).sort().reverse();
        for (const name of backups.slice(3)) await rm(join(snapshots, name), { recursive: true, force: true });
      }
      await rm(next, { recursive: true, force: true });
      if (!await copyData(restore ? join(snapshots, `schema-${to}`) : live, next)) throw new Error("Data too large");
      if (!restore) {
        if (!manifest.data.migrate) throw new Error("Migration entry missing");
        const migration = await runOffline(ports, join(store, hash), next, manifest.data.migrate, { migrate: { from, to }, now: ports.now().toISOString() });
        output = migration.output;
        if (!migration.succeeded) throw new Error("Migration failed");
      }
      await mkdir(dirname(old), { recursive: true });
      await rm(old, { recursive: true, force: true });
      // Always leave data-old behind so crash recovery can restore the pre-swap state.
      await mkdir(live, { recursive: true });
      await rename(live, old); moved = true;
      await rename(next, live); swapped = true;
      await db.$transaction(async tx => {
        if (reason === "activate") await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved", report: json({ ...version.report as BuildReport, migration: output }) } });
        await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
        await activateIn(tx, moduleId, hash, reason);
      });
    } catch {
      if (moved) {
        if (swapped) await rm(live, { recursive: true, force: true });
        await rename(old, live);
      }
      await rm(next, { recursive: true, force: true });
      await db.$transaction(async tx => {
        await tx.module.update({ where: { id: moduleId }, data: { status: module.status } });
        if (reason === "activate") await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json({ ...version.report as BuildReport, migration: { ...output, exitCode: output.exitCode || 1 } }) } });
      });
      if (reason === "rollback" && !restore) throw new StewardError("conflict", "模块回滚未完成：数据迁移失败，旧版本和数据保持不变");
      await createNotifications(ports, workspaceId).enqueue({ affairId: module.affairId, level: "now", title: restore ? `模块 ${module.name} 回滚未完成：数据恢复失败` : `模块 ${module.name} 新版本未启用：数据迁移失败`, body: "旧版本继续运行，请检查迁移报告后重新提交。", dedupeKey: `${restore ? "module-restore-failed" : "module-migration-failed"}:${version.id}` });
      return;
    }
    // Retain the old directory until the activation transaction commits, so a DB failure can restore it.
    await rm(old, { recursive: true, force: true });
  }
  async function rollback(moduleId: string, hash: string) {
    const prepared = await db.$transaction(async tx => {
      const module = await requireModule(tx, moduleId);
      if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
      const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
      if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
      const manifest = moduleManifestSchema.parse(version.manifest), from = module.dataSchema, to = manifest.data.schema;
      if (await dataEmpty(join(platform, "data", moduleId)) || to === from) {
        await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
        return { generation: await activateIn(tx, moduleId, hash, "rollback") };
      }
      if (from !== null && to < from) {
        const at = await snapshotAt(moduleId, to);
        if (!at) throw new StewardError("conflict", `没有 schema ${to} 的数据快照，无法回滚到该版本`);
        return { restore: { schema: to, snapshotAt: at }, module };
      }
      await startMigration(tx, moduleId, hash, from, to);
      return { migration: { module, version, manifest, from, to } };
    });
    if (prepared.restore) {
      await expireModuleApprovals(moduleId);
      const approval = await createApprovals(context).create({ affairId: prepared.module.affairId, action: "activate_module", title: `回滚模块 ${prepared.module.name}`, detail: "恢复旧版本的数据快照", payload: { kind: "activate_module", moduleId, hash, restore: prepared.restore }, preview: `将恢复 ${prepared.restore.snapshotAt} 的数据，此后写入的数据会丢失；当前数据会另存为 before-rollback-<iso>。\nhash: ${hash}` });
      return { status: "pending_approval" as const, approvalId: approval.id };
    }
    if (prepared.migration) await migrateData(prepared.migration, "rollback");
    return { status: "active" as const, moduleId, activeHash: hash };
  }
  async function recoverMigrations(now = ports.now()) {
    for (const module of await db.module.findMany({ where: { workspaceId, status: "migrating" } })) {
      const started = await db.audit.findFirst({ where: { workspaceId, kind: "module_migration_started", subjectId: module.id }, orderBy: { createdAt: "desc" } });
      if (!started || started.createdAt.getTime() >= now.getTime() - 15 * 60_000) continue;
      await rm(join(platform, "data-next", module.id), { recursive: true, force: true });
      const live = join(platform, "data", module.id), old = join(platform, "data-old", module.id);
      // Still migrating means the activation never committed: data-old, if present, is the pre-migration data.
      try { await lstat(old); await rm(live, { recursive: true, force: true }); await rename(old, live); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await db.module.updateMany({ where: { id: module.id, status: "migrating" }, data: { status: "active" } });
    }
  }
  async function list(affairId?: string) {
    if (affairId) await requireAffair(db, workspaceId, affairId);
    return db.module.findMany({ where: { workspaceId, affairId }, include: { versions: { select: { hash: true, status: true, intent: true, createdAt: true }, orderBy: { createdAt: "desc" } }, runs: { take: 5, orderBy: { createdAt: "desc" }, select: { id: true, hash: true, triggerId: true, firedAt: true, exitCode: true, error: true, createdAt: true } } } });
  }
  async function checkout(moduleId: string, hash: string | undefined, dir: string) {
    const module = await requireModule(db, moduleId), selected = hash ?? module.activeHash;
    if (!selected || !await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: selected } } })) throw new StewardError("not_found", "Module version not found");
    const affair = await requireAffair(db, workspaceId, module.affairId), files: { path: string; bytes: Uint8Array }[] = [];
    async function walk(relative: string): Promise<void> {
      for (const entry of await readdir(join(store, selected!, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) files.push({ path, bytes: await readFile(join(store, selected!, path)) });
        else throw new StewardError("forbidden", "Unsafe module store file");
      }
    }
    await walk("");
    await fs.forAffair(affair.dirName).checkoutModule(dir, files);
  }
  return { propose, buildPending, recoverMigrations, activate, onApproved, rollback, list, checkout };
}
