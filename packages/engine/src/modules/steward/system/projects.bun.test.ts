import { afterEach, expect, mock, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { projects } from "./projects";
import { testDb } from "../test-db";
import { callSync, kernelOrigin } from "../module-calls";
import { registerSystemModules } from "../system-modules";
import type { StewardPorts } from "../ports";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
test("routed project registration uses active module identity and its explicitly approved capability", async () => {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "projects" } })).id;
  const manifest = moduleManifestSchema.parse({ name: "project-consumer", entry: "index.ts", keepAlive: true, uses: ["projects.list", "projects.register"], tools: [], effects: [], triggers: [], tests: ["test.ts"] });
  const row = await db.module.create({ data: { workspaceId, name: manifest.name, status: "active", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: row.id, hash: "v1", source: "user", manifest, status: "approved", intent: {}, report: {} } });
  const project = { projectRef: "local-project", path: "/tmp/project", label: "project" };
  const list = mock(async () => ({ projects: [project] })), register = mock(async () => project);
  const ports = { db, now: () => new Date(), dataDir: "/tmp/chrona-project-tools", executionProjects: { list, register } } as unknown as StewardPorts;
  registerSystemModules();
  const origin = { ...kernelOrigin(workspaceId), caller: { kind: "module" as const, module: row.name, moduleId: row.id, hash: "v1" } };
  expect((await callSync(ports, origin, "projects.register", { path: project.path })).output).toEqual(project);
  expect(register).toHaveBeenCalledWith({ workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: row.id, hash: "v1" } }, project.path);
  expect((await callSync(ports, origin, "projects.list", {})).output).toEqual({ projects: [project] });
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: row.id, hash: "v1" } }, data: { manifest: { ...manifest, uses: [] } } });
  await expect(callSync(ports, origin, "projects.register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  await expect(callSync(ports, { ...kernelOrigin(workspaceId), caller: { kind: "provider", runId: "forged" } }, "projects.register", { path: project.path })).rejects.toMatchObject({ code: "forbidden" });
  expect(register).toHaveBeenCalledTimes(1);
  await db.module.update({ where: { id: row.id }, data: { status: "paused" } });
  await expect(callSync(ports, origin, "projects.list", {})).rejects.toMatchObject({ code: "forbidden" });
});
test("owner project scope is derived from routed caller; missing host service is unavailable", async () => {
  const list = mock(async () => ({ projects: [] }));
  const context = { ports: { executionProjects: { list } } as unknown as StewardPorts, workspaceId: "workspace", caller: { kind: "owner" as const, via: null } };
  expect(await projects.handle(context, "list", {})).toEqual({ projects: [] });
  expect(list).toHaveBeenCalledWith({ workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } });
  await expect(projects.handle({ ...context, ports: {} as StewardPorts }, "list", {})).rejects.toMatchObject({ code: "unavailable" });
});
