import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the compiled import.meta.url case with real native supervision and the
// actual TypeScript checker. Installer fixtures only record argv; no packages install.
test.skipIf(process.platform !== "linux")("compiled module checks and both installers use the host helper from an unrelated cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-packaged-helper-"));
  try {
    const source = resolve(import.meta.dirname, "../../../.."), host = join(root, "host resources"), bin = join(root, "bin"), cwd = join(root, "unrelated cwd");
    await Promise.all([mkdir(host), mkdir(bin), mkdir(cwd)]);
    const helper = join(host, "guardian");
    await copyFile(join(source, `packages/process/bin/${process.platform}-${process.arch}/chrona-process-guardian`), helper);
    await chmod(helper, 0o755);
    const log = join(root, "installer.jsonl");
    for (const name of ["bun", "uv"]) {
      const executable = join(bin, name);
      await writeFile(executable, `#!${process.execPath}
import { appendFileSync } from "node:fs";
if (process.argv[2] === "--no-install") {
  const child = Bun.spawn([${JSON.stringify(process.execPath)}, ...process.argv.slice(2)], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: ${JSON.stringify(name)}, argv: process.argv.slice(2), cwd: process.cwd(), secret: process.env.CHRONA_HELPER_TEST_SECRET ?? null, helper: process.env.CHRONA_PROCESS_HELPER ?? null, loader: process.env.NIX_LD ?? null }) + "\\n");
`);
      await chmod(executable, 0o755);
    }
    await symlink(process.execPath, join(bin, "python3"));
    const integration = join(source, "packages/host/src"), engine = join(source, "packages/kernel/src");
    const entry = join(root, "fixture.ts"), executable = join(root, "compiled-fixture");
    await writeFile(entry, `import { createModulePackages } from ${JSON.stringify(join(integration, "packages/module-packages.ts"))};
import { typecheckBuild } from ${JSON.stringify(join(engine, "modules/module-typecheck.ts"))};
import { writeBuildHelpers } from ${JSON.stringify(join(engine, "modules/module-build-helpers.ts"))};
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [helper, sdk, typecheck, registry] = process.argv.slice(2);
const dir = process.cwd();
const db = { module: { findMany: async () => [] } };
const ports = { db, moduleSdk: sdk, moduleTypecheck: typecheck, processHelper: helper, moduleRuntimes: await Bun.file(registry).json() };
const context = { db, ports, workspaceId: "packaged-fixture" };
const manifest = { name: "probe", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [], uses: [] };
await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
await writeFile(join(dir, "index.ts"), "export const value: number = 1;");
const good = await typecheckBuild(context, dir, manifest);
await writeFile(join(dir, "index.ts"), "export const value: number = 'wrong';");
const bad = await typecheckBuild(context, dir, manifest);
const build = join(dir, "build");
await mkdir(build);
await writeBuildHelpers(build, sdk, { calls: {}, typecheck, processHelper: helper, runtimes: ports.moduleRuntimes });
await writeFile(join(dir, "package.json"), "{}");
await writeFile(join(dir, "bun.lock"), "{}");
await writeFile(join(dir, "pyproject.toml"), "[project]\\n");
await writeFile(join(dir, "uv.lock"), "version = 1\\n");
const installed = await createModulePackages({ processHelper: helper }).install({ dir, packages: [] });
console.log(JSON.stringify({ good, bad, installed }));
`);
    const compiled = Bun.spawn([process.execPath, "build", "--compile", entry, "--outfile", executable], { cwd: source, stdout: "pipe", stderr: "pipe" });
    const [compileCode, compileError] = await Promise.all([compiled.exited, new Response(compiled.stderr).text(), new Response(compiled.stdout).text()]);
    expect(compileCode, compileError).toBe(0);
    const run = Bun.spawn([executable, helper, join(source, "packages/app-sdk"), join(source, "packages/app-sdk/typecheck"), join(integration, "runtimes.json")], {
      cwd, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, CHRONA_PROCESS_HELPER: join(root, "missing-ambient-guardian"), CHRONA_HELPER_TEST_SECRET: "must-not-reach-child" },
    });
    const [code, stdout, stderr] = await Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result.good).toEqual({ status: "passed" });
    expect(result.bad.status).toBe("failed");
    expect(result.bad.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2322 })]));
    expect(result.installed).toEqual({ errors: [], installed: { npm: true, python: true, packages: {} } });
    expect(await Bun.file(join(cwd, "build/node_modules/chrona/calls.json")).json()).toEqual({});
    const installs = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(installs).toEqual([
      { name: "bun", argv: ["install", "--frozen-lockfile", "--ignore-scripts", "--no-progress", "--backend=copyfile"], cwd, secret: null, helper: null, loader: null },
      { name: "uv", argv: ["sync", "--frozen", "--python", join(bin, "python3"), "--no-python-downloads"], cwd, secret: null, helper: null, loader: null },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
