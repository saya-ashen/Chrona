import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

const input = (value: unknown) => ({ input: JSON.stringify(value) });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const textFiles = (files: Record<string, string>): ModuleGitFile[] => Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text) }));
const intent = { changes: ["Install the explicitly imported local material"], preserves: ["Retain application data and exact version material"] };
const selected = ["modules.list", "modules.admit", "modules.submit", "author.prepare", "author.import", "author.export", "author.source", "author.write", "author.submit", "author.receipt"];

/** A real native runtime asset; the authenticated module entry remains the TypeScript SDK. */
async function workspaceFixture(root: string) {
  const from = join(root, "development");
  await mkdir(join(from, "source"), { recursive: true });
  await mkdir(join(from, "dist"));
  const c = "int main(void) { return 0; }\n";
  await writeFile(join(from, "source/probe.c"), c);
  const compiler = Bun.which(process.env.CC ?? "cc");
  const executable = join(from, "dist/probe");
  let commands: string[], toolchain: string;
  if (compiler) {
    const result = Bun.spawnSync([compiler, "source/probe.c", "-o", "dist/probe"], { cwd: from, stdout: "pipe", stderr: "pipe" });
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
    commands = [`${compiler} source/probe.c -o dist/probe`]; toolchain = "host cc, offline acceptance fixture";
  } else {
    const native = Bun.which("true");
    if (!native) throw new Error("Material acceptance requires an offline C compiler or an actual native true executable");
    await writeFile(executable, await readFile(native));
    commands = [`cp ${native} dist/probe`]; toolchain = "copied host native true executable; source/probe.c documents its behavior";
  }
  await chmod(executable, 0o755);
  const binary = await readFile(executable), digest = sha256(binary);
  expect(binary.includes(0)).toBe(true);
  const manifest = moduleManifestSchema.parse({
    name: "material-roundtrip", entry: "index.ts", tests: ["test.ts"], uses: [], effects: [], data: { schema: 1 },
    tools: [{ name: "read", description: "Read and execute the imported native runtime asset through the SDK entry", visibility: ["owner"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { message: { type: "string" }, artifactSha256: { type: "string" }, nativeExitCode: { type: "integer" } }, required: ["message", "artifactSha256", "nativeExitCode"], additionalProperties: false } }],
  });
  const files = {
    "module.json": JSON.stringify(manifest),
    ".gitignore": "dist/\n",
    "source/probe.c": c,
    "message.ts": 'export const message = "version one";\n',
    "asset.ts": `import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { message } from "./message";
export function read() {
  const path = join(import.meta.dir, "dist/probe");
  const artifactSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const native = spawnSync(path, [], { encoding: "utf8" });
  if (native.error || native.status !== 0) throw new Error("Native runtime asset did not execute");
  return { message, artifactSha256, nativeExitCode: native.status };
}
`,
    "index.ts": 'import { on } from "chrona";\nimport { read } from "./asset";\non("tool", () => ({ result: read() }));\n',
    "test.ts": `import { strict as assert } from "node:assert";
import { read } from "./asset";
import { message } from "./message";
assert.deepEqual(read(), { message, artifactSha256: ${JSON.stringify(digest)}, nativeExitCode: 0 });
console.log("checked actual native runtime asset");
`,
  };
  for (const [path, text] of Object.entries(files)) await writeFile(join(from, path), text);
  // Explicit import must ignore neither the binary nor its directory because of this file.
  await writeFile(join(from, "unselected.txt"), "not part of the explicit material selection");
  return { from, binary, digest, files, manifest, source: Object.keys(files), artifacts: [{ path: "dist/probe", executable: true }], build: { commands, toolchain, target: `${process.platform}-${process.arch}` } };
}

// Real module-origin Agent Run -> authenticated SDK Author -> fixed kernel candidates -> checker/install.
// No Provider, model, fabricated build result, wire peer, or forced pending_review transition is used.
test("current Agent imports source and ignored native assets, checks/installs fixed versions, and exports exact re-editable material", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-author-material-roundtrip-test-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const databaseUrl = `file:${join(root, "test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  let db: PrismaClient | undefined;
  let importedDatabase: PrismaClient | undefined;
  let stopSupervisor: (() => Promise<void>) | undefined;
  let ports: StewardPorts | undefined;
  try {
    // Engine imports transitively load the singleton: the isolated test URL must already be set.
    const shared = await import("@chrona/db");
    const singletonDatabases = await shared.db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    if (singletonDatabases.find(item => item.name === "main")?.file === join(root, "test.db")) importedDatabase = shared.db;
    const [{ admitContextPrimitive }, { callContextTool, contextRunTools, selectContextTools }, { readCandidateAdmissionIn, readCandidateSetIn }, { checkoutModule, snapshotModule }, { commitModuleSource, readModuleSource }, { moduleSupervisor }, { createModules }, { registerLocalRuntime }, { registerSystemModules }, { createRuns }] = await Promise.all([
      import("./agent-context"), import("./agent-context-tools"), import("./module-candidate-records"), import("./module-files"), import("./module-git"), import("./module-supervisor"), import("./modules"), import("./local-runtime"), import("./system-modules"), import("./runs"),
    ]);
    await import("./module-effects");
    ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dir, "../../../../../prisma/migrations") });
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
    const workspaceId = (await db.workspace.create({ data: { name: "Isolated material roundtrip acceptance" } })).id;
    const platform = join(root, "platform");
    const seedApproved = async (manifest: ModuleManifest, files: ModuleGitFile[]) => {
      const module = await db!.module.create({ data: { workspaceId, name: manifest.name, builtin: false, status: "active", dataSchema: manifest.data.schema } });
      const revision = await commitModuleSource({ platform, moduleId: module.id, versionId: `fixture-${module.id}`, files, message: "Approved isolated caller fixture" });
      await checkoutModule(platform, `store/${revision.commit}`, files);
      await db!.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest, source: "user", status: "approved", intent: {}, report: { git: revision } } });
      return db!.module.update({ where: { id: module.id }, data: { activeHash: revision.commit } });
    };
    const authorFiles = await snapshotModule(import.meta.dir, "external/author");
    const authorManifest = moduleManifestSchema.parse(JSON.parse(Buffer.from(authorFiles.find(file => file.path === "module.json")!.bytes).toString("utf8")));
    expect(authorManifest.uses).toEqual(["modules.source", "modules.submit", "modules.receipt"]);
    expect(authorManifest.model).toBeUndefined();
    const author = await seedApproved(authorManifest, authorFiles);
    const entryManifest = moduleManifestSchema.parse({ name: "material-conversation", entry: "index.ts", tests: ["test.ts"], uses: ["*"], effects: [], tools: [{ name: "observe", description: "Conversation fixture", visibility: ["modules"], parameters: { type: "object", properties: {} }, output: { type: "object" } }],
        authority: "owner"
    });
    const entry = await seedApproved(entryManifest, textFiles({ "module.json": JSON.stringify(entryManifest), "index.ts": 'import { on } from "chrona"; on("tool", () => ({ result: {} }));', "test.ts": "export {};" }));
    const principal = { workspaceId, ownerId: "owner", caller: { kind: "module" as const, moduleId: entry.id, hash: entry.activeHash! } };
    const contextAdmission = await admitContextPrimitive(ports, principal, "context", { requestKey: "material-conversation" }) as { contextId: string };
    const runs = createRuns(ports, workspaceId);
    let round = 0;
    const startRound = async (tools: string[]) => {
      const queued = await admitContextPrimitive(ports!, principal, "run", { requestKey: `material-round-${++round}`, contextId: contextAdmission.contextId, lane: "background", prompt: "Import, submit, and re-edit exact local material", tools, content: [] }) as { runId: string };
      const run = await runs.claimNext("background");
      expect(run?.id).toBe(queued.runId);
      const context = (await contextRunTools(ports!, run!))!;
      expect(context.caller).toEqual({ ...principal.caller, module: entry.name });
      const invoke = async (target: string, raw: Record<string, unknown>) => {
        const { requestKey, ...args } = raw;
        const tool = context.entries.find(item => `${item.module.name}.${item.tool.name}` === target);
        expect(tool).toBeDefined();
        return (await callContextTool(ports!, context, tool!.name, args, { deadline: Date.now() + 30_000, key: requestKey as string | undefined })).result;
      };
      return { invoke, finish: () => runs.finish(run!.id, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "never_started" }) };
    };
    let current = await startRound(selected);
    const invoke = (target: string, args: Record<string, unknown>) => current.invoke(target, args);
    const directory = (await invoke("modules.list", {}) as { items: { id: string; name: string; activeHash: string; versions: { hash: string; status: string }[] }[] }).items;
    const discovered = directory.find(item => item.name === "author")!;
    expect(discovered).toMatchObject({ id: author.id, activeHash: author.activeHash, status: "active" });
    expect(discovered.versions).toContainEqual(expect.objectContaining({ hash: author.activeHash, status: "approved" }));
    const submitter = { moduleId: discovered.id, hash: discovered.activeHash };
    const authorPrincipal = { ...principal, caller: { kind: "module" as const, moduleId: author.id, hash: author.activeHash! } };
    await expect(selectContextTools(ports, authorPrincipal, ["modules.admit"])).rejects.toMatchObject({ code: "forbidden" });
    await expect(selectContextTools(ports, { ...principal, caller: { ...principal.caller, hash: "0".repeat(40) } }, ["author.import"])).rejects.toMatchObject({ code: "forbidden" });

    const material = await workspaceFixture(root);
    const content = join(platform, "content", author.id);
    const imported = await invoke("author.import", input({ from: material.from, to: "sources/imported", source: material.source, artifacts: material.artifacts, build: material.build }));
    expect(imported).toMatchObject({ files: material.source.length + 2, materialDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const recordText = await readFile(join(content, "sources/imported/chrona-material.json"), "utf8");
    expect(JSON.parse(recordText)).toEqual({ schema: 1, source: material.source, artifacts: [{ path: "dist/probe", sha256: material.digest, executable: true }], build: material.build });
    expect(await readFile(join(content, "sources/imported/dist/probe"))).toEqual(material.binary);
    expect((await stat(join(content, "sources/imported/dist/probe"))).mode & 0o111).toBeGreaterThan(0);
    await expect(stat(join(content, "sources/imported/unselected.txt"))).rejects.toMatchObject({ code: "ENOENT" });

    const prepare = async (requestKey: string, targets: { name: string; moduleId: string | null; expectedActiveHash: string | null }[]) => {
      const admissionInput = { requestKey, submitter, targets };
      const prepared = await invoke("author.prepare", input({ ...admissionInput, goal: "Install and re-edit the exact imported material in this conversation", intent })) as { admission: typeof admissionInput; prompt: string };
      expect(prepared.admission).toEqual(admissionInput);
      const admission = await invoke("modules.admit", prepared.admission) as { admissionId: string };
      expect((await readCandidateAdmissionIn(moduleContext(ports!, workspaceId), db!, admission.admissionId))).toMatchObject({ input: admissionInput, issuer: { kind: "module", moduleId: entry.id, hash: entry.activeHash }, receiptId: null });
      return admission;
    };
    const initial = await prepare("import-admission", [{ name: material.manifest.name, moduleId: null, expectedActiveHash: null }]);
    const submission = { admissionId: initial.admissionId, requestKey: "import-submit", items: [{ name: material.manifest.name, dir: "sources/imported", intent }] };
    // The entry issues admission, but only the exact admitted Author identity may submit.
    await expect(invoke("modules.submit", submission)).rejects.toMatchObject({ code: "forbidden" });
    const wrong = await invoke("modules.admit", { requestKey: "wrong-submitter", submitter: { moduleId: entry.id, hash: entry.activeHash }, targets: [{ name: material.manifest.name, moduleId: null, expectedActiveHash: null }] }) as { admissionId: string };
    await expect(invoke("author.submit", input({ ...submission, requestKey: "wrong-admission-submit", admissionId: wrong.admissionId }))).rejects.toMatchObject({ code: "forbidden" });
    // Tamper after import, without changing the record: admission must not yield a candidate or receipt.
    const mutableBinary = join(content, "sources/imported/dist/probe");
    await writeFile(mutableBinary, Buffer.concat([material.binary, Buffer.from("tampered")]));
    await expect(invoke("author.submit", input({ ...submission, requestKey: "tampered-material" }))).rejects.toMatchObject({ code: "conflict" });
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(0);
    expect(await db.candidateReceipt.count()).toBe(0);
    expect((await readCandidateAdmissionIn(moduleContext(ports, workspaceId), db, initial.admissionId)).receiptId).toBeNull();
    await writeFile(mutableBinary, material.binary);
    const receipt = candidateReceiptSchema.parse(await invoke("author.submit", input(submission)));
    expect(receipt).toMatchObject({ submitter, state: "submitted", approvalId: null, members: [{ name: material.manifest.name, expectedActiveHash: null, status: "building", selected: false }] });
    const first = receipt.members[0]!;
    expect(first.hash).toMatch(/^[a-f0-9]{40}$/);
    expect(first.materialDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await db.candidateReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId }, include: { admission: true } })).admission.submitterModuleId).toBe(author.id);
    expect((await readCandidateSetIn(moduleContext(ports, workspaceId), db, receipt.receiptId))!.submitter).toEqual(submitter);
    const source = await readModuleSource({ platform, moduleId: first.moduleId, commit: first.hash });
    expect(source.map(file => file.path).sort()).toEqual([...material.source, "chrona-material.json"].sort());
    expect(source.some(file => file.path.startsWith("dist/"))).toBe(false);
    expect(Buffer.from(source.find(file => file.path === "chrona-material.json")!.bytes).toString()).toBe(recordText);
    const blob = join(platform, "artifacts/sha256", material.digest, "bytes");
    expect(await readFile(blob)).toEqual(material.binary);
    expect((await stat(blob)).mode & 0o222).toBe(0);
    // Both source and binary can now change in the mutable Author workspace; replay stays fixed.
    await invoke("author.write", { path: "sources/imported/message.ts", content: 'export const message = "mutable source must not execute";\n' });
    await writeFile(mutableBinary, "mutable binary must not execute");
    expect(await invoke("author.submit", input(submission))).toEqual(receipt);
    expect(await invoke("author.receipt", input({ admissionId: initial.admissionId, requestKey: submission.requestKey }))).toEqual(receipt);
    await expect(invoke("author.submit", input({ ...submission, requestKey: "changed-key" }))).rejects.toMatchObject({ code: "conflict" });
    await expect(invoke("author.submit", input({ ...submission, items: [{ ...submission.items[0]!, intent: { ...intent, changes: ["Changed after freezing"] } }] }))).rejects.toMatchObject({ code: "conflict" });

    const check = async (member: typeof first) => {
      await createModules(ports!, workspaceId).buildPending(ports!.now());
      const checked = await db!.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } });
      const report = checked.report as BuildReport;
      expect({ status: checked.status, errors: report.errors, typecheck: report.typecheck }).toEqual({ status: "approved", errors: undefined, typecheck: { status: "passed" } });
      expect(report.tests).toEqual([{ exitCode: 0, stderr: "", stdout: "checked actual native runtime asset\n" }]);
      expect(report.git?.commit).toBe(member.hash);
      expect(await db!.module.findUniqueOrThrow({ where: { id: member.moduleId } })).toMatchObject({ activeHash: member.hash, status: "active" });
      expect(await db!.moduleReview.count({ where: { versionId: member.versionId } })).toBe(1);
    };
    await check(first);
    const approved = candidateReceiptSchema.parse(await invoke("author.receipt", input({ receiptId: receipt.receiptId })));
    expect(approved).toMatchObject({ state: "approved", approvalId: null, members: [{ hash: first.hash, status: "approved", selected: true }] });
    const installed = join(platform, "store", first.hash);
    expect(await readFile(join(installed, "dist/probe"))).toEqual(material.binary);
    expect((await stat(join(installed, "dist/probe"))).mode & 0o111).toBeGreaterThan(0);
    expect(await readFile(join(installed, "message.ts"), "utf8")).toBe(material.files["message.ts"]);
    expect(await invoke("author.submit", input(submission))).toEqual(receipt);
    // A later conversation round can select the newly installed tool through the actual Agent catalog.
    await current.finish();
    current = await startRound([...selected, "material-roundtrip.read"]);
    expect(await invoke("material-roundtrip.read", {})).toEqual({ message: "version one", artifactSha256: material.digest, nativeExitCode: 0 });

    const next = await prepare("re-edit-admission", [{ name: material.manifest.name, moduleId: first.moduleId, expectedActiveHash: first.hash }]);
    await expect(invoke("author.source", input({ admissionId: next.admissionId, moduleId: first.moduleId, hash: "0".repeat(40), to: "sources/wrong-version" }))).rejects.toMatchObject({ code: "forbidden" });
    const exported = await invoke("author.source", input({ admissionId: next.admissionId, moduleId: first.moduleId, hash: first.hash, to: "sources/old-version" }));
    expect(exported).toEqual({ moduleId: first.moduleId, hash: first.hash, materialDigest: first.materialDigest });
    expect(await readFile(join(content, "sources/old-version/dist/probe"))).toEqual(material.binary);
    expect(await readFile(join(content, "sources/old-version/chrona-material.json"), "utf8")).toBe(recordText);
    const development = join(root, "re-edit-development");
    expect(await invoke("author.export", input({ path: "sources/old-version", to: development }))).toMatchObject({ to: development, files: material.source.length + 2 });
    for (const [path, text] of Object.entries(material.files)) expect(await readFile(join(development, path), "utf8")).toBe(text);
    expect(await readFile(join(development, "dist/probe"))).toEqual(material.binary);
    expect((await stat(join(development, "dist/probe"))).mode & 0o111).toBeGreaterThan(0);
    // Native executables accept trailing data. This gives the next version distinct, still executable bytes.
    const nextBinary = Buffer.concat([material.binary, Buffer.from("\0version two native runtime asset\n")]);
    const nextDigest = sha256(nextBinary);
    await writeFile(join(development, "dist/probe"), nextBinary);
    await writeFile(join(development, "message.ts"), 'export const message = "version two";\n');
    await writeFile(join(development, "test.ts"), material.files["test.ts"].replace(material.digest, nextDigest));
    const nextBuild = { ...material.build, commands: [...material.build.commands, "append version marker to dist/probe"] };
    await invoke("author.import", input({ from: development, to: "sources/re-edited", source: material.source, artifacts: material.artifacts, build: nextBuild }));
    const nextSubmission = { admissionId: next.admissionId, requestKey: "re-edit-submit", items: [{ name: material.manifest.name, dir: "sources/re-edited", intent }] };
    const nextReceipt = candidateReceiptSchema.parse(await invoke("author.submit", input(nextSubmission)));
    const second = nextReceipt.members[0]!;
    expect(second).toMatchObject({ moduleId: first.moduleId, expectedActiveHash: first.hash, status: "building", selected: false });
    expect(second.hash).not.toBe(first.hash);
    expect(second.materialDigest).not.toBe(first.materialDigest);
    expect((await readCandidateAdmissionIn(moduleContext(ports, workspaceId), db, next.admissionId)).input.targets).toEqual([{ name: material.manifest.name, moduleId: first.moduleId, expectedActiveHash: first.hash }]);
    await check(second);
    // The old SDK process must release ownership with real descendant-stop evidence before replacement.
    await moduleSupervisor(ports).settleModule(first.moduleId);
    expect(await invoke("material-roundtrip.read", {})).toEqual({ message: "version two", artifactSha256: nextDigest, nativeExitCode: 0 });
    expect(await readFile(join(platform, "store", second.hash, "dist/probe"))).toEqual(nextBinary);
    expect(await readFile(blob)).toEqual(material.binary);
    // Export the saved exact old kernel source after a newer version is active; never silently select latest.
    const oldDevelopment = join(root, "old-version-development");
    await invoke("author.export", input({ path: "sources/old-version", to: oldDevelopment }));
    expect(await readFile(join(oldDevelopment, "chrona-material.json"), "utf8")).toBe(recordText);
    for (const [path, text] of Object.entries(material.files)) expect(await readFile(join(oldDevelopment, path), "utf8")).toBe(text);
    expect(await readFile(join(oldDevelopment, "dist/probe"))).toEqual(material.binary);
    expect((await stat(join(oldDevelopment, "dist/probe"))).mode & 0o111).toBeGreaterThan(0);
    const oldReceipt = candidateReceiptSchema.parse(await invoke("author.receipt", input({ receiptId: receipt.receiptId })));
    expect(oldReceipt).toMatchObject({ state: "approved", members: [{ hash: first.hash, materialDigest: first.materialDigest, selected: false }] });
    const secondApproved = candidateReceiptSchema.parse(await invoke("author.receipt", input({ receiptId: nextReceipt.receiptId })));
    expect(secondApproved).toMatchObject({ state: "approved", approvalId: null, members: [{ hash: second.hash, selected: true, expectedActiveHash: first.hash }] });

    // Corrupt a stored immutable blob only inside this disposable fixture. Both export and the checker fail closed.
    const corruptAdmission = await prepare("corrupt-admission", [{ name: material.manifest.name, moduleId: first.moduleId, expectedActiveHash: second.hash }]);
    await invoke("author.write", { path: "sources/re-edited/message.ts", content: 'export const message = "must never install";\n' });
    const corruptSubmission = { admissionId: corruptAdmission.admissionId, requestKey: "corrupt-submit", items: [{ name: material.manifest.name, dir: "sources/re-edited", intent }] };
    const corruptReceipt = candidateReceiptSchema.parse(await invoke("author.submit", input(corruptSubmission)));
    const corrupt = corruptReceipt.members[0]!;
    const nextBlob = join(platform, "artifacts/sha256", nextDigest, "bytes");
    await chmod(nextBlob, 0o644);
    await writeFile(nextBlob, "corrupt immutable artifact");
    await chmod(nextBlob, 0o444);
    // Use a fresh unconsumed admission for an otherwise authorized exact active source export.
    const sourceAdmission = await prepare("corrupt-source-admission", [{ name: material.manifest.name, moduleId: first.moduleId, expectedActiveHash: second.hash }]);
    await expect(invoke("author.source", input({ admissionId: sourceAdmission.admissionId, moduleId: first.moduleId, hash: second.hash, to: "sources/corrupt-export" }))).rejects.toMatchObject({ code: "conflict" });
    await expect(stat(join(content, "sources/corrupt-export"))).rejects.toMatchObject({ code: "ENOENT" });
    await createModules(ports, workspaceId).buildPending(ports.now());
    const rejected = await db.moduleVersion.findUniqueOrThrow({ where: { id: corrupt.versionId } });
    expect(rejected.status).toBe("rejected");
    expect(JSON.stringify(rejected.report)).toContain("Stored artifact digest or object layout mismatch");
    expect((rejected.report as BuildReport).tests.every(result => result.exitCode !== 0)).toBe(true);
    expect((await db.module.findUniqueOrThrow({ where: { id: first.moduleId } })).activeHash).toBe(second.hash);
    await expect(stat(join(platform, "store", corrupt.hash))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(nextBlob, "utf8")).toBe("corrupt immutable artifact");
    expect(await invoke("author.receipt", input({ receiptId: corruptReceipt.receiptId }))).toMatchObject({ state: "rejected", members: [{ hash: corrupt.hash, selected: false }] });
    expect(await db.moduleVersion.count({ where: { source: "candidate" } })).toBe(3);
    expect(await db.candidateReceipt.count()).toBe(3);
    expect(await db.approval.count()).toBe(0);
    expect(await db.generation.count({ where: { workspaceId } })).toBe(2);
    // Router evidence retains the entry caller and the actual Author identity across nested SDK calls.
    const invocations = await db.moduleInvocation.findMany({ where: { workspaceId } });
    for (const tool of ["prepare", "import", "export", "write", "source", "submit", "receipt"]) {
      const calls = invocations.filter(row => row.target === "author" && row.tool === tool);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).toMatchObject({ caller: `module:${entry.id}`, callerModuleId: entry.id, callerHash: entry.activeHash, chain: [], mode: "sync" });
    }
    for (const tool of ["source", "submit", "receipt"]) {
      const calls = invocations.filter(row => row.target === "modules" && row.tool === tool && row.callerModuleId === author.id);
      expect(calls.some(row => row.status === "succeeded")).toBe(true);
      for (const call of calls) expect(call).toMatchObject({ caller: `module:${author.id}`, callerHash: author.activeHash, chain: ["author"], mode: "sync" });
    }
    expect(invocations.some(row => row.caller === "owner" || row.caller.startsWith("provider:"))).toBe(false);
    expect(await db.run.count()).toBe(2);
    expect(await db.executionAttempt.count()).toBe(0);
    expect(await db.moduleCall.count({ where: { moduleId: author.id, status: "executed", method: "call" } })).toBeGreaterThan(0);
    await current.finish();
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
}, 180_000);
