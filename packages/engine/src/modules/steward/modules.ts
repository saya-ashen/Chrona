import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { StewardPorts } from "./ports";
import { createWorkspaceFs } from "./workspace-fs";
import { requireAffair } from "./affairs";
import { createApprovals, type ApprovedAction } from "./approvals";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { notificationSettings } from "./settings";
import { parseInput, StewardError } from "./errors";

const intentSchema = z.object({ changes: z.array(z.string().trim().min(1).max(500)).min(1).max(20), preserves: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict();
type TestReport = { stdout: string; stderr: string; exitCode: number }[];
type Proposal = { moduleId: string | null; hash: string; status: "rejected" | "pending_review" | "approved"; approvalId?: string; report: TestReport };
const json = (value: unknown) => value as Prisma.InputJsonValue;

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
  async function propose(input: { affairId: string; dir: string; intent: z.input<typeof intentSchema> }, source: "provider" | "user"): Promise<Proposal> {
    const intent = parseInput(intentSchema, input.intent);
    if (source !== "provider" && source !== "user") throw new StewardError("invalid", "Invalid module source");
    const affair = await requireAffair(db, workspaceId, input.affairId);
    const files = await fs.forAffair(affair.dirName).snapshotModule(input.dir);
    const digest = createHash("sha256");
    for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
    const hash = digest.digest("hex"), report: TestReport = [];
    const staging = join(platform, "staging", randomUUID());
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
      let passed = files.some(file => file.path === manifest.entry);
      for (const action of ["activate_module", "notify_user"] as const) {
        if ((await effectivePolicyIn(db, workspaceId, action, { affairId: affair.id }, ports.now())).mode === "never") permitted = false;
      }
      if (existing?.status === "approved") return { moduleId: module.id, hash, status: permitted ? "approved" : "rejected", report: existing.report as TestReport };
      passed = passed && permitted;
      if (passed) {
        for (const entry of manifest.tests) {
          const data = await mkdtemp(join(tmpdir(), "chrona-module-test-"));
          try {
            if (!ports.sandbox?.available || !ports.sandbox.runModule) { passed = false; break; }
            const result = await ports.sandbox.runModule({ codeDir: staging, dataDir: data, entry, input: { now: ports.now().toISOString(), params: Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value])) }, network: false, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
            report.push({ stdout: result.output, stderr: result.error ?? "", exitCode: result.exitCode ?? 1 });
            if (result.status !== "succeeded" || result.exitCode !== 0) passed = false;
          } catch { passed = false; }
          finally { await rm(data, { recursive: true, force: true }); }
        }
      }
      // Only engine-owned immutable copies are tested, hashed and installed.
      const destination = join(store, hash);
      await mkdir(store, { recursive: true });
      try {
        await rename(staging, destination);
      } catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      const status = passed ? "pending_review" : "rejected";
      await db.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: module.id, hash } }, create: { moduleId: module.id, hash, manifest: json(manifest), intent: json(intent), source, report: json(report), status, createdAt: ports.now() }, update: { intent: json(intent), source, report: json(report), status } });
      if (!passed) return { moduleId: module.id, hash, status, report };
      const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
      const diff = ["--- active", "+++ proposed", ...JSON.stringify(active?.manifest ?? null, null, 2).split("\n").map(line => `- ${line}`), ...JSON.stringify(manifest, null, 2).split("\n").map(line => `+ ${line}`)].join("\n");
      const results = report.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
      const prefix = `联网：${manifest.effects.includes("network") ? "是" : "否"}\n${diff}\n`;
      const suffix = `意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
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
      const open = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
      const ids = open.filter(row => { const payload = row.payload; return payload && typeof payload === "object" && !Array.isArray(payload) && payload.moduleId === module.id; }).map(row => row.id);
      await db.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
      const approval = await createApprovals(context).create({ affairId: affair.id, action: "activate_module", title: `启用模块 ${manifest.name}`, detail: "审查此版本的清单、意图与测试结果", payload: { kind: "activate_module", moduleId: module.id, hash }, preview });
      return { moduleId: module.id, hash, status, approvalId: approval.id, report };
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  const activate = (moduleId: string, hash: string, reason: "activate" | "rollback") => db.$transaction(tx => activateIn(tx, moduleId, hash, reason));
  async function onApproved(action: ApprovedAction) {
    const payload = action.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.kind !== "activate_module") return;
    if (action.workspaceId !== workspaceId || typeof payload.moduleId !== "string" || typeof payload.hash !== "string") throw new StewardError("invalid", "Invalid module approval");
    const { moduleId, hash } = payload;
    return db.$transaction(async tx => {
      const module = await requireModule(tx, moduleId);
      const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "activate_module", status: "approved", grantId: action.grantId } });
      if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(payload)) throw new StewardError("conflict", "Module approval does not match");
      for (const action of ["activate_module", "notify_user"] as const) {
        const decision = await effectivePolicyIn(tx, workspaceId, action, { affairId: module.affairId }, ports.now());
        if (decision.mode === "never" || (action === "activate_module" && decision.mode === "ask")) throw new StewardError("forbidden", "Policy no longer allows module activation");
      }
      await consumeOnce(tx, workspaceId, action.grantId, ports.now());
      const changed = await tx.moduleVersion.updateMany({ where: { moduleId, hash, status: "pending_review" }, data: { status: "approved" } });
      if (!changed.count) throw new StewardError("conflict", "Module version is not pending review");
      return activateIn(tx, moduleId, hash, "activate");
    });
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
  return { propose, activate, onApproved, rollback: (moduleId: string, hash: string) => activate(moduleId, hash, "rollback"), list, checkout };
}
