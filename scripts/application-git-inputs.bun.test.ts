import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildArtifacts } from "../build/manifest";
import { applicationBaselineSources, checkStagedApplicationInputs } from "./application-git-inputs";

function fixture() {
  const root = mkdtempSync(join(process.cwd(), ".tmp/application-lint-test-")), app = "packages/engine/src/modules/steward/applications/web";
  const editing = join(root, "editing"), restored = join(root, app);
  for (const directory of [editing, restored, join(root, "scripts"), join(root, "resources/application-inputs")]) mkdirSync(directory, { recursive: true });
  const git = (directory: string, args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=test@chrona.local", "-C", directory, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  const original = "firstUndefined(); secondUndefined();\n";
  writeFileSync(join(editing, "source.js"), original);
  git(editing, ["init", "--initial-branch=main"]); git(editing, ["add", "."]); git(editing, ["commit", "-m", "App source"]);
  const bundle = "resources/module-git/web.bundle";
  mkdirSync(join(root, "resources/module-git"));
  git(editing, ["bundle", "create", join(root, bundle), "refs/heads/main"]);
  const entry = { name: "web", commit: git(editing, ["rev-parse", "HEAD"]), bundle, bundleSha256: createHash("sha256").update(readFileSync(join(root, bundle))).digest("hex"), artifacts: null };
  const entries = buildArtifacts.moduleGit.modules.map(module => {
    if (module.name === entry.name) return entry;
    const input = { ...entry, name: module.name, bundle: `resources/module-git/${module.name}.bundle` };
    cpSync(join(root, bundle), join(root, input.bundle));
    return input;
  });
  const release = { version: 1, modules: entries.map(input => ({ name: input.name, repository: null, branch: "main", commit: input.commit, bundle: `${input.name}.bundle`, bundleSha256: input.bundleSha256 })) };
  writeFileSync(join(root, "resources/application-inputs/lock.json"), JSON.stringify({ version: 1, applications: entries }));
  writeFileSync(join(root, "resources/module-git/lock.json"), JSON.stringify(release));
  writeFileSync(join(root, ".gitignore"), "editing/\nnode_modules/\n.tmp/\npackages/\n");
  symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(join(root, "eslint.config.mjs"), 'export default [{files:["**/*.js"],rules:{"no-undef":"error"}}];');
  cpSync(resolve("scripts/lint-ratchet.ts"), join(root, "scripts/lint-ratchet.ts"));
  cpSync(resolve("scripts/application-git-inputs.ts"), join(root, "scripts/application-git-inputs.ts"));
  cpSync(resolve("scripts/check-guardrails.ts"), join(root, "scripts/check-guardrails.ts"));
  cpSync(resolve("scripts/module-git-release.ts"), join(root, "scripts/module-git-release.ts"));
  const material = "packages/contracts/src/steward/module-material.ts";
  mkdirSync(join(root, material, ".."), { recursive: true });
  cpSync(resolve(material), join(root, material));
  mkdirSync(join(root, "build"));
  writeFileSync(join(root, "build/manifest.ts"), `export const buildArtifacts = ${JSON.stringify({ moduleGit: { modules: buildArtifacts.moduleGit.modules } })};`);
  writeFileSync(join(root, "scripts/generate-contract-schemas.ts"), 'export const contractSchemasDirectory = "unused"; export const generateContractSchemas = () => ({}); export const serializeContractSchema = () => "";');
  writeFileSync(join(root, "scripts/restore-applications.ts"), `
export const applicationSourcePath = ${JSON.stringify(app.slice(0, app.lastIndexOf("/")))};
export async function restoreApplications() {}
export async function restoredApplicationSources() { return [${JSON.stringify(app + "/source.js")}]; }
`);
  writeFileSync(join(restored, "source.js"), original);
  git(root, ["init", "--initial-branch=main"]);
  const oldSource = join(root, "packages/engine/src/modules/steward/external/web");
  mkdirSync(oldSource, { recursive: true }); writeFileSync(join(oldSource, "source.js"), original);
  git(root, ["add", "-f", "packages/engine/src/modules/steward/external/web/source.js"]);
  git(root, ["commit", "-m", "Host before extraction"]);
  rmSync(oldSource, { recursive: true });
  git(root, ["add", "-A"]); git(root, ["commit", "-m", "Host deletes external and pins independent application"]);
  return { root, app, editing, restored, entry, entries, release, git, head: git(root, ["rev-parse", "HEAD"]) };
}
function lint(root: string, args: string[], baseline?: string) {
  const env = { ...process.env };
  delete env.LINT_RATCHET_BASE;
  if (baseline) env.LINT_RATCHET_BASE = baseline;
  return Bun.spawnSync([process.execPath, "scripts/lint-ratchet.ts", ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
}

test("staged HEAD and release-default commit baselines retain app debt after external was deleted", () => {
  const f = fixture();
  try {
    expect(applicationBaselineSources(f.root, "HEAD")?.get(f.app + "/source.js")).toContain("firstUndefined");
    for (const [args, baseline] of [[["--staged"], undefined], [[], f.head], [[], undefined]] as [string[], string | undefined][]) {
      const result = lint(f.root, args, baseline);
      expect(result.exitCode, result.stderr.toString() + result.stdout.toString()).toBe(0);
      expect(result.stdout.toString()).toContain("Lint ratchet passed");
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test.each([false, true])("hook Git environment preserves the host index and baseline (all repository variables: %s)", allRepositoryVariables => {
  const f = fixture();
  try {
    f.git(f.root, ["update-ref", "refs/remotes/origin/main", f.head]);
    writeFileSync(join(f.root, "host-staged.txt"), "Host-only staged change\n");
    f.git(f.root, ["add", "host-staged.txt"]);
    const index = join(f.root, ".git/index");
    const tree = f.git(f.root, ["write-tree"]);
    const before = readFileSync(index), files = f.git(f.root, ["ls-files", "-z"]);
    const env = { ...process.env, GIT_INDEX_FILE: index, LINT_RATCHET_BASE: "" };
    if (allRepositoryVariables) Object.assign(env, {
      GIT_DIR: join(f.root, ".git"), GIT_WORK_TREE: f.root, GIT_COMMON_DIR: join(f.root, ".git"),
      GIT_OBJECT_DIRECTORY: join(f.root, ".git/objects"), GIT_PREFIX: "scripts/",
    });
    for (const args of [["scripts/lint-ratchet.ts", "--staged"], ["scripts/check-guardrails.ts", "--staged"], ["scripts/lint-ratchet.ts"]]) {
      const result = Bun.spawnSync([process.execPath, ...args], { cwd: f.root, env, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString() + result.stdout.toString()).toBe(0);
      expect(readFileSync(index).equals(before)).toBe(true);
      expect(f.git(f.root, ["ls-files", "-z"])).toBe(files);
      expect(f.git(f.root, ["write-tree"])).toBe(tree);
    }
    // Host object reads must still honor an explicitly selected hook index.
    const hookIndex = join(f.root, ".git/hook.index");
    cpSync(index, hookIndex);
    const hookEnv = { ...env, GIT_INDEX_FILE: hookIndex };
    execFileSync("git", ["rm", "--cached", "resources/application-inputs/lock.json"], { cwd: f.root, env: hookEnv, stdio: "pipe" });
    const selectedIndex = readFileSync(hookIndex);
    const result = Bun.spawnSync([process.execPath, "scripts/check-guardrails.ts", "--staged"], { cwd: f.root, env: hookEnv, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Stage the application input lock");
    expect(readFileSync(hookIndex).equals(selectedIndex)).toBe(true);
    expect(readFileSync(index).equals(before)).toBe(true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a fatal parsing error cannot replace two inherited ordinary lint errors", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.restored, "source.js"), "export const = ;\n");
    const result = lint(f.root, ["--staged"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("Parsing error");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("staged lock cannot omit its new bundle or use a different working-tree input", () => {
  const f = fixture();
  try {
    checkStagedApplicationInputs(f.root);
    writeFileSync(join(f.editing, "source.js"), "thirdUndefined();\n");
    f.git(f.editing, ["add", "."]); f.git(f.editing, ["commit", "-m", "Next application source"]);
    f.git(f.editing, ["bundle", "create", join(f.root, f.entry.bundle), "refs/heads/main"]);
    f.entry.commit = f.git(f.editing, ["rev-parse", "HEAD"]);
    f.entry.bundleSha256 = createHash("sha256").update(readFileSync(join(f.root, f.entry.bundle))).digest("hex");
    writeFileSync(join(f.root, "resources/application-inputs/lock.json"), JSON.stringify({ version: 1, applications: f.entries }));
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("differs between index and working tree");
    f.git(f.root, ["add", "resources/application-inputs/lock.json"]);
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("bundle checksum mismatch");
    const result = lint(f.root, ["--staged"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("bundle checksum mismatch");
    const guardrails = Bun.spawnSync([process.execPath, "scripts/check-guardrails.ts", "--staged"], { cwd: f.root, stdout: "pipe", stderr: "pipe" });
    expect(guardrails.exitCode).toBe(1);
    expect(guardrails.stderr.toString()).toContain("bundle checksum mismatch");
    f.git(f.root, ["add", f.entry.bundle]);
    Object.assign(f.release.modules.find(entry => entry.name === f.entry.name)!, { commit: f.entry.commit, bundleSha256: f.entry.bundleSha256 });
    writeFileSync(join(f.root, "resources/module-git/lock.json"), JSON.stringify(f.release));
    f.git(f.root, ["add", "resources/module-git/lock.json"]);
    checkStagedApplicationInputs(f.root);
    writeFileSync(join(f.root, f.entry.bundle), "working-tree corruption");
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("differs between index and working tree");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("staged artifact bytes and bundled main commit must match the staged lock", () => {
  const f = fixture();
  try {
    const lock = { version: 1, applications: f.entries.map(entry => ({ ...entry, artifacts: entry.name === f.entry.name ? { file: "resources/application-inputs/example.artifacts", sha256: createHash("sha256").update("next").digest("hex") } : null })) };
    writeFileSync(join(f.root, lock.applications[0]!.artifacts!.file), "next");
    writeFileSync(join(f.root, "resources/application-inputs/lock.json"), JSON.stringify(lock));
    f.git(f.root, ["add", "resources/application-inputs/lock.json"]);
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("artifact mismatch");
    f.git(f.root, ["add", lock.applications[0]!.artifacts!.file]);
    checkStagedApplicationInputs(f.root);
    lock.applications[0]!.commit = "0".repeat(40);
    writeFileSync(join(f.root, "resources/application-inputs/lock.json"), JSON.stringify(lock));
    f.git(f.root, ["add", "resources/application-inputs/lock.json"]);
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("commit mismatch");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});


test("the staged release lock must use the same application input commits", () => {
  const f = fixture();
  try {
    const path = join(f.root, "resources/module-git/lock.json");
    checkStagedApplicationInputs(f.root);
    f.release.modules[0]!.commit = "0".repeat(40);
    writeFileSync(path, JSON.stringify(f.release));
    f.git(f.root, ["add", "resources/module-git/lock.json"]);
    expect(() => checkStagedApplicationInputs(f.root)).toThrow("release lock differs from application inputs");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test.each(["missing", "empty", "missing-app", "branch", "bundle", "repository", "duplicate", "version", "bundle-sha", "application-bundle-path"])("both staged CLIs reject an invalid release lock: %s", variant => {
  const f = fixture();
  try {
    const path = "resources/module-git/lock.json";
    let expected = "Invalid module Git release identity";
    switch (variant) {
      case "missing": f.git(f.root, ["rm", "--cached", path]); expected = "Staged module Git release lock missing"; break;
      case "empty": f.release.modules = []; expected = "release lock is incomplete"; break;
      case "missing-app": f.release.modules.pop(); expected = "release lock is incomplete"; break;
      case "branch": f.release.modules[0]!.branch = "wrong"; break;
      case "bundle": f.release.modules[0]!.bundle = "wrong.bundle"; break;
      case "repository": Object.assign(f.release.modules[0]!, { repository: "https://example.invalid/wrong" }); break;
      case "duplicate": f.release.modules.push(f.release.modules[0]!); break;
      case "version": f.release.version = 2; expected = "Invalid module Git release lock"; break;
      case "bundle-sha": f.release.modules[0]!.bundleSha256 = "0".repeat(64); expected = "release lock differs from application inputs"; break;
      case "application-bundle-path": {
        const other = "resources/application-inputs/web.bundle";
        cpSync(join(f.root, f.entry.bundle), join(f.root, other));
        f.entry.bundle = other;
        writeFileSync(join(f.root, "resources/application-inputs/lock.json"), JSON.stringify({ version: 1, applications: f.entries }));
        f.git(f.root, ["add", other, "resources/application-inputs/lock.json"]);
        expected = "release lock differs from application inputs";
        break;
      }
    }
    if (variant !== "missing") {
      writeFileSync(join(f.root, path), JSON.stringify(f.release));
      f.git(f.root, ["add", path]);
    }
    expect(() => checkStagedApplicationInputs(f.root)).toThrow(expected);
    for (const script of ["lint-ratchet.ts", "check-guardrails.ts"]) {
      const result = Bun.spawnSync([process.execPath, `scripts/${script}`, "--staged"], { cwd: f.root, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(expected);
    }
    if (variant === "missing") expect(readFileSync(join(f.root, path), "utf8")).toContain('"modules"');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
