import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createScriptSandbox } from "../../packages/host/src/runtime/script-sandbox";
import { createModuleChannel } from "../../packages/kernel/src/modules/module-channel";
import { createSourceFiles } from "../../.generated/applications/author/files";
import { parseImport } from "../../.generated/applications/author/material";
import { moduleManifestSchema } from "../../packages/contracts/src/steward";

test("ordinary desktop app lifecycle and supervised descendant cleanup", async () => {
  const task = Bun.spawn([process.execPath, "--no-install", "run", "check.ts"], { cwd: import.meta.dirname, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([task.exited, new Response(task.stdout).text(), new Response(task.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("guardian descendant-empty proof");
}, 15_000);

test("packaged entry starts through the real host adapter without inherited SDK variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-desktop-host-"));
  const channel = await createModuleChannel({ onCall: async call => ({ id: call.id, result: { output: null } }) });
  const sandbox = createScriptSandbox({ processHelper: process.env.CHRONA_PROCESS_HELPER ?? resolve(import.meta.dirname, "../../packages/process/bin/linux-x64/chrona-process-guardian") });
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await mkdir(join(root, "data")); await mkdir(join(root, "content"));
    const manifest = moduleManifestSchema.parse(await Bun.file(join(import.meta.dirname, "module.json")).json());
    handle = sandbox.startModule({ codeDir: import.meta.dirname, dataDir: join(root, "data"), contentDir: join(root, "content"), entry: manifest.entry, ipcEndpoint: channel.endpoint, ipcToken: channel.token });
    const now = new Date().toISOString();
    const reply = await channel.send({ trigger: { kind: "tool", id: "status", args: {}, firedAt: now }, now, params: {} }, 3000);
    expect(reply).toMatchObject({ result: { result: { module: "ready", window: "closed", pid: null } } });
    handle.kill(); await handle.exited;
    expect(await handle.stopEvidence).toMatchObject({ state: "stopped", scope: "descendants", treeClean: true });
  } finally {
    handle?.kill(); await handle?.exited; await channel.close(); await rm(root, { recursive: true, force: true });
  }
}, 10_000);

test("actual desktop material round-trips through Author and rebuilds from exported source", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-desktop-material-"));
  try {
    const content = join(root, "content"); await mkdir(content);
    const selection = parseImport(await Bun.file(join(import.meta.dirname, "dist/author-import.json")).json());
    const files = createSourceFiles(content);
    const imported = await files.import(selection);
    const exported = join(root, "exported");
    expect((await files.export(imported.path, exported)).materialDigest).toBe(imported.materialDigest);
    const before = await Bun.file(join(exported, "chrona-material.json")).json();
    const config = await Bun.file(join(exported, "dist/backend.json")).json();
    const task = Bun.spawn([process.execPath, "--no-install", "run", "build.ts"], {
      cwd: exported, env: { ...process.env, CHRONA_DEMO_GTK_LIBRARY: config.gtkLibrary }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([task.exited, new Response(task.stderr).text(), new Response(task.stdout).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect((await Bun.file(join(exported, "chrona-material.json")).json()).artifacts).toEqual(before.artifacts);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10_000);
