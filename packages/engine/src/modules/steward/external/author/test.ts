import { strict as assert } from "node:assert";
import { link, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorError, parsePrepare, parseReceipt, parseStage, parseSubmit } from "./contracts";
import { packageMaterial, stagePackage } from "./distribution";
import { createSourceFiles, SOURCE_LIMITS } from "./files";
import { authorTool, prepareMaterial, type AuthorContext } from "./workflow";
// @ts-expect-error Chrona supplies the isolated test kernel.
import { paths, startModule } from "chrona/testing";

const version = "a".repeat(40), materialDigest = "b".repeat(64);
const intent = { changes: ["Create a fixture"], preserves: ["No network"] };
const prepare = { requestKey: "material-1", submitter: { moduleId: "author-id", hash: version }, targets: [{ name: "fixture", moduleId: null, expectedActiveHash: null }], goal: "Create a local fixture", intent };
const submission = { admissionId: "admission-1", requestKey: "material-1", items: [{ name: "fixture", dir: "packages/release/source", intent }] };
const source = { admissionId: "admission-1", moduleId: "fixture-id", hash: version, to: "sources/imported" };
const stage = { name: "fixture", from: "sources/work", to: "packages/release", provenance: { kind: "local", label: "Offline fixture" } };
const manifestText = JSON.stringify({ name: "fixture", entry: "index.ts", tools: [] });
const owner = { kind: "owner" as const, via: null }, provider = { kind: "provider" as const, runId: "r" };
const input = (value: unknown) => ({ input: JSON.stringify(value) });
const root = await mkdtemp(join(tmpdir(), "author-source-"));
try {
  const content = join(root, "content"), outside = join(root, "outside");
  await mkdir(content); await mkdir(outside);
  const files = createSourceFiles(content);
  assert.deepEqual(await files.list(""), { path: "", entries: [] });
  assert.deepEqual(await files.list("."), { path: "", entries: [] });
  await assert.rejects(files.list("sources"), { code: "not_found" });
  assert.deepEqual(prepareMaterial(parsePrepare(prepare)).admission, { requestKey: prepare.requestKey, submitter: prepare.submitter, targets: prepare.targets });
  assert.equal(Object.hasOwn(prepareMaterial(parsePrepare(prepare)).admission, "execution"), false);
  assert.match(prepareMaterial(parsePrepare(prepare)).prompt, /checks actually run/);
  assert.equal(prepareMaterial(parsePrepare(prepare)).kind, "material-preparation");
  assert.equal(Object.hasOwn(prepareMaterial(parsePrepare(prepare)), "execution"), false);
  for (const bad of [
    { ...prepare, cwd: "/host" }, { ...prepare, execution: { model: "fake" } },
    { ...prepare, targets: [prepare.targets[0], prepare.targets[0]] },
    { ...prepare, targets: [{ name: "agent", moduleId: null, expectedActiveHash: null }] },
    { ...prepare, targets: [{ name: "fixture", moduleId: "id", expectedActiveHash: null }] },
  ]) assert.throws(() => parsePrepare(bad), AuthorError);
  assert.throws(() => parseReceipt({ receiptId: "r", admissionId: "a", requestKey: "k" }), AuthorError);
  assert.throws(() => parseReceipt({ latest: true }), AuthorError);
  assert.throws(() => parseSubmit({ ...submission, root: "/host" }), AuthorError);
  assert.throws(() => parseSubmit({ ...submission, items: [{ ...submission.items[0], dir: "../elsewhere" }] }), AuthorError);
  await files.write("sources/work/module.json", manifestText);
  await files.write("sources/work/index.ts", "export const fixture = true;\n");
  await files.write("sources/work/lib/note.txt", "quote: \"\\\n😀".repeat(300));
  const part = await files.read("sources/work/lib/note.txt", 0, 1000);
  assert.equal(part.nextOffset, 1000); assert.equal(part.eof, false);
  assert.ok(Buffer.byteLength(JSON.stringify(part)) <= SOURCE_LIMITS.outputBytes);
  let combined = part.content, cursor = part;
  while (!cursor.eof) { cursor = await files.read("sources/work/lib/note.txt", cursor.nextOffset); combined += cursor.content; }
  assert.equal(combined, "quote: \"\\\n😀".repeat(300));
  assert.equal((await files.list("sources/work")).entries.length, 3);
  for (const path of ["/etc/passwd", "../outside", "sources/work/../../outside", "sources/work/./x", "sources/work//x", "sources/work/x\\y", "sources/work/.git/config", "sources/work/x\0y", "packages/release/source/index.ts", "sources/work/node_modules/x", "sources/work/a:b"]) {
    await assert.rejects(files.write(path, "escape"), AuthorError);
  }
  await assert.rejects(files.write("sources/work/large.ts", "x".repeat(SOURCE_LIMITS.fileBytes + 1)), { code: "too_large" });
  await writeFile(join(content, "sources/work/large.ts"), "x".repeat(SOURCE_LIMITS.fileBytes + 1));
  await assert.rejects(files.read("sources/work/large.ts"), { code: "too_large" });
  await assert.rejects(files.snapshot("sources/work"), { code: "too_large" });
  await rm(join(content, "sources/work/large.ts"));
  await writeFile(join(outside, "keep"), "unchanged");
  await symlink(join(outside, "keep"), join(content, "sources/work/link"));
  await assert.rejects(files.read("sources/work/link"), AuthorError);
  await assert.rejects(files.write("sources/work/link", "overwritten"), AuthorError);
  await assert.rejects(files.snapshot("sources/work"), AuthorError);
  await assert.rejects(files.list("sources/work"), AuthorError);
  await rm(join(content, "sources/work/link"));
  await symlink(outside, join(content, "sources/work/directory-link"));
  await assert.rejects(files.write("sources/work/directory-link/keep", "overwritten"), AuthorError);
  await assert.rejects(files.read("sources/work/directory-link/keep"), AuthorError);
  await rm(join(content, "sources/work/directory-link"));
  await link(join(outside, "keep"), join(content, "sources/work/hard"));
  await assert.rejects(files.write("sources/work/hard", "overwritten"), { code: "unsafe_source" });
  await assert.rejects(files.read("sources/work/hard"), { code: "unsafe_source" });
  await rm(join(content, "sources/work/hard"));
  assert.equal(await readFile(join(outside, "keep"), "utf8"), "unchanged");
  await symlink(content, join(root, "alias"));
  await assert.rejects(createSourceFiles(join(root, "alias")).read("sources/work/index.ts"), { code: "unsafe_source" });

  await files.write("sources/work/module.json", JSON.stringify({ name: "other", entry: "index.ts" }));
  await assert.rejects(stagePackage(files, parseStage(stage)), /manifest name/);
  await assert.rejects(readFile(join(content, "packages/release/provenance.json")), { code: "ENOENT" });
  await files.write("sources/work/module.json", JSON.stringify({ name: "fixture", entry: "missing.ts" }));
  await assert.rejects(stagePackage(files, parseStage(stage)), /entry/);
  await files.write("sources/work/module.json", manifestText);
  await symlink(outside, join(content, "packages"));
  await assert.rejects(stagePackage(files, parseStage(stage)), AuthorError);
  await rm(join(content, "packages"));
  const staged = await stagePackage(files, parseStage(stage));
  assert.equal(staged.dir, "packages/release/source"); assert.equal(staged.files, 3);
  assert.equal(await readFile(join(content, staged.dir, "module.json"), "utf8"), manifestText);
  const metadata = JSON.parse(await readFile(join(content, staged.metadata), "utf8"));
  assert.equal(metadata.provenanceAuthority, "caller-declared");
  assert.equal(metadata.materialDigest, staged.materialDigest);
  assert.deepEqual(metadata.provenance, stage.provenance);
  const oldSource = await open(join(content, "sources/work/index.ts"), "r");
  try {
    await files.write("sources/work/index.ts", "changed after staging");
    assert.equal(await oldSource.readFile("utf8"), "export const fixture = true;\n", "write replaces the old inode rather than truncating it");
  } finally { await oldSource.close(); }
  assert.equal(await readFile(join(content, staged.dir, "index.ts"), "utf8"), "export const fixture = true;\n");
  await assert.rejects(stagePackage(files, parseStage(stage)), AuthorError);
  assert.notEqual(packageMaterial("fixture", await files.snapshot("sources/work"), parseStage(stage).provenance).metadata.materialDigest, metadata.materialDigest);
  const aggregate = [{ path: "module.json", bytes: Buffer.from(manifestText) }, { path: "index.ts", bytes: Buffer.from("x") }, ...Array.from({ length: 17 }, (_, i) => ({ path: `f${i}.ts`, bytes: Buffer.alloc(SOURCE_LIMITS.fileBytes) }))];
  assert.throws(() => packageMaterial("fixture", aggregate, parseStage(stage).provenance), { code: "too_large" });
  assert.throws(() => packageMaterial("fixture", [{ path: "module.json", bytes: Buffer.from(manifestText) }], parseStage(stage).provenance), /entry/);
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.ts`, bytes: Buffer.from("x") }));
  assert.throws(() => packageMaterial("fixture", tooMany, parseStage(stage).provenance), { code: "too_large" });
  const currentMaterial = await files.snapshot("sources/work");
  assert.equal(packageMaterial("fixture", [...currentMaterial].reverse(), parseStage(stage).provenance).metadata.materialDigest, packageMaterial("fixture", currentMaterial, parseStage(stage).provenance).metadata.materialDigest);
  for (let i = 0; i < 17; i++) await files.write(`sources/oversize/f${i}.ts`, "x".repeat(SOURCE_LIMITS.fileBytes));
  await assert.rejects(files.snapshot("sources/oversize"), { code: "too_large" });
  for (let i = 0; i < 201; i++) await files.write(`sources/many/f${i}.ts`, "x");
  await assert.rejects(files.list("sources/many"), { code: "too_large" });
  await assert.rejects(files.snapshot("sources/many"), { code: "too_large" });

  const deepEntry = `${Array.from({ length: 13 }, (_, i) => `d${i}`).join("/")}/index.ts`;
  await files.write("sources/deep/module.json", JSON.stringify({ name: "fixture", entry: deepEntry }));
  await files.write(`sources/deep/${deepEntry}`, "export const deep = true;");
  const deep = await stagePackage(files, parseStage({ ...stage, from: "sources/deep", to: "packages/deep" }));
  assert.equal(await readFile(join(content, deep.dir, deepEntry), "utf8"), "export const deep = true;");
  assert.ok((await files.list("packages")).entries.some(entry => entry.name === "deep"), "portable nested source paths survive staging");

  const upstreamError = Object.assign(new Error("lost receipt"), { code: "unknown" });
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const context: AuthorContext = { files, async call(target, args) { calls.push({ target, args }); throw upstreamError; } };
  await assert.rejects(authorTool(context, "submit", input(submission), owner), error => error === upstreamError);
  assert.deepEqual(calls, [{ target: "modules.submit", args: submission }]);
  await assert.rejects(authorTool(context, "submit", input(submission), provider), { code: "forbidden" });
  await assert.rejects(authorTool(context, "write", { path: "sources/work/new.ts", content: "x" }, undefined), { code: "forbidden" });
  assert.equal(calls.length, 1, "unknown delivery never retries");
} finally { await rm(root, { recursive: true, force: true }); }

// Real SDK protocol, fake kernel, own temporary content only. No model, network or live database.
const receipt = { receiptId: "receipt-1", admissionId: "admission-1", requestKey: "material-1", state: "unknown", stopConfirmed: false, future: { retain: true }, error: { code: "unknown", message: "Delivery uncertain" } };
const sourceResult = { moduleId: "fixture-id", hash: version, ref: "immutable:fixture", materialDigest };
const runtime = await startModule("index.ts", { stubs: {
  "modules.source": async (args: Record<string, unknown>) => {
    assert.deepEqual(args, source);
    const files = createSourceFiles(paths.content);
    await files.write("sources/imported/module.json", manifestText);
    await files.write("sources/imported/index.ts", "export const imported = true;\n");
    return sourceResult;
  },
  "modules.submit": (args: Record<string, unknown>) => { assert.deepEqual(args, submission); return receipt; },
  "modules.candidate-check": (args: Record<string, unknown>) => {
    assert.ok(JSON.stringify(args) === JSON.stringify({ receiptId: receipt.receiptId }) || JSON.stringify(args) === JSON.stringify({ admissionId: submission.admissionId, requestKey: submission.requestKey }));
    return receipt;
  },
} });
const now = "2026-11-08T00:00:00Z";
async function tool(id: string, args: Record<string, unknown>, caller: typeof owner | typeof provider | { kind: "module"; module: string; moduleId: string; hash: string } = owner) {
  return runtime.send({ trigger: { kind: "tool", id, firedAt: now, args, caller }, now, params: {} });
}
const outputExamples: { tool: string; output: unknown }[] = [];
async function result(id: string, args: Record<string, unknown>, caller: Parameters<typeof tool>[2] = owner) {
  const reply = await tool(id, args, caller);
  assert.equal(reply.error, undefined);
  outputExamples.push({ tool: id, output: reply.result!.result });
  return reply.result!.result;
}
try {
  assert.deepEqual(await result("list", { path: "" }, provider), { path: "", entries: [] });
  assert.deepEqual(await result("list", { path: "." }, provider), { path: "", entries: [] });
  assert.equal((await tool("list", { path: "sources" }, provider)).errorCode, "not_found");
  const entry = { kind: "module" as const, module: "web", moduleId: "web-id", hash: version };
  const draft = await result("prepare", input(prepare), entry);
  assert.deepEqual(draft, prepareMaterial(parsePrepare(prepare)));
  assert.deepEqual(await result("prepare", input(prepare), entry), draft, "preparation is repeatable without effects");
  assert.deepEqual(runtime.calls, [], "prepare never calls discovery, owner admission or Agent");
  assert.deepEqual(await result("list", { path: "" }, provider), { path: "", entries: [] }, "prepare never writes source material");
  assert.ok((await tool("prepare", input(prepare), provider)).error);
  assert.ok((await tool("stage", input(stage), provider)).error);
  assert.ok((await tool("submit", input(submission), provider)).error);
  assert.ok((await tool("receipt", input({ receiptId: receipt.receiptId }), provider)).error);
  assert.ok((await tool("source", input(source), provider)).error);
  assert.ok((await tool("import", {}, provider)).error);
  assert.ok((await tool("export", {}, provider)).error);
  const workspace = await mkdtemp(join(tmpdir(), "author-sdk-workspace-"));
  try {
    const binary = Buffer.from([0, 255, 128, 42]);
    await writeFile(join(workspace, "module.json"), manifestText);
    await writeFile(join(workspace, "index.ts"), "export const fixture = true;\n");
    await writeFile(join(workspace, "payload.bin"), binary);
    await writeFile(join(workspace, ".gitignore"), "payload.bin\n");
    await result("import", input({ from: workspace, to: "sources/binary", source: ["module.json", "index.ts", ".gitignore"], artifacts: [{ path: "payload.bin" }], build: { commands: ["existing build"], toolchain: "existing tools", target: "fixture" } }), entry);
    const binaryStage = await result("stage", input({ ...stage, from: "sources/binary", to: "packages/binary" }), entry) as { dir: string };
    await result("export", input({ path: binaryStage.dir, to: join(workspace, "exported") }), entry);
    assert.deepEqual(await readFile(join(workspace, "exported/payload.bin")), binary);
    assert.ok((await tool("export", input({ path: binaryStage.dir, to: join(workspace, "exported") }), entry)).error);
  } finally { await rm(workspace, { recursive: true, force: true }); }
  assert.deepEqual(await result("source", input(source), entry), sourceResult);
  assert.equal((await result("read", { path: "sources/imported/index.ts" }, provider) as { content: string }).content, "export const imported = true;\n");
  await result("write", { path: "sources/work/module.json", content: manifestText }, provider);
  await result("write", { path: "sources/work/index.ts", content: "export const fixture = true;\n" }, provider);
  assert.ok((await tool("write", { path: "../escape", content: "no" }, provider)).error);
  assert.ok((await tool("write", { path: "sources/work/huge", content: "x".repeat(65537) }, provider)).error);
  assert.equal((await result("list", { path: "sources/work" }, provider) as { entries: unknown[] }).entries.length, 2);
  const staged = await result("stage", input(stage)) as { dir: string };
  assert.equal(staged.dir, submission.items[0].dir);
  assert.deepEqual(await result("submit", input(submission), entry), receipt);
  // Replay must still reach kernel even if local staged files changed or disappeared.
  await rm(join(paths.content, staged.dir), { recursive: true });
  assert.deepEqual(await result("submit", input(submission)), receipt);
  assert.deepEqual(await result("receipt", input({ receiptId: receipt.receiptId }), entry), receipt);
  assert.deepEqual(await result("receipt", input({ admissionId: submission.admissionId, requestKey: submission.requestKey })), receipt);
  await result("write", { path: "sources/from-agent/note.txt", content: "current Agent material" }, entry);
  assert.equal((await result("read", { path: "sources/from-agent/note.txt" }, entry) as { content: string }).content, "current Agent material", "current Agent-selected file tools accept the originating owner-entry module identity");
  const targets = runtime.calls.map((call: { params: { target?: string } }) => call.params.target);
  assert.deepEqual(targets, ["modules.source", "modules.submit", "modules.submit", "modules.candidate-check", "modules.candidate-check"]);
  assert.ok(!targets.some((target: string) => target.startsWith("agent.") || target.includes("admit") || target.startsWith("secrets.")));
  await writeFile(join(paths.data, "output-examples.json"), JSON.stringify(outputExamples));
  console.log("author: bounded files, distribution, exact forwarding, caller visibility and unknown receipts passed");
} finally { await runtime.stop(); }
