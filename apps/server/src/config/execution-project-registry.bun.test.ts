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
test("default projects provision once, persist across restart and appear in concurrent listings", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-default-"));
  try {
    const dataDir = join(root, "data"), registry = createExecutionProjectRegistry(dataDir);
    const pending = Array.from({ length: 12 }, () => registry.default(principal));
    const listing = registry.list(principal);
    const results = await Promise.all(pending), project = results[0]!;
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(project))).toBe(true);
    expect(await listing).toEqual({ projects: [project] });
    expect(dirname(project.path)).toBe(await realpath(join(root, "workspaces")));
    expect(basename(project.path)).toMatch(/^[a-f0-9]{64}$/);
    expect(project.label).toBe("默认空间");
    expect((await stat(project.path)).isDirectory()).toBe(true);
    expect(await readdir(project.path)).toEqual([]);
    expect(await registry.register(principal, project.path)).toEqual(project);
    await writeFile(join(project.path, "notes.txt"), "keep across restart");
    const fresh = createExecutionProjectRegistry(dataDir);
    expect(await fresh.default(principal)).toEqual(project);
    expect(await fresh.list(principal)).toEqual({ projects: [project] });
    expect(await fresh.resolve(principal, project.projectRef)).toMatchObject({ canonicalPath: project.path, baseline: expect.stringMatching(/^snapshot:/) });
    expect(await readFile(join(project.path, "notes.txt"), "utf8")).toBe("keep across restart");
    expect(await readdir(join(root, "workspaces"))).toEqual([basename(project.path)]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("changing the default uses existing non-Git directories and preserves all prior project references", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-default-change-"));
  try {
    const dataDir = join(root, "data"), registry = createExecutionProjectRegistry(dataDir);
    const original = await registry.default(principal);
    const home = join(root, "home"), custom = join(root, "custom"), alias = join(root, "alias");
    await mkdir(home); await mkdir(custom); await symlink(home, alias);
    await writeFile(join(home, "existing.txt"), "untouched");
    const [existing, selected] = await Promise.all([registry.register(principal, home), registry.default(principal, alias)]);
    expect(selected).toEqual(existing);
    expect(await registry.default(principal)).toEqual(existing);
    const [changed, latest] = await Promise.all([registry.default(principal, custom), registry.default(principal)]);
    expect(latest).toEqual(changed);
    expect(changed.projectRef).not.toBe(existing.projectRef);
    expect(changed).toMatchObject({ path: custom, label: "custom" });
    const fresh = createExecutionProjectRegistry(dataDir);
    expect(await fresh.default(principal)).toEqual(changed);
    expect(await fresh.list(principal)).toEqual({ projects: [original, existing, changed] });
    for (const project of [original, existing, changed]) {
      expect(await fresh.resolve(principal, project.projectRef)).toMatchObject({ canonicalPath: project.path, baseline: expect.stringMatching(/^snapshot:/) });
    }
    expect(await fresh.default(principal, original.path)).toEqual(original);
    expect(await readFile(join(home, "existing.txt"), "utf8")).toBe("untouched");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("setting a custom default first skips provisioning; invalid paths and replaced directories do not change the pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-default-validation-"));
  try {
    const dataDir = join(root, "data"), registry = createExecutionProjectRegistry(dataDir), path = join(root, "custom");
    await mkdir(path);
    const project = await registry.default(principal, path);
    expect(await readdir(root)).toEqual(expect.not.arrayContaining(["workspaces"]));
    const file = join(root, "file"); await writeFile(file, "untouched");
    for (const invalid of ["relative", join(root, "missing"), file]) {
      await expect(registry.default(principal, invalid)).rejects.toMatchObject({ code: "invalid" });
      expect(await registry.default(principal)).toEqual(project);
    }
    expect(await registry.list(principal)).toEqual({ projects: [project] });
    await rename(path, `${path}-old`); await mkdir(path);
    await expect(registry.default(principal)).rejects.toMatchObject({ code: "conflict" });
    await expect(registry.default(principal, path)).rejects.toMatchObject({ code: "conflict" });
    await expect(registry.resolve(principal, project.projectRef)).rejects.toMatchObject({ code: "conflict" });
    expect(await registry.list(principal)).toEqual({ projects: [project] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("default pointers and managed directories are scoped by workspace, owner and caller, and survive module hash updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-default-scope-"));
  try {
    const registry = createExecutionProjectRegistry(join(root, "data"));
    const scopes: ExecutionPrincipal[] = [
      principal,
      { ...principal, workspaceId: "other" },
      { ...principal, ownerId: "other" },
      { ...principal, caller: { kind: "owner" } },
      { ...principal, caller: { kind: "module", moduleId: "other", hash: "approved" } },
    ];
    const defaults = await Promise.all(scopes.map(scope => registry.default(scope)));
    expect(new Set(defaults.map(project => project.path)).size).toBe(scopes.length);
    expect(new Set(defaults.map(project => project.projectRef)).size).toBe(scopes.length);
    for (const [index, scope] of scopes.entries()) {
      expect(await registry.list(scope)).toEqual({ projects: [defaults[index]!] });
      for (const [otherIndex, project] of defaults.entries()) {
        if (index !== otherIndex) expect(await registry.resolve(scope, project.projectRef)).toBeNull();
      }
    }
    expect(await registry.default({ ...principal, caller: { kind: "module", moduleId: "coding", hash: "updated" } })).toEqual(defaults[0]);
    const custom = join(root, "custom"); await mkdir(custom);
    const changed = await registry.default(principal, custom);
    expect(await registry.default(principal)).toEqual(changed);
    for (const [index, scope] of scopes.entries()) {
      if (index > 0) expect(await registry.default(scope)).toEqual(defaults[index]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("adding a default to an existing v1 registry preserves its project grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-project-default-v1-"));
  try {
    const dataDir = join(root, "data"), path = join(root, "project"); await mkdir(path);
    const existing = await createExecutionProjectRegistry(dataDir).register(principal, path);
    const file = join(dataDir, "execution-project-registry.json"), legacy = JSON.parse(await readFile(file, "utf8"));
    delete legacy.defaults;
    await writeFile(file, JSON.stringify(legacy));
    const fresh = createExecutionProjectRegistry(dataDir), project = await fresh.default(principal);
    expect(await fresh.list(principal)).toEqual({ projects: [existing, project] });
    expect(await fresh.resolve(principal, existing.projectRef)).toMatchObject({ canonicalPath: path });
    expect(await createExecutionProjectRegistry(dataDir).default(principal)).toEqual(project);
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
