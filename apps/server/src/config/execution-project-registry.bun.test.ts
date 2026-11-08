import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
test("managed projects provision once by logical name, survive restart and have no default pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-create-"));
  try {
    const dataDir = join(root, "data"), registry = createExecutionProjectRegistry(dataDir);
    const pending = Array.from({ length: 12 }, () => registry.create(principal, "default"));
    const listing = registry.list(principal);
    const results = await Promise.all(pending), project = results[0]!;
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(project))).toBe(true);
    expect(await listing).toEqual({ projects: [project] });
    expect(dirname(dirname(project.path))).toBe(await realpath(join(root, "workspaces")));
    expect(basename(dirname(project.path))).toMatch(/^[a-f0-9]{64}$/);
    expect(basename(project.path)).toBe("default");
    expect(project.label).toBe("default"); // Application wording is not registry policy.
    expect((await stat(project.path)).isDirectory()).toBe(true);
    expect(await readdir(project.path)).toEqual([]);
    await writeFile(join(project.path, "notes.txt"), "keep across restart");
    const fresh = createExecutionProjectRegistry(dataDir);
    expect(await fresh.create(principal, "default")).toEqual(project);
    expect(await fresh.register(principal, project.path)).toEqual(project);
    expect(await fresh.resolve(principal, project.projectRef)).toMatchObject({ canonicalPath: project.path });
    expect(await readFile(join(project.path, "notes.txt"), "utf8")).toBe("keep across restart");
    const other = await fresh.create(principal, "scratch");
    expect(other.projectRef).not.toBe(project.projectRef);
    expect(await fresh.list(principal)).toEqual({ projects: [project, other] });
    expect(JSON.parse(await readFile(join(dataDir, "execution-project-registry.json"), "utf8"))).not.toHaveProperty("defaults");
    expect(fresh).not.toHaveProperty("default");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("managed names reject host paths and traversal before creating any directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-name-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data"));
    for (const name of ["", ".", "..", "../escape", "/absolute", "nested/name", "a\\b", "a b", "a".repeat(65)]) {
      await expect(registry.create(principal, name)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test.each(["root", "scope", "project"])("managed creation rejects symlink at %s without writing its target", async level => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-symlink-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data"));
    const target = join(root, "outside"); await mkdir(target);
    const first = await registry.create(principal, "first");
    const link = level === "root" ? join(root, "workspaces") : level === "scope" ? dirname(first.path) : join(dirname(first.path), "second");
    if (level !== "project") await rename(link, `${link}-old`);
    await symlink(target, link);
    await expect(registry.create(principal, "second")).rejects.toMatchObject({ code: "conflict" });
    expect(await readdir(target)).toEqual([]);
    expect(await registry.list(principal)).toEqual({ projects: [first] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("created project replacement cannot silently rebind an existing grant", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-replace-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data"));
    const project = await registry.create(principal, "default");
    await rename(project.path, `${project.path}-old`); await mkdir(project.path);
    await expect(registry.create(principal, "default")).rejects.toMatchObject({ code: "conflict" });
    await expect(registry.resolve(principal, project.projectRef)).rejects.toMatchObject({ code: "conflict" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("managed directories are scoped by workspace, owner and caller, and survive module hash updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-scope-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data"));
    const scopes: ExecutionPrincipal[] = [principal, { ...principal, workspaceId: "other" }, { ...principal, ownerId: "other" }, { ...principal, caller: { kind: "owner" } }, { ...principal, caller: { kind: "module", moduleId: "other", hash: "approved" } }];
    const projects = await Promise.all(scopes.map(scope => registry.create(scope, "default")));
    expect(new Set(projects.map(project => project.path)).size).toBe(scopes.length);
    expect(new Set(projects.map(project => project.projectRef)).size).toBe(scopes.length);
    for (const [index, scope] of scopes.entries()) {
      expect(await registry.list(scope)).toEqual({ projects: [projects[index]!] });
      for (const [otherIndex, project] of projects.entries()) if (index !== otherIndex) expect(await registry.resolve(scope, project.projectRef)).toBeNull();
    }
    expect(await registry.create({ ...principal, caller: { kind: "module", moduleId: "coding", hash: "updated" } }, "default")).toEqual(projects[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("discarding old default pointers preserves every existing project grant", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-v1-"));
  try {
    const dataDir = join(root, "data"), path = join(root, "project"); await mkdir(path);
    const existing = await createExecutionProjectRegistry(dataDir).register(principal, path);
    const file = join(dataDir, "execution-project-registry.json"), legacy = JSON.parse(await readFile(file, "utf8"));
    legacy.defaults = [{ workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: "module:coding", projectRef: existing.projectRef }];
    await writeFile(file, JSON.stringify(legacy));
    const fresh = createExecutionProjectRegistry(dataDir), project = await fresh.create(principal, "default");
    expect(await fresh.list(principal)).toEqual({ projects: [existing, project] });
    expect(await fresh.resolve(principal, existing.projectRef)).toMatchObject({ canonicalPath: path });
    expect(JSON.parse(await readFile(file, "utf8"))).not.toHaveProperty("defaults");
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
