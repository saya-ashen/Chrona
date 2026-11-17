import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Installer fixtures record argv while the compiled host uses real native supervision.
test.skipIf(process.platform !== "linux")("compiled dependency installers use the host helper from an unrelated cwd", async () => {
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
    const integration = join(source, "packages/host/src");
    const entry = join(root, "fixture.ts"), executable = join(root, "compiled-fixture");
    await writeFile(entry, `import { createModulePackages } from ${JSON.stringify(join(integration, "packages/module-packages.ts"))};
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const [helper] = process.argv.slice(2);
const dir = process.cwd();
await writeFile(join(dir, "package.json"), "{}");
await writeFile(join(dir, "bun.lock"), "{}");
await writeFile(join(dir, "pyproject.toml"), "[project]\\n");
await writeFile(join(dir, "uv.lock"), "version = 1\\n");
const installed = await createModulePackages({ processHelper: helper }).install({ dir, packages: [] });
console.log(JSON.stringify({ installed }));
`);
    const compiled = Bun.spawn([process.execPath, "build", "--compile", entry, "--outfile", executable], { cwd: source, stdout: "pipe", stderr: "pipe" });
    const [compileCode, compileError] = await Promise.all([compiled.exited, new Response(compiled.stderr).text(), new Response(compiled.stdout).text()]);
    expect(compileCode, compileError).toBe(0);
    const run = Bun.spawn([executable, helper], {
      cwd, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, CHRONA_PROCESS_HELPER: join(root, "missing-ambient-guardian"), CHRONA_HELPER_TEST_SECRET: "must-not-reach-child" },
    });
    const [code, stdout, stderr] = await Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result.installed).toEqual({ errors: [], installed: { npm: true, python: true, packages: {} } });
    const installs = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(installs).toEqual([
      { name: "bun", argv: ["install", "--frozen-lockfile", "--ignore-scripts", "--no-progress", "--backend=copyfile"], cwd, secret: null, helper: null, loader: null },
      { name: "uv", argv: ["sync", "--frozen", "--python", join(bin, "python3"), "--no-python-downloads"], cwd, secret: null, helper: null, loader: null },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
