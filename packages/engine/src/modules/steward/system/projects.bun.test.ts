import { afterEach, expect, mock, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { projects } from "./projects";
import { testDb } from "../test-db";
import { callSync, kernelOrigin } from "../module-calls";
import { registerSystemModules } from "../system-modules";
import type { StewardPorts } from "../ports";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
test("routed project creation requires the declared capability and derives scope from the active caller", async () => {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "projects" } })).id;
  const manifest = moduleManifestSchema.parse({ name: "project-consumer", entry: "index.ts", keepAlive: true, uses: ["projects.list", "projects.register", "projects.create"], tools: [], effects: [], triggers: [], tests: ["test.ts"] });
  const row = await db.module.create({ data: { workspaceId, name: manifest.name, status: "active", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: row.id, hash: "v1", source: "user", manifest, status: "approved", intent: {}, report: {} } });
  const project = { projectRef: "local-project", path: "/tmp/project", label: "project" };
  const list = mock(async () => ({ projects: [project] })), register = mock(async () => project), create = mock(async () => project);
  const ports = { db, now: () => new Date(), dataDir: "/tmp/chrona-project-tools", executionProjects: { list, register, create } } as unknown as StewardPorts;
  registerSystemModules();
  const origin = { ...kernelOrigin(workspaceId), caller: { kind: "module" as const, module: row.name, moduleId: row.id, hash: "v1" } };
  const principal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: row.id, hash: "v1" } };
  expect((await callSync(ports, origin, "projects.register", { path: project.path })).output).toEqual(project);
  expect(register).toHaveBeenCalledWith(principal, project.path);
  expect((await callSync(ports, origin, "projects.list", {})).output).toEqual({ projects: [project] });
  expect((await callSync(ports, origin, "projects.create", { name: "scratch" })).output).toEqual(project);
  expect(create).toHaveBeenLastCalledWith(principal, "scratch");
  for (const args of [{}, { name: "" }, { name: "../escape" }, { name: "/host" }, { name: "nested/name" }, { name: "a\\b" }, { name: 42 }, { name: "x".repeat(65) }, { name: "safe", path: "/forged" }, { name: "safe", ownerId: "forged" }]) {
    await expect(callSync(ports, origin, "projects.create", args)).rejects.toMatchObject({ code: "invalid" });
  }
  expect(create).toHaveBeenCalledTimes(1);
  expect(projects.tools.some(tool => tool.name === "default")).toBe(false);
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: [] } } });
  await expect(callSync(ports, origin, "projects.register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  await expect(callSync(ports, origin, "projects.create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: ["projects.list", "projects.register"] } } });
  await expect(callSync(ports, origin, "projects.create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  const provider = { ...kernelOrigin(workspaceId), caller: { kind: "provider" as const, runId: "forged" } };
  await expect(callSync(ports, provider, "projects.register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  await expect(callSync(ports, provider, "projects.create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  expect(register).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  // Preserve the existing owner-proxy authority of approved uses:["*"] entry modules.
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: ["*"] } } });
  expect((await callSync(ports, origin, "projects.create", { name: "safe" })).output).toEqual(project);
  expect(create).toHaveBeenLastCalledWith({ workspaceId, ownerId: "owner", caller: { kind: "owner" } }, "safe");
  await db.module.update({ where: { id: row.id }, data: { status: "paused" } });
  await expect(callSync(ports, origin, "projects.list", {})).rejects.toMatchObject({ code: "forbidden" });
  await expect(callSync(ports, origin, "projects.create", { name: "safe" })).rejects.toMatchObject({ code: "forbidden" });
  expect(create).toHaveBeenCalledTimes(2);
});
test("owner project scope comes from routing and missing host service is unavailable", async () => {
  const list = mock(async () => ({ projects: [] }));
  const project = { projectRef: "local-project", path: "/tmp/project", label: "project" }, create = mock(async () => project);
  const context = { ports: { executionProjects: { list, create } } as unknown as StewardPorts, workspaceId: "workspace", caller: { kind: "owner" as const, via: null } };
  expect(await projects.handle(context, "list", {})).toEqual({ projects: [] });
  expect(list).toHaveBeenCalledWith({ workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } });
  expect(await projects.handle(context, "create", { name: "scratch" })).toEqual(project);
  expect(create).toHaveBeenLastCalledWith({ workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } }, "scratch");
  for (const name of ["list", "create"]) await expect(projects.handle({ ...context, ports: {} as StewardPorts }, name, {})).rejects.toMatchObject({ code: "unavailable" });
});
