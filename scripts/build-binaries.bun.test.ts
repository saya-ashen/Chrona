import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildBinary, compileArgs, prepareReleaseProcessHelper } from "./build-binaries";
import { buildArtifacts, buildTargets, currentBuildTarget, type BuildTargetName } from "../build/manifest";
import { readElfInterpreter, readElfLibraryPathTags } from "../build/portable-elf";
import { processCapability, spawnSupervised } from "../packages/process/src/index";

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
      cpSync(join(import.meta.dirname, "..", resource.from), destination, { recursive: true });
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

test("fixed module seeds preserve paused source materials and regenerate active application artifacts before release verification", async () => {
  const { cp, mkdtemp, mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { buildArtifacts } = await import("../build/manifest");
  const { buildExecutionContracts } = await import("../build/execution-contracts");
  const { prepareModuleGitRelease } = await import("./module-git-release");
  const { prepareReleaseModules } = await import("./build-binaries");
  const root = await mkdtemp(join(tmpdir(), "chrona-release-generated-seed-"));
  const resourcesRoot = join(root, "resources"), seedDir = join(root, "seeds");
  const previous = process.env.CHRONA_MODULE_GIT_SEEDS;
  try {
    await cp(join(import.meta.dirname, "../resources/module-git/LICENSE"), join(root, "LICENSE"));
    await mkdir(join(root, buildArtifacts.moduleGit.seedDir), { recursive: true });
    await cp(join(import.meta.dirname, "../resources/module-git/THIRD-PARTY-NOTICES.txt"), join(root, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"));
    for (const module of buildArtifacts.moduleGit.modules) {
      const dir = join(resourcesRoot, module.source);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "module.json"), JSON.stringify({ name: module.name, entry: "index.ts", keepAlive: true, effects: [], tests: ["test.ts"] }));
      await writeFile(join(dir, "index.ts"), "// entry\n");
    }
    await buildExecutionContracts(join(resourcesRoot, "external"));
    await cp(join(import.meta.dirname, "../packages/engine/src/modules/steward/external/pi"), join(resourcesRoot, "external/pi"), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", "vendor", ".git"].includes(part)) });
    const { preparePiApplication } = await import("../build/agent-dependencies");
    await preparePiApplication(resourcesRoot);
    const { buildEntryConversations } = await import("../build/entry-conversations");
    await buildEntryConversations(resourcesRoot);
    const lock = await prepareModuleGitRelease({ root, resourcesRoot, seedDir, hostCommit: "a".repeat(40), hostTimestamp: "1735689600" });
    const codingContract = await readFile(join(resourcesRoot, "external/coding/contract.js"), "utf8");
    process.env.CHRONA_MODULE_GIT_SEEDS = seedDir;
    await prepareReleaseModules(resourcesRoot);
    expect(JSON.parse(await readFile(join(resourcesRoot, "module-git/lock.json"), "utf8"))).toEqual(lock);
    expect(lock.modules).toHaveLength(14);
    expect(lock.modules.some(module => module.name === "editor")).toBe(false);
    expect(await Bun.file(join(resourcesRoot, "module-git/editor.bundle")).exists()).toBe(false);
    expect(await Bun.file(join(resourcesRoot, "external/editor/module.json")).exists()).toBe(false);
    expect([...buildArtifacts.pausedModuleResources]).toEqual(["external/remind"]);
    for (const source of buildArtifacts.pausedModuleResources) {
      expect(await Bun.file(join(resourcesRoot, source, "module.json")).exists()).toBe(false);
      // Retained bundles record source provenance, but have no runtime installation tree.
      expect(await Bun.file(join(resourcesRoot, "module-git", `${source.split("/").pop()}.bundle`)).exists()).toBe(true);
    }
    for (const name of ["web", "notify", "qq", "author", "files", "events", "memory-local", "mcp", "mind", "coding", "coding-web", "remote-execution", "pi"]) expect(await Bun.file(join(resourcesRoot, "external", name, "module.json")).exists()).toBe(true);
    const { BUILTIN_MODULE_NAMES, OPTIONAL_EXTERNAL_MODULE_NAMES, PREINSTALLED_MODULE_NAMES } = await import("@chrona/contracts/steward");
    for (const module of [{ name: "mind", source: "external/mind" }, { name: "coding", source: "external/coding" }, { name: "coding-web", source: "external/coding-web" }, { name: "remote-execution", source: "external/remote-execution" }] as const) {
      const { name } = module;
      expect(buildArtifacts.moduleGit.modules).toContainEqual(module);
      expect(lock.modules.find(module => module.name === name)?.bundle).toBe(`${name}.bundle`);
      expect(await Bun.file(join(resourcesRoot, "module-git", `${name}.bundle`)).exists()).toBe(true);
      expect(OPTIONAL_EXTERNAL_MODULE_NAMES).toContain(name);
      expect(PREINSTALLED_MODULE_NAMES).not.toContain(name);
      expect(BUILTIN_MODULE_NAMES).not.toContain(name);
    }
    expect(await readFile(join(resourcesRoot, "external/coding/contract.js"), "utf8")).toBe(codingContract);
    expect(buildArtifacts.moduleGit.modules).toContainEqual({ name: "mcp", source: "external/mcp" });
    expect(lock.modules.find(module => module.name === "mcp")?.bundle).toBe("mcp.bundle");
    expect(await Bun.file(join(resourcesRoot, "module-git/mcp.bundle")).exists()).toBe(true);
    expect(buildArtifacts.moduleGit.modules).toContainEqual({ name: "author", source: "external/author" });
    expect(lock.modules.find(module => module.name === "author")?.bundle).toBe("author.bundle");
    expect(await Bun.file(join(resourcesRoot, "module-git/author.bundle")).exists()).toBe(true);
    expect(await Bun.file(join(resourcesRoot, "builtin/agent/module.json")).exists()).toBe(false);
    expect(lock.modules.find(module => module.name === "pi")?.bundle).toBe("pi.bundle");
    expect(await Bun.file(join(resourcesRoot, "module-git/pi.bundle")).exists()).toBe(true);
    expect(await Bun.file(join(resourcesRoot, "external/pi/vendor/zod/package.json")).exists()).toBe(true);
    expect(await readFile(join(resourcesRoot, "external/web/LICENSE"), "utf8")).toBe(await readFile(join(root, "LICENSE"), "utf8"));
  } finally {
    if (previous === undefined) delete process.env.CHRONA_MODULE_GIT_SEEDS;
    else process.env.CHRONA_MODULE_GIT_SEEDS = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("release manifest requires external modules and has no builtin packaging input", () => {
  expect(buildArtifacts.resources.some(resource => resource.to === "resources/external" && resource.required)).toBe(true);
  expect(buildArtifacts.resources.some(resource => String(resource.to).startsWith("resources/builtin"))).toBe(false);
  expect(buildArtifacts.moduleGit.modules).toContainEqual({ name: "pi", source: "external/pi" });
  expect(buildArtifacts.moduleGit.modules.some(module => String(module.name) === "agent")).toBe(false);
});
