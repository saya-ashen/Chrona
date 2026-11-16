import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stageModuleMaterial } from "../build/agent-dependencies";
import { pinApplication } from "./pin-application";
import { restoreApplications } from "./restore-applications";

async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".tmp/application-input-test-"));
  const repository = join(root, "editing"), restored = join(root, "restored");
  await mkdir(repository);
  await mkdir(join(root, "resources/module-git"), { recursive: true });
  await writeFile(join(root, "resources/module-git/lock.json"), JSON.stringify({ version: 1, modules: [] }));
  await writeFile(join(repository, "module.json"), JSON.stringify({ name: "example", entry: "index.ts", tests: ["test.ts"] }));
  await writeFile(join(repository, "index.ts"), 'export const source = "pinned";\n');
  await writeFile(join(repository, "test.ts"), 'export const test = () => true;\n');
  await writeFile(join(repository, "runtime.js"), 'export const artifact = "pinned";\n');
  await chmod(join(repository, "runtime.js"), 0o755);
  await stageModuleMaterial(repository, { artifacts: ["runtime.js"], build: { commands: [], toolchain: "fixture", target: "bun" } });
  const git = (args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Chrona Test", "-c", "user.email=test@chrona.local", "-C", repository, ...args], { stdio: "pipe" });
  git(["init", "--initial-branch=main"]);
  await writeFile(join(repository, ".git/info/exclude"), "/runtime.js\n");
  git(["add", "."]); git(["commit", "-m", "Fixed source"]);
  const entry = await pinApplication("example", repository, root);
  return { root, repository, restored, entry };
}

test("offline inputs restore source, exact artifacts and executable modes without the editing checkout", async () => {
  const f = await fixture();
  try {
    await rm(f.repository, { recursive: true });
    await restoreApplications(f.root, f.restored);
    expect(await readFile(join(f.restored, "example/index.ts"), "utf8")).toContain('"pinned"');
    expect(await readFile(join(f.restored, "example/runtime.js"), "utf8")).toContain('"pinned"');
    await restoreApplications(f.root, f.restored);
    await chmod(join(f.restored, "example/runtime.js"), 0o644);
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("executable mode mismatch");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("restoration rejects modified source, undeclared material and corrupt bundle or artifact input", async () => {
  const f = await fixture();
  try {
    await restoreApplications(f.root, f.restored);
    const source = join(f.restored, "example/index.ts"), original = await readFile(source);
    await writeFile(source, "changed");
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("Restored application changed");
    await writeFile(source, original);
    await writeFile(join(f.restored, "example/extra.ts"), "undeclared");
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("undeclared material");
    await rm(join(f.restored, "example/extra.ts"));
    const artifact = join(f.root, f.entry.artifacts!.file), originalArtifact = await readFile(artifact);
    await writeFile(artifact, "changed");
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("artifact input checksum mismatch");
    await writeFile(artifact, originalArtifact);
    await writeFile(join(f.root, f.entry.bundle), "changed");
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("bundle checksum mismatch");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("pinning refuses uncommitted application source", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repository, "index.ts"), "uncommitted");
    await expect(pinApplication("example", f.repository, f.root)).rejects.toThrow("Commit application source on main");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("legacy seed preparation cannot replace the maintained independent application history", async () => {
  const path = join(process.cwd(), "resources/module-git/lock.json"), before = await readFile(path);
  const child = Bun.spawn([process.execPath, "scripts/module-git-release.ts", "prepare", "resources/module-git", "unused-staging"], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("use scripts/pin-application.ts after committing main");
  expect(await readFile(path)).toEqual(before);
});


test("pinning a release records its actual independent checkout for later publication review", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "resources/module-git");
    await writeFile(join(directory, "lock.json"), JSON.stringify({ version: 1, modules: [{ name: "example", commit: f.entry.commit }] }));
    await writeFile(join(directory, "publish-plan.json"), JSON.stringify({ version: 1, modules: [{ name: "example", localRepository: "repos/stale.git" }] }));
    const entry = await pinApplication("example", f.repository, f.root);
    const plan = JSON.parse(await readFile(join(directory, "publish-plan.json"), "utf8"));
    expect(plan.modules[0]).toEqual({ name: "example", localRepository: "../../editing", commit: entry.commit });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("an existing restored tree cannot hide a lock commit that differs from bundled main", async () => {
  const f = await fixture();
  try {
    await restoreApplications(f.root, f.restored);
    const path = join(f.root, "resources/application-inputs/lock.json");
    const lock = JSON.parse(await readFile(path, "utf8"));
    lock.applications[0].commit = "0".repeat(40);
    await writeFile(path, JSON.stringify(lock));
    await expect(restoreApplications(f.root, f.restored)).rejects.toThrow("Application commit mismatch");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("concurrent first restores retain one validated winner and remove their own temporary trees", async () => {
  const f = await fixture();
  try {
    await Promise.all([restoreApplications(f.root, f.restored), restoreApplications(f.root, f.restored)]);
    await restoreApplications(f.root, f.restored);
    expect(await readFile(join(f.restored, "example/index.ts"), "utf8")).toContain('"pinned"');
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(f.restored)).toEqual(["example"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
