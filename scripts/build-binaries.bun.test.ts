import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildBinary, compileArgs, copyResource, prepareReleaseProcessHelper } from "./build-binaries";
import { buildArtifacts, buildTargets, currentBuildTarget, omitPausedRuntimeModules, type BuildTargetName } from "../build/manifest";
import { readElfInterpreter, readElfLibraryPathTags } from "../build/portable-elf";
import { processCapability, spawnSupervised } from "../packages/process/src/index";

test("release resource copy keeps the generated Chat preview local", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-resource-copy-"));
  try {
    const source = join(root, "external"), release = join(root, "release");
    for (const name of ["chat", "other"]) {
      mkdirSync(join(source, name), { recursive: true });
      writeFileSync(join(source, name, "index.ts"), "// application source\n");
      writeFileSync(join(source, name, "browser-fixture.html"), "preview\n");
    }
    await copyResource({ from: source, to: "resources/external", required: true }, release);
    expect(readFileSync(join(release, "resources/external/chat/index.ts"), "utf8")).toBe("// application source\n");
    expect(existsSync(join(release, "resources/external/chat/browser-fixture.html"))).toBe(false);
    expect(existsSync(join(release, "resources/external/other/browser-fixture.html"))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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

test("fixed module seeds package exactly the seven current applications and regenerate active artifacts before release verification", async () => {
  const { cp, mkdtemp, mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { buildArtifacts } = await import("../build/manifest");
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
    await cp(join(import.meta.dirname, "../packages/engine/src/modules/steward/external/pi"), join(resourcesRoot, "external/pi"), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", "vendor", ".git"].includes(part)) });
    const { preparePiApplication } = await import("../build/agent-dependencies");
    await preparePiApplication(resourcesRoot);
    const { buildEntryConversations } = await import("../build/entry-conversations");
    await buildEntryConversations(resourcesRoot);
    const lock = await prepareModuleGitRelease({ root, resourcesRoot, seedDir, hostCommit: "a".repeat(40), hostTimestamp: "1735689600" });
    for (const name of ["coding", "coding-web", "events", "files", "mcp", "memory-local", "remind", "remote-execution", "editor", "unexpected-app"]) {
      const dir = join(resourcesRoot, "external", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "module.json"), JSON.stringify({ name, entry: "index.ts" }));
    }
    process.env.CHRONA_MODULE_GIT_SEEDS = seedDir;
    await prepareReleaseModules(resourcesRoot);
    expect(JSON.parse(await readFile(join(resourcesRoot, "module-git/lock.json"), "utf8"))).toEqual(lock);
    const current = ["author", "chat", "mind", "notify", "pi", "qq", "web"];
    expect(lock.modules.map(module => module.name).sort()).toEqual(current);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(resourcesRoot, "external"))).sort()).toEqual(current);
    expect((await readdir(join(resourcesRoot, "module-git"))).filter(name => name.endsWith(".bundle")).sort()).toEqual(current.map(name => `${name}.bundle`));
    for (const name of current) {
      expect(await Bun.file(join(resourcesRoot, "external", name, "module.json")).exists()).toBe(true);
      expect(lock.modules.find(module => module.name === name)?.bundle).toBe(`${name}.bundle`);
    }
    const { BUILTIN_MODULE_NAMES, OPTIONAL_EXTERNAL_MODULE_NAMES, PREINSTALLED_MODULE_NAMES } = await import("@chrona/contracts/steward");
    expect([...PREINSTALLED_MODULE_NAMES]).toEqual(["pi", "web", "notify", "author", "mind", "chat"]);
    expect(OPTIONAL_EXTERNAL_MODULE_NAMES).toContain("qq");
    expect(BUILTIN_MODULE_NAMES).toEqual([]);
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

test("release pruning preserves repository sources and removes every external tree outside the current manifest", async () => {
  const { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "chrona-release-pruning-"));
  try {
    const source = join(root, "source"), staged = join(root, "staged");
    const current = ["author", "chat", "mind", "notify", "pi", "qq", "web"];
    const retained = ["coding", "coding-web", "events", "files", "mcp", "memory-local", "remind", "remote-execution", "editor", "unexpected-app"];
    for (const name of [...current, ...retained]) {
      await mkdir(join(source, "external", name), { recursive: true });
      await writeFile(join(source, "external", name, "module.json"), JSON.stringify({ name }));
    }
    await cp(source, staged, { recursive: true });
    await omitPausedRuntimeModules(staged);
    await omitPausedRuntimeModules(staged);
    expect((await readdir(join(staged, "external"))).sort()).toEqual(current);
    expect((await readdir(join(source, "external"))).sort()).toEqual([...current, ...retained].sort());
    for (const name of retained) expect(JSON.parse(await readFile(join(source, "external", name, "module.json"), "utf8"))).toEqual({ name });
  } finally { await rm(root, { recursive: true, force: true }); }
});
