import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchCatalog, workbenchCommand, workbenchDetail } from "./external/coding/workbench";
import type { CodingContext } from "./external/coding/storage";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "chrona-coding-project-policy-")); directories.push(dir);
  const projects: { projectRef: string; path: string; label: string }[] = [];
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const context: CodingContext = { dir, content: join(dir, "content"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
    calls.push({ target, args });
    if (target === "projects.list") return { projects } as T;
    if (target === "projects.create" || target === "projects.register") {
      const path = target === "projects.create" ? "/host/managed/default" : String(args.path);
      let project = projects.find(project => project.path === path);
      if (!project) { project = { projectRef: `project-${projects.length}`, path, label: path.split("/").at(-1)! }; projects.push(project); }
      return project as T;
    }
    throw new Error(`Unexpected call ${target}`);
  } };
  return { context, projects, calls, selection: join(dir, "sessions", "project.json") };
}
test("coding provisions ready-to-send space once and restores its private default after restart", async () => {
  const f = await fixture();
  const catalogs = await Promise.all(Array.from({ length: 4 }, () => workbenchCatalog(f.context)));
  expect(catalogs.every(catalog => catalog.defaultProject === "project-0")).toBe(true);
  expect(f.calls.filter(call => call.target === "projects.create")).toEqual([{ target: "projects.create", args: { name: "default" } }]);
  expect(catalogs[0]!.projectGroups).toEqual([{ projectRef: "project-0", path: "/host/managed/default", label: "默认空间", isDefault: true, selected: true, sessions: [], hasSessions: false }]);
  expect(JSON.parse(await readFile(f.selection, "utf8"))).toEqual({ version: 1, projectRef: "project-0", automatic: true });
  const restored = await workbenchDetail({ ...f.context }, "", "", "");
  expect(restored).toMatchObject({ project: "project-0", projectPath: "/host/managed/default", canSend: true, sessionId: "" });
  expect(f.calls.filter(call => call.target === "projects.create")).toHaveLength(1);
  expect(f.calls.some(call => call.target === "projects.default")).toBe(false);
});
test("choosing a default registers the directory but persists pointer policy only in coding", async () => {
  const f = await fixture(); await workbenchCatalog(f.context);
  await workbenchCommand(f.context, { action: "default-project", "request-key": "choose", path: "/host/custom" });
  expect(JSON.parse(await readFile(f.selection, "utf8"))).toEqual({ version: 1, projectRef: "project-1", automatic: false });
  expect(f.calls.filter(call => call.target === "projects.register")).toEqual([{ target: "projects.register", args: { path: "/host/custom" } }]);
  const restored = await workbenchCatalog({ ...f.context });
  expect(restored.defaultProject).toBe("project-1");
  expect(restored.projectGroups.find(project => project.projectRef === "project-1")).toMatchObject({ label: "custom", isDefault: true });
  expect(f.calls.filter(call => call.target === "projects.create")).toHaveLength(1);
});
test.each(["missing-grant", "invalid-json", "invalid-state"])("unavailable private default (%s) remains visible and never silently provisions a replacement", async kind => {
  const f = await fixture(); await workbenchCatalog(f.context);
  if (kind === "missing-grant") f.projects.splice(0);
  else await writeFile(f.selection, kind === "invalid-json" ? "{" : JSON.stringify({ version: 1, projectRef: "project-0", automatic: true, path: "/forged" }));
  const catalog = await workbenchCatalog({ ...f.context });
  expect(catalog.defaultProject).toBe("");
  expect(catalog.notice).toContain("默认空间暂不可用");
  expect(f.calls.filter(call => call.target === "projects.create")).toHaveLength(1);
  await workbenchCommand(f.context, { action: "default-project", "request-key": "recover", path: "/host/recovered" });
  expect((await workbenchCatalog(f.context)).defaultProject).not.toBe("");
});
