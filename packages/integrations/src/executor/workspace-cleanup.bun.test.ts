import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupLocalWorkspace } from "./workspace-cleanup";
import { localDirectoryIdentity, prepareLockedLocalWorkspace } from "./workspaces";
import { localDigest } from "./journal";

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Cleanup fixture", "-c", "user.email=cleanup@example.invalid", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.status !== 0) throw new Error("Fixture Git failed"); return result.stdout.trim();
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-cleanup-test-")); git(root, ["init", "-q"]); writeFileSync(join(root, "file"), "base\n"); git(root, ["add", "."]); git(root, ["commit", "-qm", "baseline"]);
  const baseline = { kind: "commit" as const, digest: git(root, ["rev-parse", "HEAD"]) };
  const input = { binding: { executorId: "device-test" }, work: { workId: "work", workspaceRef: "workspace", workspaceMode: "independent_worktree" as const, baseline }, mapping: { placement: { executorId: "device-test", projectRef: "project", mappingRevision: 1 }, canonicalPath: root, directoryIdentity: localDirectoryIdentity(root), baseline }, managedRoot: join(root, "managed") };
  const prepared = await prepareLockedLocalWorkspace(input); prepared.release();
  const verify = async () => "confirmed-stop-no-holds-source-bound";
  return { root, input, prepared, verify, cleanup: (command: Parameters<typeof cleanupLocalWorkspace>[1]) => cleanupLocalWorkspace(input, command, verify) };
}
test("real independent worktree preview/confirm and lost response replay preserve source and old results", async () => {
  const f = await fixture(); writeFileSync(join(f.root, "result-kept"), "old immutable result");
  const preview = await f.cleanup({ action: "preview", workId: "work", commandKey: "preview" }); expect(preview.state).toBe("retained"); expect(preview.previewDigest).not.toBeNull();
  const command = { action: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: preview.previewDigest! };
  const removed = await f.cleanup(command); expect(removed.state).toBe("removed"); expect(existsSync(f.prepared.cwd)).toBe(false); expect(await f.cleanup(command)).toEqual(removed);
  expect(readFileSync(join(f.root, "file"), "utf8")).toBe("base\n"); expect(readFileSync(join(f.root, "result-kept"), "utf8")).toBe("old immutable result");
  await expect(f.cleanup({ ...command, previewDigest: "0".repeat(64) })).rejects.toThrow("key conflict");
});
for (const mode of ["dirty", "untracked", "unintegrated", "retain", "unknown-retain", "hold", "changed-preview"] as const) test(`cleanup refuses ${mode}`, async () => {
  const f = await fixture(), preview = await f.cleanup({ action: "preview", workId: "work", commandKey: "preview" });
  if (mode === "dirty") writeFileSync(join(f.prepared.cwd, "file"), "valuable change");
  if (mode === "untracked") writeFileSync(join(f.prepared.cwd, "new"), "valuable new file");
  if (mode === "unintegrated") { writeFileSync(join(f.prepared.cwd, "file"), "unmerged"); git(f.prepared.cwd, ["add", "."]); git(f.prepared.cwd, ["commit", "-qm", "unintegrated"]); }
  if (mode === "retain" || mode === "unknown-retain") { const path = `${f.prepared.cwd}.json`, body = JSON.parse(readFileSync(path, "utf8")); if (mode === "retain") body.retentionProtected = true; else delete body.retentionProtected; writeFileSync(path, JSON.stringify(body)); }
  if (mode === "hold") { const locks = join(f.input.managedRoot, "locks"), key = localDigest({ creating: { binding: f.input.binding, workId: "work", workspaceRef: "workspace" } }); writeFileSync(join(locks, key), "other-owner"); }
  const result = await f.cleanup({ action: "confirm", workId: "work", commandKey: "confirm", previewDigest: mode === "changed-preview" ? "0".repeat(64) : preview.previewDigest! });
  expect(result.state).toBe("blocked"); expect(existsSync(f.prepared.cwd)).toBe(true); expect(JSON.stringify(result)).not.toContain(f.root);
});
test("uncertain removal fences every later command key without retrying Git", async () => {
  const f = await fixture(); await f.cleanup({ action: "preview", workId: "work", commandKey: "preview" });
  const key = localDigest({ binding: f.input.binding, workId: "work", workspaceRef: "workspace" });
  writeFileSync(join(f.input.managedRoot, "cleanup", `${key}.intent`), JSON.stringify({ digest: "prior-key", receipt: { state: "unknown" } }), { mode: 0o600 });
  for (const commandKey of ["new-key", "another-key"]) expect((await f.cleanup({ action: "preview", workId: "work", commandKey })).state).toBe("unknown");
  expect(existsSync(f.prepared.cwd)).toBe(true); expect(readdirSync(join(f.input.managedRoot, "locks"))).toEqual([]);
});
test("crash after actual Git removal but before receipt cannot be retried with another key", async () => {
  const f = await fixture(), preview = await f.cleanup({ action: "preview", workId: "work", commandKey: "preview" });
  const originalPath = process.env.PATH, realGit = Bun.which("git")!, bin = mkdtempSync(join(tmpdir(), "chrona-cleanup-fault-bin-"));
  const key = localDigest({ binding: f.input.binding, workId: "work", workspaceRef: "workspace" }), blocker = join(f.input.managedRoot, "cleanup", `${key}.removed.next`), count = join(bin, "delete-count");
  writeFileSync(join(bin, "git"), `#!${process.execPath}
import {spawnSync} from 'node:child_process';import {mkdirSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2);const result=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});
if(result.status===0&&args.includes('worktree')&&args.includes('remove')){appendFileSync(${JSON.stringify(count)},'removed\\n');mkdirSync(${JSON.stringify(blocker)})}process.exit(result.status??1);
`, { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    const command = { action: "confirm" as const, workId: "work", commandKey: "confirm", previewDigest: preview.previewDigest! }, result = await f.cleanup(command);
    expect(result.state).toBe("unknown"); expect(existsSync(f.prepared.cwd)).toBe(false); expect(await f.cleanup(command)).toEqual(result);
    expect((await f.cleanup({ action: "preview", workId: "work", commandKey: "different" })).state).toBe("unknown"); expect(readFileSync(count, "utf8")).toBe("removed\n"); expect(existsSync(f.root)).toBe(true);
  } finally { process.env.PATH = originalPath; }
});
