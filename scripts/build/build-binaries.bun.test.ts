import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildBinary, compileArgs, prepareReleaseProcessHelper } from "./build-binaries";
import { buildArtifacts, buildTargets, currentBuildTarget, type BuildTargetName } from "./manifest";
import { readElfInterpreter, readElfLibraryPathTags } from "./portable-elf";
import { processCapability, spawnSupervised } from "../../packages/process/src/index";

test("every release target pins production compilation independently of parent test environment", () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const target of Object.keys(buildTargets) as BuildTargetName[]) {
      const configurations = ["test", "production"].map(environment => {
        process.env.NODE_ENV = environment;
        const args = compileArgs(target, "/tmp/chrona-release-compile-test/chrona");
        expect(process.env.NODE_ENV).toBe(environment);
        expect(args.filter(arg => arg.startsWith("--define=process.env.NODE_ENV="))).toEqual(['--define=process.env.NODE_ENV="production"']);
        expect(args).toContain('--define=process.env.BUN_ENV="production"');
        expect(args).toContain(`--target=${buildTargets[target].bunTarget}`);
        return args;
      });
      expect(configurations[0]).toEqual(configurations[1]);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});


test("release defines compile the runtime test guard off under test and production parents", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-release-compile-test-"));
  const entry = join(root, "guard.ts");
  writeFileSync(entry, 'console.log(JSON.stringify([process.env.NODE_ENV,process.env.BUN_ENV,process.env.NODE_ENV==="test"||process.env.BUN_ENV==="test"]));');
  try {
    const define = Object.fromEntries(compileArgs("linux-x64", join(root, "chrona")).filter(arg => arg.startsWith("--define=")).map(arg => {
      const pair = arg.slice("--define=".length), separator = pair.indexOf("=");
      return [pair.slice(0, separator), pair.slice(separator + 1)];
    }));
    const result = await Bun.build({ entrypoints: [entry], outdir: root, target: "bun", define });
    expect(result.success).toBe(true);
    for (const environment of ["test", "production"]) {
      const child = Bun.spawn([process.execPath, join(root, "guard.js")], { env: { ...process.env, NODE_ENV: environment, BUN_ENV: environment }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(["production", "production", false]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("release rejects a foreign target before building native resources", async () => {
  const foreign = (Object.keys(buildTargets) as BuildTargetName[]).find(target => target !== currentBuildTarget())!;
  await expect(buildBinary(foreign)).rejects.toThrow("matching runner");
});

test("manifest stages an independent SDK with process supervision and a static loader", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-release-sdk-"));
  try {
    for (const resource of buildArtifacts.resources.filter(resource => resource.to.startsWith("resources/module-sdk/"))) {
      const destination = join(root, resource.to);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(import.meta.dirname, "../..", resource.from), destination, { recursive: true });
    }
    const result = await Bun.build({
      entrypoints: ["sdk.ts", "testing.ts", "preview.ts", "process.ts"].map(file => join(root, "resources/module-sdk", file)),
      target: "bun",
    });
    expect(result.success, result.logs.map(String).join("\n")).toBe(true);
    const sdk = join(root, "resources/module-sdk");
    const probe = join(root, "probe.ts");
    writeFileSync(probe, 'import {processCapability} from "chrona/process"; console.log(JSON.stringify(processCapability({platform:"freebsd"})));');
    const child = Bun.spawn([process.execPath, "--preload", join(sdk, "chrona-sdk-loader.ts"), probe], { cwd: root, env: { ...process.env, CHRONA_SDK: sdk, DATABASE_URL: "invalid:test-sdk-must-not-load" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ available: false, backend: "unsupported" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("release stages a host-native guardian with platform stop evidence and the target ELF interpreter", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-release-process-"));
  try {
    const helperPath = await prepareReleaseProcessHelper(join(root, "resources"));
    expect(helperPath).toBe(join(root, "resources/process", `${process.platform}-${process.arch}`, `chrona-process-guardian${process.platform === "win32" ? ".exe" : ""}`));
    expect(processCapability({ helperPath })).toMatchObject({ available: true, treeClean: false });
    const target = buildTargets[currentBuildTarget()];
    if ("linuxInterpreter" in target) {
      expect(readElfInterpreter(readFileSync(helperPath))).toBe(target.linuxInterpreter);
      expect(readElfLibraryPathTags(readFileSync(helperPath))).toEqual([]);
    }
    // This is the checker's restricted environment: no NIX_LD or library-path overrides.
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
    const task = spawnSupervised(process.execPath, ["-e", "process.exit(7)"], { helperPath, timeoutMs: 5000, env });
    let stderr = "";
    task.process.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    task.process.stdin.end(); task.process.stdout.resume();
    try {
      expect(await task.exited, stderr).toMatchObject({ code: 7, stop: { state: "stopped", treeClean: process.platform === "linux" || process.platform === "win32" } });
    } finally { task.stop(); await task.exited; }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15_000);

test("release manifest stages only kernel database, SDK and runtime resources", () => {
  expect(buildArtifacts.resources.every(resource => /^(packages\/(db|app-sdk|host)\/|node_modules\/|\.env\.example$)/.test(resource.from))).toBe(true);
  expect(buildArtifacts.resources.every(resource => /^resources\/(prisma\/|module-sdk\/|module-typecheck\/|runtimes\.json$|\.env\.example$)/.test(resource.to))).toBe(true);
});
