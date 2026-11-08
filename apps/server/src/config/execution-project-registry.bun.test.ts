import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import { createExecutionProjectRegistry } from "./execution-project-registry";

const principal: ExecutionPrincipal = { workspaceId: "workspace", ownerId: "owner", caller: { kind: "module", moduleId: "coding", hash: "approved" } };
test("host directory grants persist immediately, deduplicate aliases and isolate callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-registry-"));
  try {
    const dir = join(root, "empty"); await mkdir(dir);
    const registry = createExecutionProjectRegistry(join(root, "data"));
    const [a, b] = await Promise.all([registry.register(principal, dir), registry.register(principal, dir)]);
    expect(a).toEqual(b);
    expect(await registry.list(principal)).toEqual({ projects: [a] });
    const alias = join(root, "alias"); await symlink(dir, alias);
    expect(await registry.register(principal, alias)).toEqual(a);
    const fresh = createExecutionProjectRegistry(join(root, "data"));
    expect(await fresh.list(principal)).toEqual({ projects: [a] });
    expect(await fresh.resolve(principal, a.projectRef)).toMatchObject({ canonicalPath: dir, baseline: expect.stringMatching(/^snapshot:/) });
    expect(await fresh.resolve({ ...principal, workspaceId: "other" }, a.projectRef)).toBeNull();
    expect(await fresh.resolve({ ...principal, caller: { kind: "owner" } }, a.projectRef)).toBeNull();
    expect(await fresh.resolve({ ...principal, caller: { kind: "module", moduleId: "replacement", hash: "approved" } }, a.projectRef)).toBeNull();
    await expect(fresh.register(principal, "relative")).rejects.toMatchObject({ code: "invalid" });
    const file = join(root, "file"); await writeFile(file, "untouched");
    await expect(fresh.register(principal, file)).rejects.toMatchObject({ code: "invalid" });
    await rename(dir, `${dir}-old`); await mkdir(dir);
    await expect(fresh.resolve(principal, a.projectRef)).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(file, "utf8")).toBe("untouched");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("non-Git and unborn repositories work; committed repositories resolve current per-round HEAD without editing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-baseline-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data")), path = join(root, "project"); await mkdir(path);
    const project = await registry.register(principal, path);
    expect((await registry.resolve(principal, project.projectRef))!.baseline).toMatch(/^snapshot:/);
    execFileSync("git", ["init", "-q", path]);
    expect((await registry.resolve(principal, project.projectRef))!.baseline).toMatch(/^snapshot:/);
    await writeFile(join(path, "hello.txt"), "first");
    const git = (...args: string[]) => execFileSync("git", ["-C", path, "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", ...args], { encoding: "utf8" }).trim();
    git("add", "."); git("commit", "-qm", "first");
    const first = (await registry.resolve(principal, project.projectRef))!.baseline;
    expect(first).toBe(`commit:${git("rev-parse", "HEAD")}`);
    await writeFile(join(path, "hello.txt"), "second"); git("commit", "-am", "second", "-q");
    expect((await registry.resolve(principal, project.projectRef))!.baseline).not.toBe(first);
    expect(await readFile(join(path, "hello.txt"), "utf8")).toBe("second");
  } finally { await rm(root, { recursive: true, force: true }); }
});
