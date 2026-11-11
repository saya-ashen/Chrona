import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CodingContext } from "./types";
import { executionSnapshotSchema } from "./contract.js";
mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
mock.module("chrona/process", () => import("@chrona/process"));
const { observeProjectDirectory, observeProjectBaseline } = await import("./project-evidence");
const { captureWorkspaceChanges } = await import("./project-changes");
const { freezeResultEvidence, readFrozenEvidence } = await import("./result-evidence");
const { digest } = await import("./mutations");
const { saveSessionFile } = await import("./sessions");

async function fixture(body: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); try { await body(f); } finally { await rm(f.dir, { recursive: true, force: true }); }
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "coding-evidence-")), path = join(dir, "repo"); await mkdir(path);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: path, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) throw new Error(result.stderr.toString()); return result.stdout.toString().trim();
  };
  git("init", "--quiet");
  await writeFile(join(path, "tracked"), "base\n"); await writeFile(join(path, "deleted"), "old\n");
  await writeFile(join(path, "binary"), Buffer.from([0, 1])); await writeFile(join(path, ".gitignore"), "ignored\n");
  git("add", "."); git("commit", "--quiet", "-m", "fixture");
  const observed = await observeProjectDirectory(path), baseline = await observeProjectBaseline(observed.path, observed.identity);
  const project = { ...observed, baseline }, ref = { workId: "work", sessionId: "context", runId: "run", attemptId: "run" };
  const snapshot = executionSnapshotSchema.parse({ ...ref, status: "completed", cancelRequested: false, stopConfirmed: true, highWatermark: 1, finalMessage: { messageId: "reply", text: "Completed", truncated: false }, questions: [], missing: false, expiresAt: "2099-01-01T00:00:00Z" });
  const context: CodingContext = { dir: join(dir, "private"), content: join(dir, "public"), call: async () => { throw new Error("Evidence utility must not dispatch Agent"); } };
  return { dir, path, git, project, ref, snapshot, context };
}

test("Git baseline includes admission dirt, staged/unstaged, deletion and nonignored additions with explicit omissions", () => fixture(async f => {
  expect(f.project.baseline).toEqual({ kind: "commit", digest: f.git("rev-parse", "HEAD") });
  await writeFile(join(f.path, "tracked"), "staged\n"); f.git("add", "tracked"); await writeFile(join(f.path, "tracked"), "staged\nunstaged\n");
  await rm(join(f.path, "deleted")); await writeFile(join(f.path, "new"), "你好\n"); await writeFile(join(f.path, "ignored"), "private");
  await writeFile(join(f.path, "binary"), Buffer.from([0, 5])); await writeFile(join(f.path, "bad-utf8"), Buffer.from([255, 254])); await symlink("/missing", join(f.path, "link"));
  const value = await freezeResultEvidence(f.context, f.ref, f.project, f.snapshot, { text: "Completed" });
  expect(value.source!.changes).toMatchObject({ scope: "baseline_to_worktree", status: "partial" });
  const changes = value.source!.changes!;
  expect(changes.patch).toContain("+staged\n+unstaged"); expect(changes.patch).toContain("deleted");
  expect(changes.files.find(file => file.path === "new")?.text).toBe("你好\n");
  for (const [path, omitted] of [["binary", "binary"], ["bad-utf8", "encoding"], ["link", "symlink"]] as const) expect(changes.files.find(file => file.path === path)?.omitted).toBe(omitted);
  expect(changes.files.some(file => file.path === "ignored")).toBe(false);
  await rename(f.path, join(f.dir, "moved")); await mkdir(f.path); await writeFile(join(f.path, "new"), "later tree");
  expect(await readFrozenEvidence({ ...f.context }, f.ref)).toEqual(value);
  await expect(readFrozenEvidence(f.context, { ...f.ref, runId: "foreign" })).rejects.toMatchObject({ code: "conflict" });
}));

test("unchanged Git tree is a complete empty diff; replaced selected directory is unavailable", () => fixture(async f => {
  expect(await captureWorkspaceChanges(f.path, f.project.baseline)).toEqual({ scope: "baseline_to_worktree", status: "complete", patch: "", files: [] });
  await rename(f.path, join(f.dir, "old")); await mkdir(f.path); f.git("init", "--quiet");
  const value = await freezeResultEvidence(f.context, f.ref, f.project, f.snapshot);
  expect(value.source!.changes).toMatchObject({ status: "unavailable", reason: "baseline_unverified" });
  expect(value.snapshot.finalMessage!.text).toBe("Completed");
}));

test("restart after capture marker persists unavailable once instead of recapturing a later tree", () => fixture(async f => {
  const name = `evidence-${digest(f.ref.workId)}.json`;
  await saveSessionFile(f.context, name, { version: 1, ref: f.ref, project: f.project, stage: "capturing", snapshot: f.snapshot, text: "Completed" });
  await writeFile(join(f.path, "tracked"), "must not collect\n");
  const result = await readFrozenEvidence({ ...f.context }, f.ref);
  expect(result!.source!.changes).toMatchObject({ status: "unavailable", reason: "capture_failed" });
  expect(JSON.parse(await readFile(join(f.context.dir, "sessions", name), "utf8")).stage).toBe("frozen");
  await writeFile(join(f.path, "tracked"), "another tree\n");
  expect(await freezeResultEvidence(f.context, f.ref, f.project, f.snapshot)).toEqual(result!);
}));

test("Git ignores service Git environment, external diff and local fsmonitor", () => fixture(async f => {
  const hook = join(f.dir, "hook"), marker = join(f.dir, "called");
  await writeFile(hook, `#!/bin/sh\necho called > '${marker}'\n`, { mode: 0o755 });
  f.git("config", "core.fsmonitor", hook); f.git("config", "diff.external", hook);
  await writeFile(join(f.path, "tracked"), "safe change\n");
  const pollution = { GIT_DIR: "/missing", GIT_WORK_TREE: "/missing", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "true", GIT_EXTERNAL_DIFF: hook };
  const previous = Object.fromEntries(Object.keys(pollution).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, pollution);
    const changes = await captureWorkspaceChanges(f.path, f.project.baseline);
    expect(changes.status).toBe("complete"); expect(changes.patch).toContain("+safe change");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}));

test("collector bounds file count, per-file size and serialized bytes", () => fixture(async f => {
  await writeFile(join(f.path, "huge"), "x".repeat(65537));
  let changes = await captureWorkspaceChanges(f.path, f.project.baseline);
  expect(changes.files.find(file => file.path === "huge")?.omitted).toBe("size");
  for (let i = 0; i < 102; i++) await writeFile(join(f.path, `file-${i}`), "content");
  changes = await captureWorkspaceChanges(f.path, f.project.baseline);
  expect(changes.status).toBe("partial"); expect(changes.reason).toBe("limit");
  expect(changes.files.length).toBeLessThanOrEqual(100); expect(Buffer.byteLength(JSON.stringify(changes))).toBeLessThanOrEqual(131072);
}));

test("invalid durable evidence and unavailable storage propagate instead of triggering a live recapture", () => fixture(async f => {
  const name = `evidence-${digest(f.ref.workId)}.json`;
  for (const invalid of [null, false, { version: 1, ref: { ...f.ref, attemptId: "foreign" }, project: f.project, stage: "capturing", snapshot: f.snapshot }]) {
    await saveSessionFile(f.context, name, invalid);
    await expect(freezeResultEvidence(f.context, f.ref, f.project, f.snapshot)).rejects.toMatchObject({ code: "conflict" });
  }
  await rm(join(f.context.dir, "sessions", name));
  await mkdir(join(f.context.dir, "sessions", name));
  await expect(freezeResultEvidence(f.context, f.ref, f.project, f.snapshot)).rejects.toThrow();
  await rm(join(f.context.dir, "sessions", name), { recursive: true });
  await rm(join(f.context.dir, "sessions"), { recursive: true });
  await writeFile(join(f.context.dir, "sessions"), "storage unavailable");
  await expect(freezeResultEvidence(f.context, f.ref, f.project, f.snapshot)).rejects.toThrow();
}));
