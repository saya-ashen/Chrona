import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createExecutionProjectRegistry } from "../../../../../../apps/server/src/config/execution-project-registry";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { projects } from "./projects";
import { testDb } from "../test-db";
import { callSync, kernelOrigin } from "../module-calls";
import { registerSystemModules } from "../system-modules";
import type { StewardPorts } from "../ports";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
test("removed public project routes stay absent while private host calls retain caller authorization", async () => {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "projects" } })).id;
  const manifest = moduleManifestSchema.parse({ name: "project-consumer", entry: "index.ts", keepAlive: true, uses: ["projects.list", "projects.register", "projects.create"], tools: [], effects: [], tests: ["test.ts"] });
  const row = await db.module.create({ data: { workspaceId, name: manifest.name, status: "active", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: row.id, hash: "v1", source: "user", manifest, status: "approved", intent: {}, report: {} } });
  const project = { projectRef: "local-project", path: "/tmp/project", label: "project" };
  const list = mock(async () => ({ projects: [project] })), register = mock(async () => project), create = mock(async () => project);
  const ports = { db, now: () => new Date(), dataDir: "/tmp/chrona-project-tools", executionProjects: { list, register, create } } as unknown as StewardPorts;
  registerSystemModules();
  const origin = { ...kernelOrigin(workspaceId), caller: { kind: "module" as const, module: row.name, moduleId: row.id, hash: "v1" } };
  const principal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: row.id, hash: "v1" } };
  for (const routedOrigin of [origin, kernelOrigin(workspaceId),
    { ...kernelOrigin(workspaceId), caller: { kind: "owner" as const, via: null } },
    { ...kernelOrigin(workspaceId), caller: { kind: "provider" as const, runId: "forged" } }]) {
    for (const [target, args] of [["projects.list", {}], ["projects.register", { path: project.path }], ["projects.create", { name: "scratch" }]] as const) {
      await expect(callSync(ports, routedOrigin, target, args)).rejects.toMatchObject({ code: "not_found" });
    }
  }
  expect(list).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  const privateCall = async (caller: typeof origin.caller | { kind: "provider"; runId: string }, name: string, args: Record<string, unknown>) => {
    const input = projects.tools.find(tool => tool.name === name)!.input?.parse(args) as Record<string, unknown> | undefined;
    return { output: await projects.handle({ ports, workspaceId, caller }, name, input ?? args) };
  };
  expect((await privateCall(origin.caller, "register", { path: project.path })).output).toEqual(project);
  expect(register).toHaveBeenCalledWith(principal, project.path);
  expect((await privateCall(origin.caller, "list", {})).output).toEqual({ projects: [project] });
  expect((await privateCall(origin.caller, "create", { name: "scratch" })).output).toEqual(project);
  expect(create).toHaveBeenLastCalledWith(principal, "scratch");
  for (const args of [{}, { name: "" }, { name: "../escape" }, { name: "/host" }, { name: "nested/name" }, { name: "a\\b" }, { name: 42 }, { name: "x".repeat(65) }, { name: "safe", path: "/forged" }, { name: "safe", ownerId: "forged" }]) {
    await expect(privateCall(origin.caller, "create", args)).rejects.toMatchObject({ name: "ZodError" });
  }
  expect(create).toHaveBeenCalledTimes(1);
  expect(projects.tools.some(tool => tool.name === "default")).toBe(false);
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: [] } } });
  await expect(privateCall(origin.caller, "register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  await expect(privateCall(origin.caller, "create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: ["projects.list", "projects.register"] } } });
  await expect(privateCall(origin.caller, "create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  const provider = { ...kernelOrigin(workspaceId), caller: { kind: "provider" as const, runId: "forged" } };
  await expect(privateCall(provider.caller, "register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  await expect(privateCall(provider.caller, "create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  expect(register).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  // Preserve the existing owner-proxy authority of approved uses:["*"] entry modules.
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: ["*"] } } });
  expect((await privateCall(origin.caller, "create", { name: "safe" })).output).toEqual(project);
  expect(create).toHaveBeenLastCalledWith({ workspaceId, ownerId: "owner", caller: { kind: "owner" } }, "safe");
  await db.module.update({ where: { id: row.id }, data: { status: "paused" } });
  await expect(privateCall(origin.caller, "list", {})).rejects.toMatchObject({ code: "forbidden" });
  await expect(privateCall(origin.caller, "create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  expect(create).toHaveBeenCalledTimes(2);
});
test("private owner project scope is derived and missing host service is unavailable", async () => {
  const list = mock(async () => ({ projects: [] }));
  const project = { projectRef: "local-project", path: "/tmp/project", label: "project" }, create = mock(async () => project);
  const context = { ports: { executionProjects: { list, create } } as unknown as StewardPorts, workspaceId: "workspace", caller: { kind: "owner" as const, via: null } };
  expect(await projects.handle(context, "list", {})).toEqual({ projects: [] });
  expect(list).toHaveBeenCalledWith({ workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } });
  expect(await projects.handle(context, "create", { name: "scratch" })).toEqual(project);
  expect(create).toHaveBeenLastCalledWith({ workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } }, "scratch");
  for (const name of ["list", "create"]) await expect(projects.handle({ ...context, ports: {} as StewardPorts }, name, {})).rejects.toMatchObject({ code: "unavailable" });
});

test("the actual private host registry canonicalizes paths and keeps grants caller-scoped", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-private-projects-"));
  try {
    const dataDir = join(root, "data"), directory = join(root, "project"), alias = join(root, "alias");
    await mkdir(directory); await symlink(directory, alias);
    const host = createExecutionProjectRegistry(dataDir);
    const principal = { workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" as const } };
    const registered = await host.register(principal, alias);
    expect(registered.path).toBe(await realpath(directory));
    expect(await host.register(principal, directory)).toEqual(registered);
    expect(await host.resolve(principal, registered.projectRef)).toMatchObject({ canonicalPath: registered.path, executor: "server" });
    const other = { ...principal, caller: { kind: "module" as const, moduleId: "other", hash: "v1" } };
    expect(await host.list(other)).toEqual({ projects: [] });
    expect(await host.resolve(other, registered.projectRef)).toBeNull();
    const created = await host.create(principal, "scratch");
    expect(created.path).toBe(await realpath(created.path));
    expect(await host.create(principal, "scratch")).toEqual(created);
    expect(await host.resolve(principal, created.projectRef)).toMatchObject({ canonicalPath: created.path });
    await expect(host.create(principal, "../escape")).rejects.toMatchObject({ code: "invalid" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
