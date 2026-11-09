import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compileArgs } from "./build-binaries";
import { buildTargets, type BuildTargetName } from "../build/manifest";

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
  const root = mkdtempSync("/tmp/chrona-release-compile-test-");
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
    const { buildAgentApplication } = await import("../packages/engine/src/modules/steward/builtin/agent/build");
    await buildAgentApplication(join(resourcesRoot, "builtin/agent"));
    const { buildEntryConversations } = await import("../build/entry-conversations");
    await buildEntryConversations(resourcesRoot);
    const lock = await prepareModuleGitRelease({ root, resourcesRoot, seedDir, hostCommit: "a".repeat(40), hostTimestamp: "1735689600" });
    const codingContract = await readFile(join(resourcesRoot, "external/coding/contract.js"), "utf8");
    process.env.CHRONA_MODULE_GIT_SEEDS = seedDir;
    await prepareReleaseModules(resourcesRoot);
    expect(JSON.parse(await readFile(join(resourcesRoot, "module-git/lock.json"), "utf8"))).toEqual(lock);
    expect(lock.modules).toHaveLength(13);
    expect(lock.modules.some(module => module.name === "editor")).toBe(false);
    expect(await Bun.file(join(resourcesRoot, "module-git/editor.bundle")).exists()).toBe(false);
    expect(await Bun.file(join(resourcesRoot, "external/editor/module.json")).exists()).toBe(false);
    expect([...buildArtifacts.pausedModuleResources]).toEqual(["external/remind"]);
    for (const source of buildArtifacts.pausedModuleResources) {
      expect(await Bun.file(join(resourcesRoot, source, "module.json")).exists()).toBe(false);
      // Retained bundles record source provenance, but have no runtime installation tree.
      expect(await Bun.file(join(resourcesRoot, "module-git", `${source.split("/").pop()}.bundle`)).exists()).toBe(true);
    }
    for (const name of ["web", "notify", "qq", "author", "files", "events", "memory-local", "mcp", "mind", "coding", "coding-web"]) expect(await Bun.file(join(resourcesRoot, "external", name, "module.json")).exists()).toBe(true);
    const { OPTIONAL_EXTERNAL_MODULE_NAMES, PREINSTALLED_MODULE_NAMES } = await import("@chrona/contracts/steward");
    for (const module of [{ name: "mind", source: "external/mind" }, { name: "coding", source: "external/coding" }, { name: "coding-web", source: "external/coding-web" }] as const) {
      const { name } = module;
      expect(buildArtifacts.moduleGit.modules).toContainEqual(module);
      expect(lock.modules.find(module => module.name === name)?.bundle).toBe(`${name}.bundle`);
      expect(await Bun.file(join(resourcesRoot, "module-git", `${name}.bundle`)).exists()).toBe(true);
      expect(OPTIONAL_EXTERNAL_MODULE_NAMES).toContain(name);
      expect(PREINSTALLED_MODULE_NAMES).not.toContain(name);
    }
    expect(await readFile(join(resourcesRoot, "external/coding/contract.js"), "utf8")).toBe(codingContract);
    expect(buildArtifacts.moduleGit.modules).toContainEqual({ name: "mcp", source: "external/mcp" });
    expect(lock.modules.find(module => module.name === "mcp")?.bundle).toBe("mcp.bundle");
    expect(await Bun.file(join(resourcesRoot, "module-git/mcp.bundle")).exists()).toBe(true);
    expect(buildArtifacts.moduleGit.modules).toContainEqual({ name: "author", source: "external/author" });
    expect(lock.modules.find(module => module.name === "author")?.bundle).toBe("author.bundle");
    expect(await Bun.file(join(resourcesRoot, "module-git/author.bundle")).exists()).toBe(true);
    expect(await Bun.file(join(resourcesRoot, "builtin/agent/module.json")).exists()).toBe(true);
    expect(await readFile(join(resourcesRoot, "external/web/LICENSE"), "utf8")).toBe(await readFile(join(root, "LICENSE"), "utf8"));
  } finally {
    if (previous === undefined) delete process.env.CHRONA_MODULE_GIT_SEEDS;
    else process.env.CHRONA_MODULE_GIT_SEEDS = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
