import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanupTestRunWorkspace, createTestRunWorkspace } from "./run-bun-tests";

import { shouldInstallGitHooks } from "./install-git-hooks";
import { createLocalCiEnvironment } from "./local-ci";

const temporaryPaths: string[] = [];

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("local CI Git hook support", () => {
  it("only installs hooks for local Git checkouts outside CI", () => {
    const checkout = temporaryDirectory("chrona-hooks-");
    Bun.write(join(checkout, ".git"), "gitdir: /tmp/worktree\n");

    expect(shouldInstallGitHooks(checkout, {})).toBe(true);
    expect(shouldInstallGitHooks(checkout, { CI: "true" })).toBe(false);
    expect(shouldInstallGitHooks(temporaryDirectory("chrona-no-git-"), {})).toBe(false);
  });

  it("creates and cleans an isolated SQLite location", () => {
    const environment = createLocalCiEnvironment();
    const directory = environment.databasePath.slice(0, environment.databasePath.lastIndexOf("/"));

    expect(environment.databaseUrl).toBe(`file:${environment.databasePath}`);
    expect(existsSync(directory)).toBe(true);

    environment.cleanup();
    expect(existsSync(directory)).toBe(false);
  });

  it("creates unique database and data paths and cleans all SQLite sidecars", () => {
    const workspace = createTestRunWorkspace(process.cwd(), ["first.bun.test.ts", "second.bun.test.ts"]);
    const [first, second] = workspace.files;

    expect(first.fileDbPath).not.toBe(second.fileDbPath);
    expect(first.dataDir).not.toBe(second.dataDir);
    expect(first.env.DATABASE_URL).toBe(`file:${first.fileDbPath}`);
    expect(first.env.CHRONA_DATA_DIR).toBe(first.dataDir);
    expect(existsSync(first.fileDbPath.slice(0, first.fileDbPath.lastIndexOf("/")))).toBe(true);

    writeFileSync(`${first.fileDbPath}-wal`, "sidecar");
    cleanupTestRunWorkspace(workspace);

    expect(existsSync(workspace.root)).toBe(false);
  });
});
