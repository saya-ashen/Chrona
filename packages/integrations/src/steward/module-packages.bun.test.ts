import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModulePackages } from "./module-packages";
import { createScriptSandbox } from "./script-sandbox";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "chrona-packages-")), dir = join(root, "platform", "store", "v1");
  await mkdir(dir, { recursive: true });
  return { root, dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("npm libraries install only from bun.lock, without install scripts, and modules import them", async () => {
  const w = await workspace();
  try {
    // A local file dependency keeps the test offline; its postinstall must never run.
    await mkdir(join(w.root, "dep"));
    await writeFile(join(w.root, "dep", "package.json"), JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js", scripts: { postinstall: "touch ../postinstall-ran" } }));
    await writeFile(join(w.root, "dep", "index.js"), "module.exports = { answer: 42 };");
    await writeFile(join(w.dir, "package.json"), JSON.stringify({ name: "m", dependencies: { dep: `file:${join(w.root, "dep")}` } }));
    const packages = createModulePackages({ backend: "system" });
    expect((await packages.install({ dir: w.dir, packages: [], gcroot: join(w.root, "gc") })).errors[0]).toContain("bun.lock");
    expect(Bun.spawnSync(["bun", "install", "--ignore-scripts"], { cwd: w.dir }).exitCode).toBe(0);
    await rm(join(w.dir, "node_modules"), { recursive: true });
    const result = await packages.install({ dir: w.dir, packages: [], gcroot: join(w.root, "gc") });
    expect(result).toEqual({ errors: [], installed: { npm: true, python: false, packages: {} } });
    expect(existsSync(join(w.root, "postinstall-ran"))).toBe(false);
    await writeFile(join(w.dir, "test.ts"), 'import dep from "dep"; console.log(dep.answer);');
    const data = join(w.root, "data"); await mkdir(data);
    expect(await createScriptSandbox({ dataDir: w.root }).runModule({ codeDir: w.dir, dataDir: data, entry: "test.ts", input: {} })).toMatchObject({ status: "succeeded", output: "42\n" });
  } finally { await w.cleanup(); }
}, 60_000);

test.skipIf(!Bun.which("uv"))("Python modules run in the environment uv synced from uv.lock", async () => {
  const w = await workspace();
  try {
    await writeFile(join(w.dir, "pyproject.toml"), '[project]\nname = "m"\nversion = "0.1.0"\nrequires-python = ">=3.8"\ndependencies = []\n');
    expect(Bun.spawnSync(["uv", "lock", "--offline", "--python", Bun.which("python3")!], { cwd: w.dir }).exitCode).toBe(0);
    const result = await createModulePackages({ backend: "system" }).install({ dir: w.dir, packages: [], gcroot: join(w.root, "gc") });
    expect(result.errors).toEqual([]);
    await writeFile(join(w.dir, "test.py"), "import sys; print(sys.prefix.endswith('.venv'))");
    const data = join(w.root, "data"); await mkdir(data);
    expect(await createScriptSandbox({ dataDir: w.root }).runModule({ codeDir: w.dir, dataDir: data, entry: "test.py", input: {} })).toMatchObject({ status: "succeeded", output: "True\n" });
  } finally { await w.cleanup(); }
}, 60_000);

test("system backend: present programs are recorded, missing ones fail with an install hint", async () => {
  const w = await workspace();
  try {
    const result = await createModulePackages({ backend: "system" }).install({ dir: w.dir, packages: ["sh", "chrona-no-such-program"], gcroot: join(w.root, "gc") });
    expect(result.errors[0]).toContain("Missing system programs: chrona-no-such-program");
    expect(result.installed.packages.sh).toEqual([Bun.which("sh")!]);
    expect(existsSync(join(w.dir, ".chrona"))).toBe(false);
  } finally { await w.cleanup(); }
});

test("recorded store bin directories join the module PATH; other entries are ignored", async () => {
  const w = await workspace();
  try {
    await mkdir(join(w.dir, ".chrona"));
    await writeFile(join(w.dir, ".chrona", "packages.json"), JSON.stringify({ backend: "nix", bin: ["/nix/store/fake-bin", "/etc", "/nix/store/x:/etc"] }));
    await writeFile(join(w.dir, "test.sh"), 'printf "%s" "$PATH"');
    const data = join(w.root, "data"); await mkdir(data);
    const output = (await createScriptSandbox({ dataDir: w.root }).runModule({ codeDir: w.dir, dataDir: data, entry: "test.sh", input: {} })).output;
    expect(output.split(":")[0]).toBe("/nix/store/fake-bin");
    expect(output.split(":")).not.toContain("/etc");
  } finally { await w.cleanup(); }
});
