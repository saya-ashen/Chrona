import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXECUTION_CHANGES_LIMITS as LIMITS } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { captureExecutionChanges, readExecutionChanges } from "./execution-result";

async function fixture() {
  const dir = await mkdtemp("/tmp/chrona-result-"), cwd = join(dir, "repo"), logDir = join(dir, "logs");
  await mkdir(cwd);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  git("init", "--quiet");
  await writeFile(join(cwd, "tracked.txt"), "base\n");
  await writeFile(join(cwd, "deleted.txt"), "old\n");
  await writeFile(join(cwd, "binary.dat"), Buffer.from([0, 1, 2]));
  await writeFile(join(cwd, ".gitignore"), "ignored.txt\n");
  git("add", "."); git("commit", "--quiet", "-m", "fixture");
  const row = { id: "a", runId: "r", workId: "w", run: { sessionId: "s" }, logDir, baseline: `commit:${git("rev-parse", "HEAD")}`, executorId: "server", resolvedCwd: cwd as string | null, heldDirectory: cwd };
  const ports = { db: { executionAttempt: { findUnique: async () => row } } } as unknown as Pick<StewardPorts, "db">;
  return { dir, cwd, logDir, row, ports, git, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test("captures baseline to working tree staged, unstaged, deleted, nonignored Unicode and explicit omissions", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "tracked.txt"), "staged\n"); f.git("add", "tracked.txt");
    await writeFile(join(f.cwd, "tracked.txt"), "staged\nunstaged\n");
    await rm(join(f.cwd, "deleted.txt"));
    await writeFile(join(f.cwd, "binary.dat"), Buffer.from([0, 5, 6]));
    await writeFile(join(f.cwd, "new.txt"), "你好\n");
    await writeFile(join(f.cwd, "ignored.txt"), "must not publish");
    await writeFile(join(f.cwd, "bad-utf8"), Buffer.from([255, 254]));
    await symlink("/nonexistent", join(f.cwd, "link"));
    await captureExecutionChanges(f.ports, "r");
    const changes = await readExecutionChanges(f.row);
    expect(changes?.scope).toBe("baseline_to_worktree");
    expect(changes?.status).toBe("partial");
    expect(changes?.patch).toContain("+staged\n+unstaged");
    expect(changes?.patch).toContain("deleted.txt");
    expect(changes?.files.find(file => file.path === "new.txt")?.text).toBe("你好\n");
    expect(changes?.files.find(file => file.path === "binary.dat")?.omitted).toBe("binary");
    expect(changes?.files.find(file => file.path === "link")?.omitted).toBe("symlink");
    expect(changes?.files.find(file => file.path === "bad-utf8")?.omitted).toBe("encoding");
    expect(changes?.files.some(file => file.path === "ignored.txt")).toBe(false);
    // Read retained sidecar even when the project no longer exists; never recapture on query/restart.
    await rename(f.cwd, join(f.dir, "moved"));
    expect(await readExecutionChanges(f.row)).toEqual(changes);
    await expect(readExecutionChanges({ ...f.row, workId: "other" })).rejects.toThrow("identity mismatch");
    await expect(readExecutionChanges({ ...f.row, baseline: "snapshot:other" })).rejects.toThrow("identity mismatch");
  } finally { await f.cleanup(); }
});
test("unchanged is complete; snapshot, invalid baseline and root mismatch are honest unavailable", async () => {
  const f = await fixture();
  try {
    expect(await readExecutionChanges(f.row)).toBeUndefined();
    await captureExecutionChanges(f.ports, "r");
    expect(await readExecutionChanges(f.row)).toEqual({ scope: "baseline_to_worktree", status: "complete", patch: "", files: [] });
    f.row.baseline = "snapshot:opaque";
    await captureExecutionChanges(f.ports, "r");
    expect((await readExecutionChanges(f.row))?.reason).toBe("snapshot_unresolvable");
    f.row.baseline = "commit:HEAD";
    await captureExecutionChanges(f.ports, "r");
    expect((await readExecutionChanges(f.row))?.reason).toBe("baseline_unverified");
    f.row.baseline = `commit:${"0".repeat(40)}`;
    await captureExecutionChanges(f.ports, "r");
    expect((await readExecutionChanges(f.row))?.reason).toBe("baseline_unverified");
  } finally { await f.cleanup(); }
});
test("file count, per-file and JSON limits preserve an explicit partial result", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "big"), "x".repeat(LIMITS.fileBytes + 1));
    await writeFile(join(f.cwd, "escaped"), "\u0001".repeat(30_000));
    await captureExecutionChanges(f.ports, "r");
    let changes = await readExecutionChanges(f.row);
    expect(changes?.status).toBe("partial");
    expect(changes?.files.find(file => file.path === "big")?.omitted).toBe("size");
    expect(Buffer.byteLength(JSON.stringify(changes))).toBeLessThanOrEqual(LIMITS.bytes);
    for (let i = 0; i < LIMITS.files + 1; i++) await writeFile(join(f.cwd, `f-${i}`), "data");
    await writeFile(join(f.cwd, "tracked.txt"), "x".repeat(LIMITS.bytes + 1));
    await captureExecutionChanges(f.ports, "r");
    changes = await readExecutionChanges(f.row);
    expect(changes?.status === "partial" || changes?.status === "unavailable").toBe(true);
    expect(changes?.reason).toBe("limit");
    expect(changes?.files.length).toBeLessThanOrEqual(LIMITS.files);
    expect(Buffer.byteLength(JSON.stringify(changes))).toBeLessThanOrEqual(LIMITS.bytes);
  } finally { await f.cleanup(); }
});
test("submodule evidence does not recurse; Git external diff and local fsmonitor are disabled", async () => {
  const f = await fixture();
  try {
    f.git("config", "diff.external", "not-a-real-executable");
    f.git("update-index", "--add", "--cacheinfo", `160000,${f.row.baseline.slice(7)},nested`);
    await mkdir(join(f.cwd, "nested"));
    const marker = join(f.dir, "fsmonitor-called"), hook = join(f.dir, "fsmonitor-hook");
    await writeFile(hook, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'called');\nprocess.stdout.write('fixture-token\\0');\n`, { mode: 0o755 });
    f.git("config", "core.fsmonitor", hook);
    f.git("-c", "diff.external=", "diff", "--name-only");
    expect(await readFile(marker, "utf8")).toBe("called");
    await rm(marker);
    await captureExecutionChanges(f.ports, "r");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const changes = await readExecutionChanges(f.row);
    expect(changes?.status).toBe("partial");
    expect(changes?.files.find(file => file.path === "nested")?.omitted).toBe("unsupported");
  } finally { await f.cleanup(); }
});
test("service Git environment cannot redirect capture or inject configuration", async () => {
  const f = await fixture(), other = await fixture();
  const pollution = { GIT_DIR: join(other.cwd, ".git"), GIT_WORK_TREE: other.cwd, GIT_INDEX_FILE: join(other.cwd, ".git", "index"), GIT_EXTERNAL_DIFF: "must-not-run", GIT_CONFIG_GLOBAL: join(f.dir, "global.gitconfig"), GIT_CONFIG_SYSTEM: join(f.dir, "system.gitconfig"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "true" };
  const previous = Object.fromEntries(Object.keys(pollution).map(key => [key, process.env[key]]));
  try {
    await writeFile(join(f.cwd, "tracked.txt"), "target-change\n");
    await writeFile(join(other.cwd, "tracked.txt"), "wrong-repo-change\n");
    await writeFile(pollution.GIT_CONFIG_GLOBAL, "[core]\n bare = true\n");
    await writeFile(pollution.GIT_CONFIG_SYSTEM, "[core]\n bare = true\n");
    Object.assign(process.env, pollution);
    await captureExecutionChanges(f.ports, "r");
    const changes = await readExecutionChanges(f.row);
    expect(changes?.status).toBe("complete");
    expect(changes?.patch).toContain("target-change");
    expect(changes?.patch).not.toContain("wrong-repo-change");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await f.cleanup(); await other.cleanup();
  }
});
test("device results and missing local cwd never capture server files or replace retained evidence", async () => {
  const f = await fixture();
  try {
    await captureExecutionChanges(f.ports, "r");
    const retained = await readFile(join(f.logDir, "execution-changes.json"), "utf8");
    await writeFile(join(f.cwd, "tracked.txt"), "must-not-capture\n");
    for (const identity of [{ executorId: "device", resolvedCwd: f.cwd }, { executorId: "server", resolvedCwd: null }]) {
      Object.assign(f.row, identity);
      await expect(captureExecutionChanges(f.ports, "r")).rejects.toThrow("verified remote final");
      expect(await readFile(join(f.logDir, "execution-changes.json"), "utf8")).toBe(retained);
    }
  } finally { await f.cleanup(); }
});
test("disk write failures propagate; invalid retained data does not trigger live scanning", async () => {
  const f = await fixture();
  try {
    f.row.heldDirectory = "released";
    await captureExecutionChanges(f.ports, "r");
    expect((await readExecutionChanges(f.row))?.reason).toBe("capture_failed");
    await writeFile(join(f.logDir, "execution-changes.json"), "{}");
    await expect(readExecutionChanges(f.row)).rejects.toThrow();
    await writeFile(join(f.logDir, "execution-changes.json"), "x".repeat(LIMITS.bytes + 4097));
    await expect(readExecutionChanges(f.row)).rejects.toThrow("exceeds limit");
    await rm(f.logDir, { recursive: true });
    await writeFile(f.logDir, "not a directory");
    await expect(captureExecutionChanges(f.ports, "r")).rejects.toThrow();
    expect(await readFile(f.logDir, "utf8")).toBe("not a directory");
  } finally { await f.cleanup(); }
});
