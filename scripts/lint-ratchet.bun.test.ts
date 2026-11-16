import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("renamed and split files share the original lint budget, then use their own committed baseline", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "chrona-lint-rename-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = (args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", fixture, ...args], { env, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  const line = "// " + "x".repeat(40) + "\n";
  const lint = (base: string, files: string[] = []) => Bun.spawnSync([process.execPath, "scripts/lint-ratchet.ts", ...files], {
    cwd: fixture, env: { ...env, LINT_RATCHET_BASE: base }, stdout: "pipe", stderr: "pipe",
  });
  try {
    await mkdir(join(fixture, "scripts"));
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
    await writeFile(join(fixture, "package.json"), '{"type":"module"}');
    await writeFile(join(fixture, "eslint.config.mjs"),
      'export default [{ files: ["*.js"], rules: { "max-len": ["warn", 20] } }];');
    await writeFile(join(fixture, "scripts/lint-ratchet.ts"), await readFile(join(root, "scripts/lint-ratchet.ts")));
    await writeFile(join(fixture, "scripts/restore-applications.ts"),
      "export async function restoreApplications() {}\nexport async function restoredApplicationSources() { return []; }\n");
    await writeFile(join(fixture, "scripts/application-git-inputs.ts"),
      "export function applicationBaselineSources() { return null; }\nexport function checkStagedApplicationInputs() {}\n");
    await writeFile(join(fixture, "scripts/lint-path-renames.json"), JSON.stringify({ "left.js": "old.js", "right.js": "old.js" }));
    await writeFile(join(fixture, "old.js"), line + line);
    git(["init", "--quiet"]);
    git(["config", "user.name", "Chrona test"]);
    git(["config", "user.email", "test@localhost"]);
    git(["add", "."]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "baseline"]);
    const original = git(["rev-parse", "HEAD"]);
    await rm(join(fixture, "old.js"));
    await writeFile(join(fixture, "left.js"), line);
    await writeFile(join(fixture, "right.js"), line);
    expect(lint(original).exitCode).toBe(0);
    git(["add", "left.js", "right.js"]);
    const partial = lint(original, ["--staged"]);
    expect(partial.exitCode).toBe(1);
    expect(partial.stderr.toString()).toContain("warnings 0 → 2");
    await writeFile(join(fixture, "old.js"), line + line);
    expect(lint(original).exitCode).toBe(1);
    await rm(join(fixture, "old.js"));
    git(["add", "-u", "old.js"]);
    expect(lint(original, ["--staged"]).exitCode).toBe(0);
    await writeFile(join(fixture, "right.js"), "const = ;\n");
    git(["add", "right.js"]);
    await writeFile(join(fixture, "right.js"), line);
    const fatal = lint(original, ["--staged"]);
    expect(fatal.exitCode).toBe(1);
    expect(fatal.stdout.toString()).toContain("Parsing error");
    expect(lint(original).exitCode).toBe(0);
    git(["add", "right.js"]);
    await rm(join(fixture, "right.js"));
    expect(lint(original, ["--staged"]).exitCode).toBe(0);
    await writeFile(join(fixture, "right.js"), "const = ;\n");
    expect(lint(original).exitCode).toBe(1);
    await writeFile(join(fixture, "right.js"), line + line);
    const increased = lint(original);
    expect(increased.exitCode).toBe(1);
    expect(increased.stderr.toString()).toContain("warnings 2 → 3");
    expect(lint(original, ["left.js"]).exitCode).toBe(1);
    await writeFile(join(fixture, "right.js"), line);
    git(["add", "."]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "split"]);
    expect(lint("HEAD", ["left.js", "right.js"]).exitCode).toBe(0);
    expect(lint("HEAD", ["--staged", "left.js", "right.js"]).exitCode).toBe(0);
    await writeFile(join(fixture, "right.js"), line + line);
    expect(lint("HEAD").exitCode).toBe(1);
    await writeFile(join(fixture, "right.js"), "const = ;\n");
    git(["add", "right.js"]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fatal baseline"]);
    const inheritedFatal = lint("HEAD", ["right.js"]);
    expect(inheritedFatal.exitCode).toBe(1);
    expect(inheritedFatal.stdout.toString()).toContain("Parsing error");
    expect(inheritedFatal.stderr.toString()).not.toContain("rejected new per-file debt");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
