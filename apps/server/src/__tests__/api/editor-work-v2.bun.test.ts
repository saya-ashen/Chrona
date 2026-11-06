import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { localDirectoryIdentity } from "../../../../../packages/integrations/src/executor/workspaces";
import { join, resolve } from "node:path";
import { PREINSTALLED_MODULE_NAMES, EXECUTION_PROTOCOL, WORK_PROTOCOL, editorResponseDataSchemas, parseWorkResponse, type ExecutionView, type ProviderAdapter } from "@chrona/contracts/steward";
import { moduleSupervisor } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { resolveExternalRelease } from "../../../../../packages/engine/src/modules/steward/module-release";
import { createStewardRuntime } from "../../steward-runtime";
import { createServerApp } from "../../app";
import { resetEnvCacheForTests } from "../../config/env";

test("real editor SDK/module routing accepts v1 three-id history and v2 work projection", async () => {
  const root = await mkdtemp("/tmp/chrona-editor-work-v2-test-");
  const db = testDb(), savedKey = process.env.API_KEY;
  const finishes: (() => void)[] = [];
  const provider: ProviderAdapter = {
    name: "no-model-test", health: async () => ({ available: true, sandboxed: false, error: null }),
    start() {
      let finish!: () => void;
      const done = new Promise<{ outcome: "failed"; sessionId: null; error: string }>(resolve => { finish = () => resolve({ outcome: "failed", sessionId: null, error: "Test cleanup" }); });
      finishes.push(finish);
      return { done, inject: async () => {}, abort: async () => { finish(); } };
    },
  };
  let runtime: ReturnType<typeof createStewardRuntime> | undefined;
  let front: ReturnType<typeof Bun.serve> | undefined;
  try {
    process.env.API_KEY = "editor-work-v2-synthetic-test"; resetEnvCacheForTests();
    const initialization = { version: 1, status: "complete", packages: Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name => [name, { requestKey: `test:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null }])) };
    const workspace = await db.workspace.create({ data: { name: "Editor real routing test", settings: { moduleInitialization: initialization } } });
    const sourceRoot = resolve(import.meta.dirname, "../../../../..");
    const externalRoot = join(root, "external"), dataDir = join(root, "data"), project = join(root, "project");
    await mkdir(externalRoot); await mkdir(project);
    let codingId = "";
    for (const name of ["coding", "editor"]) {
      await cp(join(sourceRoot, "packages/engine/src/modules/steward/external", name), join(externalRoot, name), { recursive: true });
      const release = await resolveExternalRelease({ moduleExternalResources: externalRoot }, name);
      const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: release.hash, status: "active", dataSchema: release.manifest.data.schema } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: release.hash, manifest: release.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
      await mkdir(join(dataDir, "platform/store"), { recursive: true });
      await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
      if (name === "coding") codingId = module.id;
    }
    const bytes = "Source bytes for actual claim\r\n";
    await writeFile(join(project, "source.txt"), bytes);
    const git = (args: string[]) => {
      const result = Bun.spawnSync(["git", "-C", project, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
      if (result.exitCode !== 0) throw new Error("Temporary Git fixture failed");
      return result.stdout.toString().trim();
    };
    git(["init", "--quiet"]); git(["add", "source.txt"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "-m", "temporary fixture baseline"]);
    const baseline = { kind: "commit" as const, digest: git(["rev-parse", "HEAD"]) };
    const placement = { executorId: "server", projectRef: "v2-project", mappingRevision: 1 };
    await writeFile(join(dataDir, "execution-projects.json"), JSON.stringify({ projects: [{ workspaceId: workspace.id, ownerId: "owner", moduleId: codingId, projectRef: "project", canonicalPath: project, baseline: "snapshot:strict-history-test" }], placements: [{ workspaceId: workspace.id, ownerId: "owner", moduleId: codingId, grant: { ...placement, executor: "server", executorGeneration: 1, directoryIdentity: localDirectoryIdentity(project), baseline, label: "Temporary integration project", canonicalPath: project } }] }));
    runtime = createStewardRuntime(db, { dataDir, provider });
    runtime.ports.moduleExternalResources = externalRoot;
    await moduleSupervisor(runtime.ports).start();
    const app = await createServerApp({ steward: runtime });
    let count = 0;
    const command = async (v: string, command: object) => {
      const request = { v, requestId: `real-route-${++count}`, command };
      const response = await app.request("/api/editor/v1/commands", { method: "POST", headers: { authorization: "Bearer editor-work-v2-synthetic-test", "content-type": "application/json" }, body: JSON.stringify(request) });
      const body = await response.json();
      expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
      return { request, body };
    };
    const works = await command(WORK_PROTOCOL, { op: "list", resource: "works", limit: 10 });
    expect(parseWorkResponse({ v: WORK_PROTOCOL, requestId: works.request.requestId, command: { op: "list", resource: "works", limit: 10 } }, works.body)).toMatchObject({ ok: true, data: { resource: "works", works: [] } });
    const started = await command(EXECUTION_PROTOCOL, { op: "start", workId: "strict-history", projectRef: "project", commandKey: "strict-history-start", goal: "No model: validate strict history routing", budget: { timeoutMs: 60_000, maxToolCalls: 1 } });
    const view = editorResponseDataSchemas.start.parse(started.body.data) as ExecutionView;
    const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
    const events = await command(EXECUTION_PROTOCOL, { op: "events", ...target, limit: 10, waitMs: 0 });
    expect(editorResponseDataSchemas.events.parse(events.body.data).highWatermark).toBeGreaterThanOrEqual(0);
    const snapshot = await command(EXECUTION_PROTOCOL, { op: "snapshot", ...target });
    expect(editorResponseDataSchemas.snapshot.parse(snapshot.body.data).sessionId).toBe(view.sessionId);
    // Real Neovim client -> authenticated host -> actual SDK/coding/router/SQLite/worktree preparer.
    front = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, idleTimeout: 30 });
    const child = (id: string, dependencies: string[]) => ({ kind: "execution", workId: id, commandKey: `start-${id}`, goal: "No model: validate a fixed independent worktree", budget: { timeoutMs: 60_000, maxToolCalls: 1 }, placement, workspace: { mode: "independent_worktree", baseline, source: { files: [{ path: "source.txt", sha256: createHash("sha256").update(bytes).digest("hex") }] } }, queueExpiresAt: new Date(Date.now() + 60_000).toISOString(), dependsOnWorkIds: dependencies });
    const group = { kind: "group", workId: "nvim-parent", commandKey: "start-nvim-parent", goal: "Two children with a real dependency", children: [child("nvim-a", []), child("nvim-b", ["nvim-a"])] };
    const script = join(root, "work-client.lua"), workbench = "/home/saya/workspace/agent-workbench.nvim";
    await writeFile(script, `local Client=require("agent-workbench.chrona.client")
local Work=require("agent-workbench.chrona.work")
local Backend=require("agent-workbench.backends.chrona")
local Source=require("agent-workbench.chrona.source")
local options={url=vim.env.CHRONA_TEST_ORIGIN,project_ref="project",api_key=function() return "editor-work-v2-synthetic-test" end}
local service=Work.new(Client.new(options))
local function await(start)
 local complete,value,failure=false,nil,nil
 local sent,err=start(function(data,error) value,failure,complete=data,error,true end)
 assert(sent,err)
 assert(vim.wait(10000,function() return complete end,10),"HTTP timeout")
 assert(not failure,failure and failure.message)
 return value
end
local input=vim.json.decode(${JSON.stringify(JSON.stringify(group))})
local parent=await(function(done) return service:submit(input,{},done) end)
assert(parent.execution==vim.NIL and #parent.children==2)
local leaf=await(function(done) return service:get("nvim-a",done) end)
assert(leaf.execution~=vim.NIL and leaf.placement.executorId=="server")
assert(leaf.workspace~=vim.NIL and leaf.workspace.mode=="independent_worktree")
assert(leaf.workspace.sourceReceipt~=vim.NIL and leaf.workspace.sourceReceipt.stage=="claim")
assert(leaf.workspace.sourceReceipt.manifestDigest==Source.manifest_digest(input.children[1].workspace.source))
local blocked=await(function(done) return service:get("nvim-b",done) end)
assert(blocked.execution==vim.NIL and blocked.phase=="waiting_dependency")
local backend=Backend.new(options)
assert(backend:start(function() end))
await(function(done) return backend:attach_work("nvim-a",function(messages,error) done(messages,error and {message=error}) end) end)
await(function(done) backend:_read_snapshot(function(messages,error) done(messages,error and {message=error}) end); return true end)
assert(backend._work_view.workId=="nvim-a" and backend._view.attemptId==leaf.execution.attemptId)
backend:close()
local cancelled=await(function(done) return service:cancel(parent,done) end)
assert(cancelled.cancelRequested and (cancelled.phase=="stopping" or cancelled.phase=="cancelled"))
local sealed=await(function(done) return service:get("nvim-b",done) end)
assert(sealed.execution==vim.NIL)
service:close()
print("real-nvim-v2: group, independent tree, claim source receipt, dependency block, snapshot/get, parent cancel passed")
vim.cmd("qa!")
`);
    const nvimProcess = Bun.spawn(["nvim", "--headless", "-i", "NONE", "-u", join(workbench, "tests/minimal_init.lua"), "-l", script], { cwd: workbench, env: { ...process.env, CHRONA_TEST_ORIGIN: front.url.origin, XDG_CONFIG_HOME: join(root, "xdg/config"), XDG_DATA_HOME: join(root, "xdg/data"), XDG_STATE_HOME: join(root, "xdg/state"), XDG_CACHE_HOME: join(root, "xdg/cache") }, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => nvimProcess.kill(), 30_000);
    const code = await nvimProcess.exited;
    clearTimeout(timer);
    const output = await new Response(nvimProcess.stdout).text() + await new Response(nvimProcess.stderr).text();
    expect({ code, output: code === 0 ? "passed" : output }).toEqual({ code: 0, output: "passed" });
    expect(await db.executionAttempt.count({ where: { workId: "nvim-b" } })).toBe(0);

  } finally {
    front?.stop(true);
    for (const finish of finishes) finish();
    await runtime?.stop(); await db.$disconnect(); await rm(root, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
    resetEnvCacheForTests();
  }
}, 60_000);
