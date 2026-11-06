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

test("fixed module seeds include generated execution contracts before release verification", async () => {
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
      await writeFile(join(dir, "module.json"), JSON.stringify({ name: module.name, entry: "index.ts", triggers: [], keepAlive: true, effects: [], tests: ["test.ts"] }));
      await writeFile(join(dir, "index.ts"), "// entry\n");
    }
    await buildExecutionContracts(join(resourcesRoot, "external"));
    const lock = await prepareModuleGitRelease({ root, resourcesRoot, seedDir, hostCommit: "a".repeat(40), hostTimestamp: "1735689600" });
    // Recreate a raw resource copy: release preparation must generate these again before comparing trees.
    for (const name of ["coding", "editor"]) for (const file of ["contract.js", "contract.d.ts", "executor-contract.js", "executor-contract.d.ts"]) await rm(join(resourcesRoot, "external", name, file));
    process.env.CHRONA_MODULE_GIT_SEEDS = seedDir;
    await prepareReleaseModules(resourcesRoot);
    expect(JSON.parse(await readFile(join(resourcesRoot, "module-git/lock.json"), "utf8"))).toEqual(lock);
    expect((await readFile(join(resourcesRoot, "external/coding/contract.js"), "utf8")).length).toBeGreaterThan(100);
    expect(await readFile(join(resourcesRoot, "builtin/web/LICENSE"), "utf8")).toBe(await readFile(join(root, "LICENSE"), "utf8"));
    delete process.env.CHRONA_MODULE_GIT_SEEDS;
    await expect(prepareReleaseModules(resourcesRoot)).rejects.toThrow("differs from packaged source");
  } finally {
    if (previous === undefined) delete process.env.CHRONA_MODULE_GIT_SEEDS;
    else process.env.CHRONA_MODULE_GIT_SEEDS = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
