import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModulePackages } from "./module-packages";

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
    await writeFile(join(w.root, "dep", "package.json"), JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js", scripts: { postinstall: "bun postinstall.cjs" } }));
    await writeFile(join(w.root, "dep", "postinstall.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(join(w.root, "postinstall-ran"))}, "ran");`);
    await writeFile(join(w.root, "dep", "index.js"), "module.exports = { answer: 42 };");
    await writeFile(join(w.dir, "package.json"), JSON.stringify({ name: "m", dependencies: { dep: `file:${join(w.root, "dep")}` } }));
    const packages = createModulePackages();
    expect((await packages.install({ dir: w.dir, packages: [] })).errors[0]).toContain("bun.lock");
    expect(Bun.spawnSync([process.execPath, "install", "--ignore-scripts"], { cwd: w.dir }).exitCode).toBe(0);
    await rm(join(w.dir, "node_modules"), { recursive: true });
    const result = await packages.install({ dir: w.dir, packages: [] });
    expect(result).toEqual({ errors: [], installed: { npm: true, python: false, packages: {} } });
    expect(existsSync(join(w.root, "postinstall-ran"))).toBe(false);
    await writeFile(join(w.dir, "test.ts"), 'import dep from "dep"; console.log(dep.answer);');
    const run = Bun.spawnSync([process.execPath, "test.ts"], { cwd: w.dir });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe("42\n");
    const lock = await readFile(join(w.dir, "bun.lock"), "utf8");
    await writeFile(join(w.dir, "package.json"), JSON.stringify({ name: "m", dependencies: { dep: `file:${join(w.root, "dep")}`, second: `file:${join(w.root, "dep")}` } }));
    const mismatch = await packages.install({ dir: w.dir, packages: [] });
    expect(mismatch.installed.npm).toBe(false);
    expect(mismatch.errors).toHaveLength(1);
    expect(mismatch.errors[0]).toContain("bun install --frozen-lockfile failed (lockfile mismatch):");
    expect(await readFile(join(w.dir, "bun.lock"), "utf8")).toBe(lock);
    expect(existsSync(join(w.root, "postinstall-ran"))).toBe(false);
  } finally { await w.cleanup(); }
}, 60_000);

test.skipIf(!Bun.which("uv") || !(Bun.which("python3") ?? Bun.which("python")))("Python modules run in the environment uv synced from uv.lock", async () => {
  const w = await workspace();
  try {
    await writeFile(join(w.dir, "pyproject.toml"), '[project]\nname = "m"\nversion = "0.1.0"\nrequires-python = ">=3.8"\ndependencies = []\n');
    expect(Bun.spawnSync(["uv", "lock", "--offline", "--python", (Bun.which("python3") ?? Bun.which("python"))!, "--no-python-downloads"], { cwd: w.dir }).exitCode).toBe(0);
    const result = await createModulePackages().install({ dir: w.dir, packages: [] });
    expect(result.errors).toEqual([]);
    await writeFile(join(w.dir, "test.py"), "import sys; print(sys.prefix.endswith('.venv'))");
    expect(result.installed.python).toBe(true);
    const interpreter = join(w.dir, ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
    const run = Bun.spawnSync([interpreter, "test.py"], { cwd: w.dir });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe("True");
  } finally { await w.cleanup(); }
}, 60_000);

test("host dependencies: present programs are recorded, missing ones fail with an install hint", async () => {
  const w = await workspace();
  try {
    const result = await createModulePackages().install({ dir: w.dir, packages: ["bun", "chrona-no-such-program"] });
    expect(result.errors[0]).toContain("Missing system programs: chrona-no-such-program");
    expect(result.installed.packages.bun).toEqual([Bun.which("bun")!]);
    expect(existsSync(join(w.dir, ".chrona"))).toBe(false);
  } finally { await w.cleanup(); }
});

test("empty modules and missing lockfiles never probe host programs", async () => {
  const w = await workspace(), which = spyOn(Bun, "which");
  try {
    const packages = createModulePackages();
    expect(which).not.toHaveBeenCalled();
    expect(await packages.install({ dir: w.dir, packages: [] })).toEqual({ errors: [], installed: { npm: false, python: false, packages: {} } });
    expect(which).not.toHaveBeenCalled();
    await writeFile(join(w.dir, "package.json"), "{}");
    await writeFile(join(w.dir, "pyproject.toml"), "[project]\n");
    const result = await packages.install({ dir: w.dir, packages: [] });
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("bun.lock");
    expect(result.errors[1]).toContain("uv.lock");
    expect(which).not.toHaveBeenCalled();
    expect(existsSync(join(w.dir, ".chrona"))).toBe(false);
  } finally { which.mockRestore(); await w.cleanup(); }
});

test("tools are resolved at install time, only as needed, without Nix or package manager probes", async () => {
  const w = await workspace(), which = spyOn(Bun, "which").mockReturnValue(null);
  try {
    const packages = createModulePackages();
    await writeFile(join(w.dir, "package.json"), "{}");
    await writeFile(join(w.dir, "bun.lock"), "{}");
    expect((await packages.install({ dir: w.dir, packages: [] })).errors).toEqual(["bun is not available on this host"]);
    expect(which.mock.calls).toEqual([["bun"]]);
    which.mockClear();
    await rm(join(w.dir, "package.json"));
    await writeFile(join(w.dir, "pyproject.toml"), "[project]\n");
    await writeFile(join(w.dir, "uv.lock"), "version = 1\n");
    expect((await packages.install({ dir: w.dir, packages: [] })).errors).toEqual(["uv is not available on this host"]);
    expect(which.mock.calls).toEqual([["uv"]]);
    which.mockClear();
    which.mockImplementation(name => name === "uv" ? process.execPath : null);
    expect((await packages.install({ dir: w.dir, packages: ["missing-program", "missing-program"] })).errors).toEqual([
      "python3 or python is not available on this host",
      "Missing system programs: missing-program. Ask the user to install them on the host, then submit the module again.",
    ]);
    expect(which.mock.calls).toEqual([["uv"], ["python3"], ["python"], ["missing-program"]]);
  } finally { which.mockRestore(); await w.cleanup(); }
});

for (const installer of ["bun", "uv"] as const) {
  test.skipIf(process.platform !== "linux").each([
    { output: "error: lockfile had changes, but lockfile is frozen", cause: "lockfile mismatch" },
    { output: "Network connectivity is disabled, but the requested package wasn't found in the cache", cause: "offline dependency unavailable in cache" },
    { output: "error: package not found in the package cache (offline mode)", cause: "offline dependency unavailable in cache" },
    { output: "error: registry request failed: connection refused", cause: null },
    { output: "error: cache miss while downloading package", cause: null },
    { output: "error: offline mode: permission denied reading lockfile", cause: null },
  ])(`${installer} reports precise evidenced install failures: %p`, async ({ output, cause }) => {
    const w = await workspace(), executable = join(w.root, "installer"), record = join(w.dir, "invocation.json");
    const which = spyOn(Bun, "which").mockImplementation(name => name === installer ? executable : process.execPath);
    const key = "CHRONA_DEPENDENCY_TEST_TOKEN", previous = process.env[key];
    process.env[key] = "synthetic-private-dependency-token";
    try {
      for (const file of installer === "bun" ? ["package.json", "bun.lock"] : ["pyproject.toml", "uv.lock"]) await writeFile(join(w.dir, file), "");
      await writeFile(executable, `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), secret: process.env.${key} ?? null }));
console.error(${JSON.stringify(output)});
process.exit(1);
`);
      await chmod(executable, 0o755);
      const result = await createModulePackages().install({ dir: w.dir, packages: [] });
      const command = installer === "bun" ? "bun install --frozen-lockfile" : "uv sync --frozen";
      expect(result).toEqual({ errors: [`${command} failed${cause ? ` (${cause})` : ""}:\n${output}\n`], installed: { npm: false, python: false, packages: {} } });
      expect(JSON.parse(await readFile(record, "utf8"))).toEqual({ args: installer === "bun" ? ["install", "--frozen-lockfile", "--ignore-scripts", "--no-progress", "--backend=copyfile"] : ["sync", "--frozen", "--python", process.execPath, "--no-python-downloads"], cwd: w.dir, secret: null });
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      which.mockRestore(); await w.cleanup();
    }
  });
  for (const mode of ["exit", "timeout", "unknown"] as const) test.skipIf(process.platform !== "linux")(`${installer} installer ${mode} requires descendant-stop proof`, async () => {
    const w = await workspace(), executable = join(w.root, "installer"), pidFile = join(w.dir, "descendant.pid");
    const which = spyOn(Bun, "which").mockImplementation(name => name === installer ? executable : process.execPath);
    try {
      const files = installer === "bun" ? ["package.json", "bun.lock", ...(mode === "unknown" ? ["pyproject.toml", "uv.lock"] : [])] : ["pyproject.toml", "uv.lock"];
      for (const file of files) await writeFile(join(w.dir, file), "");
      const leaf = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
      await writeFile(executable, `#!${process.execPath}
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (${JSON.stringify(mode)} === "unknown") { process.kill(process.ppid, "SIGKILL"); process.exit(0); }
spawn(process.execPath, ["-e", ${JSON.stringify(leaf)}], { detached: true, stdio: "ignore" });
while (!existsSync(${JSON.stringify(pidFile)})) await Bun.sleep(5);
if (${JSON.stringify(mode)} === "exit") process.exit(0);
setInterval(() => {}, 1000);
`);
      await chmod(executable, 0o755);
      const installing = createModulePackages({ timeoutMs: 700 }).install({ dir: w.dir, packages: ["next-program"] });
      if (mode === "unknown") {
        await expect(installing).rejects.toThrow("Process stop unknown");
        // An unproven npm stop must not proceed to another installer or dependency probing.
        expect(which.mock.calls.map(([name]) => name)).toEqual(installer === "bun" ? ["bun"] : ["uv", "python3"]);
      } else {
        const result = await installing;
        expect(result.installed[installer === "bun" ? "npm" : "python"]).toBe(mode === "exit");
        expect(result.errors.length).toBe(mode === "exit" ? 0 : 1);
        const pid = Number(await readFile(pidFile, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      }
    } finally {
      which.mockRestore();
      const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* Guardian already reaped it. */ }
      await w.cleanup();
    }
  });
}
