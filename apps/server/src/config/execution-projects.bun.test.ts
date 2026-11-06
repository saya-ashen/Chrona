import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadExecutionProjects, loadExecutionPlacements, parseExecutionProjects, parseExecutionPlacements } from "./execution-projects";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";

const principal: ExecutionPrincipal = { workspaceId: "w", ownerId: "owner", caller: { kind: "module", moduleId: "coding-id", hash: "approved-hash" } };
const project = { workspaceId: "w", ownerId: "owner", moduleId: "coding-id", projectRef: "repo", canonicalPath: "/explicit/nonexistent/project", baseline: "commit:commit-digest" };
test("project mappings bind owner/workspace/immutable module id without reading the project", async () => {
  const resolve = parseExecutionProjects({ projects: [project] });
  expect(await resolve(principal, "repo")).toEqual({ projectRef: "repo", executor: "server", canonicalPath: project.canonicalPath, baseline: project.baseline });
  for (const denied of [
    { ...principal, workspaceId: "other" }, { ...principal, ownerId: "other" },
    { ...principal, caller: { kind: "owner" as const } },
    { ...principal, caller: { kind: "module" as const, moduleId: "replacement-id", hash: "approved-hash" } },
  ]) await expect(resolve(denied, "repo")).rejects.toThrow("not configured");
  await expect(resolve(principal, "unknown")).rejects.toThrow("not configured");
  for (const raw of [{ projects: [project, project] }, { projects: [{ ...project, canonicalPath: "relative/path" }] }, { projects: [{ ...project, executor: "device" }] }, { projects: [{ ...project, baseline: "untyped-digest" }] }, { projects: [{ ...project, baseline: "commit:" }] }]) expect(() => parseExecutionProjects(raw)).toThrow();
});
test("P2 placements bind fixed device/revision and never expose or inspect a remote host path", async () => {
  const grant = { executor: "device" as const, executorId: "device", executorGeneration: 2, projectRef: "repo", mappingRevision: 3, directoryIdentity: "a".repeat(64), baseline: { kind: "commit" as const, digest: "b".repeat(40) }, label: "Selected project" };
  const config = { projects: [], placements: [{ workspaceId: "w", ownerId: "owner", moduleId: "coding-id", grant }] };
  const resolve = parseExecutionPlacements(config);
  const selection = { executorId: "device", projectRef: "repo", mappingRevision: 3 };
  expect(await resolve(principal, selection)).toEqual(grant);
  expect(await resolve.list(principal)).toEqual([selection]);
  expect(await resolve.list({ ...principal, ownerId: "other" })).toEqual([]);
  expect(await resolve.list({ ...principal, caller: { kind: "owner" } })).toEqual([]);
  expect(await resolve.list({ ...principal, caller: { kind: "module", moduleId: "other", hash: "approved-hash" } })).toEqual([]);
  const returned = await resolve(principal, selection); returned.mappingRevision = 99;
  expect((await resolve(principal, selection)).mappingRevision).toBe(3);
  await expect(resolve(principal, { ...selection, mappingRevision: 4 })).rejects.toThrow("revision");
  await expect(resolve({ ...principal, ownerId: "other" }, selection)).rejects.toThrow("not configured");
  for (const bad of [
    { ...grant, canonicalPath: "/remote/path" }, { ...grant, executorId: "server" },
    { ...grant, executor: "server", executorId: "server", canonicalPath: "relative/path" },
  ]) expect(() => parseExecutionPlacements({ ...config, placements: [{ ...config.placements[0], grant: bad }] })).toThrow();
  expect(() => parseExecutionPlacements({ ...config, placements: [config.placements[0], config.placements[0]] })).toThrow("Duplicate");
});

test("fixed owner file: missing disables, malformed fails, explicit config loads", async () => {
  const dir = await mkdtemp("/tmp/chrona-project-config-");
  try {
    expect(await loadExecutionProjects(dir)).toBeUndefined();
    expect(await loadExecutionPlacements(dir)).toBeUndefined();
    await writeFile(join(dir, "execution-projects.json"), "bad");
    await expect(loadExecutionProjects(dir)).rejects.toThrow();
    await expect(loadExecutionPlacements(dir)).rejects.toThrow();
    await writeFile(join(dir, "execution-projects.json"), JSON.stringify({ projects: [project] }));
    expect(await (await loadExecutionProjects(dir))!(principal, "repo")).toMatchObject({ canonicalPath: project.canonicalPath });
    const grant = { executor: "device" as const, executorId: "device", executorGeneration: 2, projectRef: "repo", mappingRevision: 3,
      directoryIdentity: "a".repeat(64), baseline: { kind: "commit" as const, digest: "b".repeat(40) }, label: "Selected project" };
    await writeFile(join(dir, "execution-projects.json"), JSON.stringify({ projects: [], placements: [{ workspaceId: "w", ownerId: "owner", moduleId: "coding-id", grant }] }));
    const placements = (await loadExecutionPlacements(dir))!;
    // Admission resolution uses the loaded host snapshot, without reopening the owner file in a writer transaction.
    await rm(join(dir, "execution-projects.json"));
    expect(await placements(principal, { executorId: "device", projectRef: "repo", mappingRevision: 3 })).toEqual(grant);
    await expect(placements({ ...principal, ownerId: "other" }, { executorId: "device", projectRef: "repo", mappingRevision: 3 })).rejects.toThrow("not configured");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
