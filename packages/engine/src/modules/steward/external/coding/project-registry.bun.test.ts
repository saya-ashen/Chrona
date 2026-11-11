import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingContext } from "./types";

mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { listProjects, mutateProject } = await import("./projects");
const { createManagedProjectDirectory, readProjectRegistry, resolveCodingProject, verifyCodingProject } = await import("./project-registry");

async function fixture(run: (context: CodingContext, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "coding-registry-"));
  const context: CodingContext = { dir: join(root, "coding"), content: join(root, "public"), async call() { throw new Error("Project registry must not invoke Agent"); } };
  await mkdir(context.dir);
  try { await run(context, root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("identity resolution persists dev/inode, canonicalizes registration aliases and keeps identity private", () => fixture(async (context, root) => {
  const path = join(root, "repo"), alias = join(root, "alias"); await mkdir(path); await symlink(path, alias);
  const project = await mutateProject(context, { action: "register", path: alias });
  const info = await stat(path, { bigint: true });
  const identity = { projectRef: project.projectRef, path, identity: `${info.dev}:${info.ino}` };
  expect(await resolveCodingProject({ ...context }, project.projectRef)).toEqual(identity);
  await verifyCodingProject(identity);
  expect(await mutateProject(context, { action: "register", path })).toEqual(project);
  expect(await listProjects(context)).toEqual([project]);
  expect(project).not.toHaveProperty("identity");
  expect(await readProjectRegistry(context)).toEqual([{ ...project, identity: identity.identity }]);
  await expect(resolveCodingProject(context, "foreign")).rejects.toMatchObject({ code: "not_found" });
}));

test.each(["replace", "remove", "symlink", "file"])("resolution and registration reject a persisted directory changed by %s", change => fixture(async (context, root) => {
  const path = join(root, "repo"); await mkdir(path);
  const project = await mutateProject(context, { action: "register", path });
  const identity = await resolveCodingProject(context, project.projectRef);
  await rename(path, `${path}-old`);
  if (change === "replace") await mkdir(path);
  if (change === "symlink") await symlink(`${path}-old`, path);
  if (change === "file") await writeFile(path, "replacement");
  await expect(resolveCodingProject(context, project.projectRef)).rejects.toMatchObject({ code: "conflict" });
  await expect(verifyCodingProject(identity)).rejects.toMatchObject({ code: "conflict" });
  if (change === "replace") await expect(mutateProject(context, { action: "register", path })).rejects.toMatchObject({ code: "conflict" });
  expect(await listProjects(context)).toEqual([project]);
}));

test.each(["data", "root", "project"])("managed filesystem helper rejects %s symlinks before creating children", level => fixture(async (context, root) => {
  const outside = join(root, "outside"); await mkdir(outside);
  const path = level === "data" ? context.dir : level === "root" ? join(context.dir, "managed-projects") : join(context.dir, "managed-projects", "New");
  if (level === "data") await rename(context.dir, `${context.dir}-old`);
  if (level === "project") await mkdir(join(context.dir, "managed-projects"));
  await symlink(outside, path);
  await expect(createManagedProjectDirectory(context, "New")).rejects.toMatchObject({ code: "conflict" });
  expect(await readdir(outside)).toEqual([]);
}));

test("an ordinary directory left by a pre-registry crash is recovered with its original contents and identity", () => fixture(async context => {
  const path = join(context.dir, "managed-projects", "Recovered"); await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(path, "keep.txt"), "keep");
  const info = await stat(path, { bigint: true });
  const project = await mutateProject(context, { action: "create", name: "Recovered" });
  expect(await resolveCodingProject(context, project.projectRef)).toEqual({ projectRef: project.projectRef, path, identity: `${info.dev}:${info.ino}` });
  expect(await readFile(join(path, "keep.txt"), "utf8")).toBe("keep");
  expect(await readdir(path)).toEqual(["keep.txt"]);
}));

test("invalid, duplicate and oversized persisted registries fail closed", () => fixture(async context => {
  const project = await mutateProject(context, { action: "create", name: "First" });
  const [row] = await readProjectRegistry(context), file = join(context.dir, "sessions", "projects.json");
  for (const raw of [{}, [project], [{ ...row, identity: "unknown" }], [{ ...row, path: "relative" }], [{ ...row, path: `${row!.path}/..` }], [{ ...row, extra: true }], [row, row], [row, { ...row, projectRef: "different" }], Array.from({ length: 101 }, (_, index) => ({ ...row, projectRef: `project-${index}`, path: `${row!.path}-${index}` }))]) {
    await writeFile(file, JSON.stringify(raw));
    await expect(listProjects(context)).rejects.toMatchObject({ code: "conflict" });
  }
}));
