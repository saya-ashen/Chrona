import { expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { callSync, createStewardService, type StewardPorts } from "@chrona/engine";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "@chrona/engine/test-support";
import { isModulePaused, PAUSED_MODULE_NAMES } from "../../../../../packages/engine/src/modules/steward/module-availability";
import { resolveBuiltinRelease, resolveExternalRelease } from "../../../../../packages/engine/src/modules/steward/module-release";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";
import { projectsInput, projectsOutput } from "@chrona/contracts/steward";
import { handleCodingHttp, CODING_HTTP_COMMANDS_PATH } from "../../../../../packages/engine/src/modules/steward/external/coding/http";
import type { CodingContext } from "../../../../../packages/engine/src/modules/steward/external/coding/types";

mock.module("chrona", () => ({ ModelError: class extends Error { constructor(readonly code: string, message: string) { super(message); } } }));
const { handleCodingCommand } = await import("../../../../../packages/engine/src/modules/steward/external/coding/service");

// These retained applications are pause-boundary acceptance, not execution acceptance.
// Keep the expected set literal so adding/removing a pause requires an explicit test decision.
test("only Remind is paused; Mind, Coding and its Web peer remain optional applications", () => {
  expect([...PAUSED_MODULE_NAMES].sort()).toEqual(["remind"]);
  expect(isModulePaused("mind")).toBe(false);
  expect(isModulePaused("coding")).toBe(false);
  expect(isModulePaused("coding-web")).toBe(false);
});

test.each(["remind"] as const)("%s retains source but cannot be released, executed, discovered or admitted through the API", async name => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-paused-api-");
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "Pause acceptance" } })).id;
    let installs = 0;
    const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null,
      moduleExternalInstaller: async () => { installs++; throw new Error("Paused installer must never be reached"); } };
    const service = createStewardService(ports), api = service.forWorkspace(workspaceId);
    const app = createStewardAgentRoutes(ports, service);
    const peer = { server: { requestIP: () => ({ address: "127.0.0.1" }) } };
    const source = join(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/external", name, "index.ts");
    const original = await readFile(source, "utf8");
    expect(original.length).toBeGreaterThan(0);
    for (const release of [resolveBuiltinRelease, resolveExternalRelease]) {
      for (const hash of [undefined, "a".repeat(40), "b".repeat(64)]) {
        await expect(release({}, name, hash)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
      }
    }
    expect(installs).toBe(0);
    expect(await db.module.count()).toBe(0);
    expect(await db.audit.count({ where: { kind: "module_installation" } })).toBe(0);

    // Persist pre-policy approved material: discovery/admission must still enforce the pause.
    const paused = await db.module.create({ data: { workspaceId, name, activeHash: "b".repeat(64) } });
    await db.moduleVersion.create({ data: { moduleId: paused.id, hash: "b".repeat(64), status: "approved", source: "user", intent: {}, report: {},
      manifest: moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "fixture", description: "Retained tool", visibility: ["owner", "modules", "provider"], parameters: { type: "object", properties: {} } }] }) } });
    await expect(callSync(ports, { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, `${name}.fixture`, {})).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
    expect(await db.moduleRun.count()).toBe(0);
    const entry = await db.module.create({ data: { workspaceId, name: "pause-test-entry", activeHash: "a".repeat(64) } });
    await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "a".repeat(64), status: "approved", source: "user", intent: {}, report: {},
      manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["*"] }) } });
    const session = await db.session.create({ data: { workspaceId, source: "module", key: "pause-test", moduleId: entry.id } });
    await db.audit.create({ data: { id: `agent-context:${session.id}`, workspaceId, actorKey: entry.id, kind: "agent_context", subjectId: session.id, details: { hash: "a".repeat(64) } } });
    await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "No model" });
    const run = (await api.runs.claimNext("foreground"))!;
    await db.audit.create({ data: { id: `agent-tools:${run.id}`, workspaceId, actorKey: entry.id, kind: "agent_tools", subjectId: run.id, details: { targets: ["modules.tools", "modules.admit-candidates"] } } });
    const post = (tool: string, body: unknown) => app.request(`/tools/${tool}`, { method: "POST", headers: { authorization: `Bearer ${run.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }, peer);
    const search = await post("m_modules_tools", { query: name });
    expect(search.status).toBe(200);
    expect((await search.json()).data.result.some((tool: { target: string }) => tool.target.startsWith(`${name}.`))).toBe(false);
    const admission = await post("m_modules_admit_candidates", { requestKey: "paused-admission", submitter: { moduleId: entry.id, hash: "a".repeat(64) }, targets: [{ name, moduleId: paused.id, expectedActiveHash: "b".repeat(64) }] });
    expect(admission.status).toBe(503);
    expect(await admission.json()).toMatchObject({ ok: false, error: { code: "unavailable", message: expect.stringContaining("source is retained") } });
    expect(await db.audit.count({ where: { kind: "candidate_admission" } })).toBe(0);
    expect(await db.approval.count()).toBe(0);
    expect(await db.run.count({ where: { lane: "build" } })).toBe(0);
    expect(await db.moduleVersion.count()).toBe(2);
    expect(await readFile(source, "utf8")).toBe(original);
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});

// Exercise the standard HTTP adapter with the business dispatcher itself. The
// server's authenticated listener owns identity; command bodies cannot replace it.
test("HTTP and routed clients share project conversations, defaults and durable receipts", async () => {
  const dir = await mkdtemp("/tmp/chrona-coding-http-project-");
  const calls: Record<string, unknown>[] = [];
  const projects = [
    { projectRef: "repo-one", path: "/fixture/one", label: "One" },
    { projectRef: "repo-two", path: "/fixture/two", label: "Two" },
  ];
  const principal = { workspaceId: "fixture-workspace", ownerId: "owner", caller: { kind: "module", moduleId: "coding", hash: "fixture-version" } } as const;
  const context: CodingContext = { dir, content: join(dir, "public"), async call<T>(target: string, args: Record<string, unknown>): Promise<T> {
    expect(target).toBe("agent.projects"); expect(projectsInput.parse(args)).toEqual({ action: "list" });
    calls.push(structuredClone(args));
    return projectsOutput.parse({ action: "list", principal, projects }) as T;
  } };
  const http = (raw: unknown, client = context) => handleCodingHttp(new Request(`http://localhost${CODING_HTTP_COMMANDS_PATH}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw),
  }), command => handleCodingCommand(client, command));
  try {
    const listed = await http({ op: "projects.list" });
    expect(listed.status).toBe(200); expect(await listed.json()).toEqual({ result: { projects, defaultProjectRef: null } });
    const create = { op: "conversations.create", requestKey: "conversation", projectRef: "repo-one", title: "Ongoing work" };
    const created = await http(create), receipt = (await created.json()).result.receipt;
    expect(created.status).toBe(200); expect(receipt.status).toBe("accepted");
    expect(await handleCodingCommand({ ...context }, create)).toEqual({ receipt });
    const replay = await http(create, { ...context });
    expect(await replay.json()).toEqual({ result: { receipt } });
    const changed = await http({ ...create, projectRef: "repo-two" });
    expect(changed.status).toBe(409); expect(await changed.json()).toMatchObject({ error: { code: "conflict" } });
    expect((await http({ op: "projects.default", requestKey: "default", projectRef: "repo-two" })).status).toBe(200);
    const selected = await http({ op: "projects.list" });
    expect((await selected.json()).result.defaultProjectRef).toBe("repo-two");
    const conversation = await http({ op: "conversations.get", sessionId: receipt.sessionId });
    expect((await conversation.json()).result.session).toMatchObject({ projectRef: "repo-one", currentWorkId: null, workIds: [] });
    const invalid = await http({ op: "projects.list", principal: { ownerId: "owner", workspaceId: "foreign" } });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: { code: "invalid" } });
    const missing = await http({ op: "conversations.create", requestKey: "unknown", projectRef: "foreign-repo", title: "No" });
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
    expect(calls.every(args => Object.keys(args).length === 1 && args.action === "list")).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
