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
