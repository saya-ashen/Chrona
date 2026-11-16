import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(fail: string | undefined, check: (directory: string, exit: number) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "chrona-verify-release-"));
  try {
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "resources/module-git"), { recursive: true });
    await cp(join(import.meta.dir, "verify-release.ts"), join(directory, "scripts/verify-release.ts"));
    await writeFile(join(directory, "resources/module-git/lock.json"), JSON.stringify({ version: 1, modules: [] }));
    await writeFile(join(directory, "scripts/step.ts"), `
      import { appendFileSync } from "node:fs";
      const name = process.argv[2];
      appendFileSync("events.log", name + "\\n");
      console.log("stdout:" + name);
      console.error("stderr:" + name);
      process.exitCode = name === "lint" || name === process.env.FAIL_STEP ? 1 : 0;
    `);
    await writeFile(join(directory, "scripts/chrona.ts"), 'await import("./step.ts");');
    for (const suite of ["bun", "api"]) {
      await writeFile(join(directory, `scripts/run-${suite}-tests.ts`), `console.log(JSON.stringify(["${suite}.bun.test.ts"]));`);
    }
    await writeFile(join(directory, "package.json"), JSON.stringify({ scripts: {
      "lint:warn": "bun scripts/step.ts lint",
      "test:bun": "bun scripts/step.ts tests",
      "test:api": "bun scripts/step.ts api",
      build: "bun scripts/step.ts build",
      "build:smoke": "bun scripts/step.ts smoke",
    } }));
    for (const command of [
      ["git", "init", "--quiet"],
      ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture"],
    ]) {
      const result = Bun.spawnSync(command, { cwd: directory, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    }
    const child = Bun.spawn([process.execPath, "scripts/verify-release.ts"], {
      cwd: directory, env: { ...process.env, FAIL_STEP: fail }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stderr, stdout).toBe("");
    await check(directory, exit);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("release verification reports lint debt separately and preserves both log streams", async () => {
  await fixture(undefined, async (directory, exit) => {
    expect(exit).toBe(0);
    const report = JSON.parse(await readFile(join(directory, ".tmp/release-verification/report.json"), "utf8"));
    expect(report.automatedGatesPassed).toBe(true);
    expect(report.manualAcceptance).toBe("not-run");
    expect(report.steps.find((step: { name: string }) => step.name === "lint-debt").exitCode).toBe(1);
    const log = await readFile(join(directory, ".tmp/release-verification/build.log"), "utf8");
    expect(log).toContain("stdout:build");
    expect(log).toContain("stderr:build");
    expect(await readFile(join(directory, "events.log"), "utf8")).toContain("smoke\n");
  });
});

test("failed build exits unsuccessfully and does not run smoke against stale artifacts", async () => {
  await fixture("build", async (directory, exit) => {
    expect(exit).toBe(1);
    const report = JSON.parse(await readFile(join(directory, ".tmp/release-verification/report.json"), "utf8"));
    expect(report.automatedGatesPassed).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ name: "build", exitCode: 1 });
    expect(await readFile(join(directory, "events.log"), "utf8")).not.toContain("smoke\n");
  });
});
