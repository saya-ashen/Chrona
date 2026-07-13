import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
