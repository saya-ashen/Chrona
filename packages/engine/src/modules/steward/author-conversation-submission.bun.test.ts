import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import { candidateReceiptSchema } from "../../../../contracts/src/steward/module-candidates";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import runtimes from "../../../../integrations/src/steward/runtimes.json";
import type { ModuleGitFile } from "./module-git";
import { moduleContext, type BuildReport } from "./module-context";
import type { StewardPorts } from "./ports";

const selected = ["modules.list", "modules.admit-candidates", "modules.submit", "approvals.resolve", "author.prepare", "author.source", "author.write", "author.submit", "author.receipt"];
const input = (value: unknown) => ({ input: JSON.stringify(value) });
const intent = { changes: ["Install the fixed local conversation proof"], preserves: ["Retain existing application data"] };
const textFiles = (files: Record<string, string>): ModuleGitFile[] => Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text) }));

function application(name: string, credentials = false) {
  return moduleManifestSchema.parse({
    name, entry: "index.ts", tests: ["test.ts"], uses: [], effects: [], data: { schema: 1 },
    tools: [{ name: "read", description: "Read the installed proof message", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } }],
    // Declaration only: the real checker requires approval, without obtaining credentials or contacting these URLs.
    ...(credentials ? { secrets: [{ name: "mail", label: "Offline approval proof", fields: [], oauth: { provider: "google", authorizationUrl: "https://mail.example.test/authorize", tokenUrl: "https://mail.example.test/token", scopes: ["mail.read"] } }] } : {}),
  });
}
function applicationFiles(manifest: ModuleManifest, message: string) {
  return {
    "module.json": JSON.stringify(manifest),
    "index.ts": 'import { on } from "chrona";\nimport { message } from "./message";\non("tool", () => ({ result: { message } }));\n',
    "message.ts": `export const message = ${JSON.stringify(message)};\n`,
    "test.ts": `import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { message } from "./message";
assert.equal(message, ${JSON.stringify(message)});
const state = join(process.env.CHRONA_DATA!, "state.json");
if (!existsSync(state)) writeFileSync(state, JSON.stringify({ count: 7 }));
assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), { count: 7 });
writeFileSync(state, JSON.stringify({ count: 99 }));
console.log(${JSON.stringify(`checked immutable ${message}`)});
`,
  };
}

// The conversation is a real module-origin Agent context. We drive its selected tools deterministically;
// no Provider/model is registered or started, and no fake wire peer or lifecycle report is installed.
test("current approved wildcard conversation routes SDK Author material into checked, approved fixed candidates as Author", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-author-conversation-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const databaseUrl = `file:${join(root, "test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  let db: PrismaClient | undefined;
  let importedDatabase: PrismaClient | undefined;
  let stopSupervisor: (() => Promise<void>) | undefined;
  let ports: StewardPorts | undefined;
  try {
    // Engine imports transitively load @chrona/db's singleton. Set the temporary URL before loading any of them.
    const shared = await import("@chrona/db");
    const sharedDatabases = await shared.db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    if (sharedDatabases.find(item => item.name === "main")?.file === join(root, "test.db")) importedDatabase = shared.db;
    const [{ admitContextPrimitive }, { callContextTool, contextRunTools, selectContextTools }, { readCandidateAdmissionIn, readCandidateSetIn }, { checkoutModule, snapshotModule }, { commitModuleSource }, { moduleSupervisor }, { createModules }, { registerLocalRuntime }, { registerSystemModules }, { createRuns }] = await Promise.all([
      import("./agent-context"), import("./agent-context-tools"), import("./module-candidate-records"), import("./module-files"), import("./module-git"), import("./module-supervisor"), import("./modules"), import("./local-runtime"), import("./system-modules"), import("./runs"),
    ]);
    await import("./module-effects");
    ensureSqliteDatabase({ databaseUrl: process.env.DATABASE_URL, migrationsDir: resolve(import.meta.dir, "../../../../../prisma/migrations") });
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
    const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    expect(databases.find(item => item.name === "main")?.file).toBe(join(root, "test.db"));
    expect(process.env.DATABASE_URL).toBe(databaseUrl);
    const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
    expect(sandbox.health.available).toBe(true);
    ports = {
      db, dataDir: root, publicUrl: null, now: () => new Date(), moduleSdk: sdk,
      moduleTypecheck: resolve(import.meta.dir, "../../../../integrations/src/steward/module-typecheck"), moduleRuntimes: runtimes,
      sandbox: { ...sandbox.health, startModule: sandbox.startModule, runModule: sandbox.runModule },
    };
    stopSupervisor = () => moduleSupervisor(ports!).stop();
    registerSystemModules(); registerLocalRuntime();
    await symlink(resolve(import.meta.dir, "../../../../../node_modules"), join(root, "node_modules"), "dir");
    const workspaceId = (await db.workspace.create({ data: { name: "Isolated current conversation Author proof" } })).id;
    const platform = join(root, "platform");
    const seedApproved = async (manifest: ModuleManifest, files: ModuleGitFile[]) => {
      const module = await db!.module.create({ data: { workspaceId, name: manifest.name, builtin: false, status: "active", dataSchema: manifest.data.schema } });
      const revision = await commitModuleSource({ platform, moduleId: module.id, versionId: `fixture-${module.id}`, files, message: "Approved isolated fixture" });
      await checkoutModule(platform, `store/${revision.commit}`, files);
      await db!.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest, source: "user", status: "approved", intent: {}, report: { git: revision } } });
      return db!.module.update({ where: { id: module.id }, data: { activeHash: revision.commit } });
    };
    const authorFiles = await snapshotModule(import.meta.dir, "external/author");
    const authorManifest = moduleManifestSchema.parse(JSON.parse(Buffer.from(authorFiles.find(file => file.path === "module.json")!.bytes).toString("utf8")));
    expect(authorManifest.uses).toEqual(["modules.source", "modules.submit", "modules.candidate-check"]);
    expect(authorManifest.model).toBeUndefined();
    const author = await seedApproved(authorManifest, authorFiles);
    // A Web-like approved wildcard entry, retaining its actual module identity throughout the Agent run.
    const entryManifest = moduleManifestSchema.parse({ name: "conversation-entry", entry: "index.ts", tests: ["test.ts"], uses: ["*"], effects: [], tools: [{ name: "observe", description: "Conversation fixture", visibility: ["modules"], parameters: { type: "object", properties: {} }, output: { type: "object" } }] });
    const entry = await seedApproved(entryManifest, textFiles({ "module.json": JSON.stringify(entryManifest), "index.ts": 'import { on } from "chrona"; on("tool", () => ({ result: {} }));', "test.ts": "export {};" }));
    const baselineManifest = application("proof-alpha");
    const baseline = await seedApproved(baselineManifest, textFiles(applicationFiles(baselineManifest, "approved baseline")));
    const liveData = join(platform, "data", baseline.id, "state.json");
    await mkdir(join(platform, "data", baseline.id), { recursive: true });
    await writeFile(liveData, JSON.stringify({ count: 7 }));
    const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: entry.id, hash: entry.activeHash! } };
    const contextAdmission = await admitContextPrimitive(ports, principal, "context", { requestKey: "current-conversation" }) as { contextId: string };
    const queued = await admitContextPrimitive(ports, principal, "run", { requestKey: "current-round", contextId: contextAdmission.contextId, lane: "background", prompt: "Prepare and submit the owner's fixed local material", tools: selected, content: [] }) as { runId: string };
    const run = await createRuns(ports, workspaceId).claimNext("background");
    expect(run?.id).toBe(queued.runId);
    const context = (await contextRunTools(ports, run!))!;
    expect(context.caller).toEqual({ ...principal.caller, module: entry.name });
    expect(context.entries.map(item => `${item.module.name}.${item.tool.name}`)).toEqual(selected);
    const invoke = async (target: string, args: Record<string, unknown>) => {
      const tool = context.entries.find(item => `${item.module.name}.${item.tool.name}` === target);
      expect(tool).toBeDefined();
      return (await callContextTool(ports!, context, tool!.name, args, Date.now() + 30_000)).result;
    };
    // Discovery occurs through the selected kernel tool, before Author prepares its admission draft.
    const directory = await invoke("modules.list", {}) as { id: string; name: string; activeHash: string; versions: { hash: string; status: string }[] }[];
    const discovered = directory.find(item => item.name === "author")!;
    expect(discovered).toMatchObject({ id: author.id, activeHash: author.activeHash, status: "active" });
    expect(discovered.versions).toContainEqual(expect.objectContaining({ hash: author.activeHash, status: "approved" }));
    const submitter = { moduleId: discovered.id, hash: discovered.activeHash };
    const targets = [{ name: baseline.name, moduleId: baseline.id, expectedActiveHash: baseline.activeHash }, { name: "proof-beta", moduleId: null, expectedActiveHash: null }];
    const admissionInput = { requestKey: "fixed-admission", submitter, targets };
    const prepared = await invoke("author.prepare", input({ ...admissionInput, goal: "Write and install two local proof applications in this conversation", intent })) as { admission: typeof admissionInput; prompt: string };
    expect(prepared.admission).toEqual(admissionInput);
    expect(prepared.prompt).toContain("current conversation");
    expect(await db.candidateAdmission.count()).toBe(0);
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
    const admission = await invoke("modules.admit-candidates", prepared.admission) as { admissionId: string };
    const issuer = { kind: "module" as const, module: entry.name, moduleId: entry.id, hash: entry.activeHash! };
    const grant = (await readCandidateAdmissionIn(moduleContext(ports, workspaceId), db, admission.admissionId));
    expect(grant).toEqual({ input: admissionInput, issuer, receiptId: null });
    // Author has only its narrow kernel contracts; it cannot select the admission tool itself.
    const authorPrincipal = { ...principal, caller: { kind: "module" as const, moduleId: author.id, hash: author.activeHash! } };
    await expect(selectContextTools(ports, authorPrincipal, ["modules.admit-candidates"])).rejects.toMatchObject({ code: "forbidden" });
    await expect(selectContextTools(ports, { ...principal, caller: { ...principal.caller, hash: "0".repeat(40) } }, ["modules.admit-candidates"])).rejects.toMatchObject({ code: "forbidden" });

    const exported = await invoke("author.source", input({ admissionId: admission.admissionId, moduleId: baseline.id, hash: baseline.activeHash, to: "sources/alpha" }));
    expect(exported).toMatchObject({ moduleId: baseline.id, hash: baseline.activeHash, materialDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const content = join(platform, "content", author.id);
    expect(await readFile(join(content, "sources/alpha/message.ts"), "utf8")).toContain("approved baseline");
    for (const [name, dir, credential] of [["proof-alpha", "alpha", true], ["proof-beta", "beta", false]] as const) {
      for (const [file, text] of Object.entries(applicationFiles(application(name, credential), `candidate ${name}`))) {
        const path = `sources/${dir}/${file}`;
        expect(await invoke("author.write", { path, content: text })).toEqual({ path, size: Buffer.byteLength(text) });
        expect(await readFile(join(content, path), "utf8")).toBe(text);
      }
    }
    const submission = { admissionId: admission.admissionId, requestKey: "fixed-submit", items: [{ name: "proof-alpha", dir: "sources/alpha", intent }, { name: "proof-beta", dir: "sources/beta", intent }] };
    // The wildcard entry is the issuer, not the admitted submitter. Author's real SDK identity must win.
    await expect(invoke("modules.submit", submission)).rejects.toMatchObject({ code: "forbidden" });
    const wrongSubmitterAdmission = await invoke("modules.admit-candidates", { ...admissionInput, requestKey: "wrong-submitter", submitter: { moduleId: entry.id, hash: entry.activeHash } }) as { admissionId: string };
    await expect(invoke("author.submit", input({ ...submission, admissionId: wrongSubmitterAdmission.admissionId }))).rejects.toMatchObject({ code: "forbidden" });
    for (const items of [submission.items.slice(0, 1), [submission.items[0]!, { ...submission.items[1]!, name: "unadmitted-target" }]]) {
      await expect(invoke("author.submit", input({ ...submission, items }))).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
    expect(await db.candidateReceipt.count()).toBe(0);
    expect((await db.module.findUniqueOrThrow({ where: { id: baseline.id } })).activeHash).toBe(baseline.activeHash);
    expect(await db.module.count({ where: { name: { in: ["proof-beta", "unadmitted-target"] } } })).toBe(0);

    const receipt = candidateReceiptSchema.parse(await invoke("author.submit", input(submission)));
    expect(receipt).toMatchObject({ admissionId: admission.admissionId, requestKey: submission.requestKey, submitter, state: "submitted", approvalId: null });
    expect(receipt.members).toHaveLength(2);
    expect(receipt.members.map(member => member.name)).toEqual(targets.map(target => target.name));
    for (const member of receipt.members) {
      expect(member.hash).toMatch(/^[a-f0-9]{40}$/);
      expect(member.materialDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(member).toMatchObject({ status: "building", selected: false, expectedActiveHash: targets.find(target => target.name === member.name)!.expectedActiveHash });
      expect(await db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } })).toMatchObject({ moduleId: member.moduleId, hash: member.hash, source: "candidate", status: "building", report: { tests: [], git: { commit: member.hash, tree: expect.any(String) } } });
      expect(await db.candidateMember.findUniqueOrThrow({ where: { versionId: member.versionId }, select: { receiptId: true, versionId: true } })).toEqual({ receiptId: receipt.receiptId, versionId: member.versionId });
    }
    const receiptRow = await db.candidateReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId }, include: { admission: true } });
    expect(receiptRow.admission.submitterModuleId).toBe(author.id);
    expect((await readCandidateSetIn(moduleContext(ports, workspaceId), db, receipt.receiptId))!.submitter).toEqual(submitter);
    expect((await readCandidateAdmissionIn(moduleContext(ports, workspaceId), db, admission.admissionId)).receiptId).toBe(receipt.receiptId);
    // Mutate both live workspaces through the SDK: replay and the checker must use the already frozen Git material.
    for (const dir of ["alpha", "beta"]) await invoke("author.write", { path: `sources/${dir}/message.ts`, content: 'export const message = "mutable source must not execute";\n' });
    expect(await invoke("author.submit", input(submission))).toEqual(receipt);
    expect(await invoke("author.receipt", input({ admissionId: admission.admissionId, requestKey: submission.requestKey }))).toEqual(receipt);
    await expect(invoke("author.submit", input({ ...submission, requestKey: "changed-key" }))).rejects.toMatchObject({ code: "conflict" });
    await expect(invoke("author.submit", input({ ...submission, items: [{ ...submission.items[0]!, intent: { ...intent, changes: ["Changed payload after submission"] } }, submission.items[1]!] }))).rejects.toMatchObject({ code: "conflict" });
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(2);
    expect(await db.candidateReceipt.count()).toBe(1);

    // Actual queue checks: type checking, offline tests, copied-data continuity and authenticated SDK startup.
    await createModules(ports, workspaceId).buildPending(ports.now());
    for (const member of receipt.members) {
      const checked = await db.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } });
      const report = checked.report as BuildReport;
      expect({ status: checked.status, errors: report.errors, typecheck: report.typecheck }).toEqual({ status: "pending_review", errors: undefined, typecheck: { status: "passed" } });
      expect(report.tests).toHaveLength(1);
      expect(report.tests[0]).toMatchObject({ exitCode: 0, stderr: "", stdout: expect.stringContaining(`checked immutable candidate ${member.name}`) });
      expect(report.git?.commit).toBe(member.hash);
      expect(await readFile(join(platform, "store", member.hash, "message.ts"), "utf8")).toContain(`candidate ${member.name}`);
      if (member.name === baseline.name) expect(report.continuity).toMatchObject({ status: "passed", fromSchema: 1, toSchema: 1, migrated: false, tests: [{ exitCode: 0, stdout: "", stderr: "" }] });
      expect(await db.moduleReview.count({ where: { versionId: member.versionId } })).toBe(1);
    }
    expect(JSON.parse(await readFile(liveData, "utf8"))).toEqual({ count: 7 });
    const waiting = candidateReceiptSchema.parse(await invoke("author.receipt", input({ receiptId: receipt.receiptId })));
    expect(waiting).toMatchObject({ receiptId: receipt.receiptId, submitter, state: "pending_approval" });
    expect(typeof waiting.approvalId).toBe("string");
    expect(waiting.members.every(member => member.status === "pending_review" && !member.selected)).toBe(true);
    const approval = await db.approval.findUniqueOrThrow({ where: { id: waiting.approvalId! } });
    expect(approval).toMatchObject({ status: "open", action: "activate_module", payload: { kind: "activate_modules", versions: receipt.members.map(member => ({ moduleId: member.moduleId, hash: member.hash })) } });
    expect(await db.generation.count({ where: { workspaceId } })).toBe(0);
    expect(await invoke("approvals.resolve", { approval: approval.id, decision: "approve" })).toMatchObject({ id: approval.id, status: "approved" });
    const approved = candidateReceiptSchema.parse(await invoke("author.receipt", input({ receiptId: receipt.receiptId })));
    expect(approved).toMatchObject({ receiptId: receipt.receiptId, submitter, state: "approved", approvalId: approval.id });
    expect(approved.members.every(member => member.status === "approved" && member.selected)).toBe(true);
    for (const member of approved.members) expect(await db.module.findUniqueOrThrow({ where: { id: member.moduleId } })).toMatchObject({ status: "active", activeHash: member.hash });
    expect(await db.generation.count({ where: { workspaceId } })).toBe(1);
    expect(await invoke("author.submit", input(submission))).toEqual(approved);
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(2);
    expect(await db.candidateReceipt.count()).toBe(1);
    const resolution = await db.audit.findFirstOrThrow({ where: { kind: "approval_resolved", subjectId: approval.id } });
    expect(resolution.details).toMatchObject({ decision: "approve", source: entry.name });

    // Persisted router evidence proves the boundary identities, including rejected SDK submissions.
    const invocations = await db.moduleInvocation.findMany({ where: { workspaceId } });
    for (const tool of ["prepare", "source", "write", "submit", "receipt"]) {
      const calls = invocations.filter(row => row.target === "author" && row.tool === tool);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).toMatchObject({ caller: `module:${entry.id}`, callerModuleId: entry.id, callerHash: entry.activeHash, chain: [], mode: "sync" });
    }
    for (const tool of ["source", "submit", "candidate-check"]) {
      const calls = invocations.filter(row => row.target === "modules" && row.tool === tool && row.callerModuleId === author.id);
      expect(calls.some(row => row.status === "succeeded")).toBe(true);
      for (const call of calls) expect(call).toMatchObject({ caller: `module:${author.id}`, callerHash: author.activeHash, chain: ["author"], mode: "sync" });
    }
    expect(invocations.some(row => row.target === "modules" && row.tool === "submit" && row.callerModuleId === author.id && row.status === "failed")).toBe(true);
    for (const tool of ["list", "admit-candidates"]) expect(invocations.find(row => row.target === "modules" && row.tool === tool && row.status === "succeeded")).toMatchObject({ caller: `module:${entry.id}`, callerModuleId: entry.id, callerHash: entry.activeHash, chain: [] });
    expect(invocations.some(row => row.caller === "owner" || row.caller.startsWith("provider:"))).toBe(false);
    expect(await db.run.count()).toBe(1);
    expect(await db.executionAttempt.count()).toBe(0);
    expect(await db.moduleCall.count({ where: { moduleId: author.id, status: "executed", method: "call" } })).toBeGreaterThan(0);
    await createRuns(ports, workspaceId).finish(run!.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "never_started" });
  } finally {
    try { await stopSupervisor?.(); }
    finally {
      try { await db?.$disconnect(); await importedDatabase?.$disconnect(); }
      finally {
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
        await rm(root, { recursive: true, force: true });
      }
    }
  }
}, 120_000);
