import { expect, test } from "bun:test";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PREINSTALLED_MODULE_NAMES, executionEventSchema, executionSnapshotSchema } from "@chrona/contracts/steward";
import { callSync, createAgentClient, moduleSupervisor } from "@chrona/engine";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { buildExecutionContracts } from "../../../../../build/execution-contracts";
import { agentFixture } from "../../../../../packages/engine/src/modules/steward/agent-application.fixtures";
import { resolveBuiltinRelease, resolveExternalRelease } from "../../../../../packages/engine/src/modules/steward/module-release";
import { seedTestModuleRelease } from "../../../../../packages/engine/src/modules/steward/module-release-test-fixture";
import { runtimeCall, stopAgentRuns } from "../../../../../packages/engine/src/modules/steward/local-runtime";
import { createStewardRuntime } from "../../steward-runtime";

type Detail = {
  sessionId: string; workId: string; project: string; projectPath: string; output: string;
  status: string; canSend: boolean; canStop: boolean;
  messages: { id: string; author: string; content: string; status: string }[];
};
type Launch = { cwd: string; sessionId: string; sessionDir: string; prompt: string };
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  let value = await read();
  while (!ready(value) && Date.now() < deadline) { await Bun.sleep(25); value = await read(); }
  if (!ready(value)) throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
  return value;
}

/** Real service, Agent SDK, Pi adapter, Coding SDK and SQLite. Only the external Pi executable is controlled. */
test("first Coding send provisions a default project and persists the real Agent reply across SDK/runtime restart with independent project contexts", async () => {
  const f = await agentFixture();
  let db = f.ports.db;
  const [{ file: databaseFile }] = await db.$queryRawUnsafe<{ file: string }[]>("PRAGMA database_list");
  let runtime: ReturnType<typeof createStewardRuntime> | undefined;
  const errors: unknown[] = [];
  try {
    await db.run.delete({ where: { id: "agent-run" } });
    await db.workspace.update({ where: { id: f.workspaceId }, data: { settings: {
      moduleInitialization: { version: 1, status: "complete", packages: Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name => [name, {
        requestKey: `coding-flow:${name}`, attempts: 1, status: "skipped", moduleId: null, hash: null, approvalId: null, error: null,
      }])) },
    } } });
    // Replace only this fixture's executable, never a Provider or its detail/event callbacks.
    const launchesFile = join(f.root, "fake-pi-launches.jsonl");
    await writeFile(join(f.root, "pi"), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if(process.argv.includes('--version')) { console.log('0.85.0'); process.exit(0); }
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const sessionId=arg('--session-id'), sessionDir=arg('--session-dir');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
let streaming=false, buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){
 const command=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
 const data=command.type==='get_state'?{sessionId,isStreaming:streaming,isCompacting:false,pendingMessageCount:0}:command.type==='get_commands'?{commands:[]}:{};
 emit({type:'response',id:command.id,command:command.type,success:true,data});
 if(command.type==='prompt'){
  appendFileSync(${JSON.stringify(launchesFile)},JSON.stringify({cwd:process.cwd(),sessionId,sessionDir,prompt:command.message})+'\\n');
  streaming=true;emit({type:'agent_start'});
  const text=command.message.includes('second-project-goal')?'Second project reply: independent context.':'Default project reply: persisted through real callbacks.';
  emit({type:'message_start',message:{role:'assistant'}});
  emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:text}});
  emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}});
  streaming=false;emit({type:'agent_end'});emit({type:'agent_settled'});
 }
 if(command.type==='abort'){streaming=false;emit({type:'agent_end'});emit({type:'agent_settled'});}
}});
process.stdin.on('end',()=>process.exit(0));
`, { mode: 0o755 });

    // Use the actual Web manifest and handler so Coding's page registration is validated too.
    const resources = f.ports.moduleBuiltinResources!;
    await cp(resolve(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/builtin/web"), join(resources, "web"), { recursive: true });
    await seedTestModuleRelease(resources, "web");
    const webRelease = await resolveBuiltinRelease(f.ports, "web");
    const web = await db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: f.workspaceId, name: "web" } } });
    await db.moduleVersion.create({ data: { moduleId: web.id, hash: webRelease.hash, manifest: webRelease.manifest, source: "builtin", intent: {}, report: {}, status: "approved" } });
    await db.module.update({ where: { id: web.id }, data: { activeHash: webRelease.hash } });
    await cp(webRelease.codeDir, join(f.ports.dataDir, "platform/store", webRelease.hash), { recursive: true });

    const external = join(f.root, "external");
    // The official contract generator expects both execution applications in its private output root.
    for (const name of ["coding", "editor"]) await cp(resolve(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/external", name), join(external, name), { recursive: true });
    expect(await buildExecutionContracts(external)).toEqual(["coding", "editor"]);
    await seedTestModuleRelease(external, "coding");
    const release = await resolveExternalRelease({ moduleExternalResources: external }, "coding");
    const coding = await db.module.create({ data: { workspaceId: f.workspaceId, name: "coding", activeHash: release.hash, status: "active", dataSchema: release.manifest.data.schema } });
    await db.moduleVersion.create({ data: { moduleId: coding.id, hash: release.hash, manifest: release.manifest, source: "user", intent: {}, report: {}, status: "approved" } });
    await cp(release.codeDir, join(f.ports.dataDir, "platform/store", release.hash), { recursive: true });

    function boot() {
      const next = createStewardRuntime(db, { dataDir: f.ports.dataDir, sandbox: f.ports.sandbox, provider: null, onError: error => { errors.push(error); } });
      Object.assign(next.ports, { moduleBuiltinResources: resources, moduleExternalResources: external, moduleSdk: f.ports.moduleSdk, agentApplication: f.ports.agentApplication });
      next.ports.provider = createAgentClient(() => next.ports, "pi");
      // Intentionally bind the supervisor to ORIGINAL ports before service.tick runs on Object.create-derived ports.
      moduleSupervisor(next.ports);
      return next;
    }
    runtime = boot();
    const ownerCall = async <T>(tool: string, args: Record<string, unknown> = {}) => {
      const response = await callSync(runtime!.ports, { workspaceId: f.workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, `coding.${tool}`, args);
      return response.output as T;
    };
    const detail = (sessionId: string) => ownerCall<Detail>("ui-work", { "session-id": sessionId });
    const command = (args: Record<string, string>) => ownerCall<Detail>("ui-command", args);
    const launches = async (): Promise<Launch[]> => (await readFile(launchesFile, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const assistant = (value: Detail) => value.messages.filter(message => message.author === "编码助手");
    const firstReply = "Default project reply: persisted through real callbacks.";
    const secondReply = "Second project reply: independent context.";

    // Start Agent on original ports first: this is the callback-dispatch scope that used to lose replies.
    expect(await runtimeCall(runtime.ports, f.workspaceId, "agent.health", {})).toMatchObject({ available: true });
    await expect(readFile(join(f.ports.dataDir, "execution-project-registry.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await db.executionAttempt.count()).toBe(0);
    const first = await command({ action: "create", "request-key": "default-first", text: "first-project-goal: reply in this temporary project" });
    expect(first.sessionId).not.toBe("");
    expect(first.project).not.toBe("");
    const firstDone = await until(() => detail(first.sessionId), value => value.status === "已完成" && value.output === firstReply, "default project's final reply in actual ui-work");
    expect(firstDone).toMatchObject({ canSend: true, canStop: false });
    expect(assistant(firstDone)).toEqual([expect.objectContaining({ content: firstReply, status: "" })]);
    expect(firstDone.messages.filter(message => message.author === "你").map(message => message.content)).toEqual(["first-project-goal: reply in this temporary project"]);
    await runtime.service.tick.settled({ includeRuns: true });
    const firstAttempt = await db.executionAttempt.findFirstOrThrow({ where: { workId: first.workId }, include: { run: true } });
    expect(firstAttempt).toMatchObject({ moduleId: coding.id, callerKey: `module:${coding.id}`, callerHash: release.hash, resolvedCwd: firstDone.projectPath, heldDirectory: null });
    expect(firstAttempt.stopConfirmedAt).not.toBeNull();
    expect(firstAttempt.run.status).toBe("finished");
    expect(firstDone.projectPath.startsWith(join(f.root, "workspaces") + "/")).toBe(true);
    expect(await realpath(firstDone.projectPath)).toBe(firstDone.projectPath);

    // Assert authenticated callback dispatch and its SQLite effects independently of Coding's cache.
    const callbacks = await db.moduleInvocation.findMany({ where: { target: "runtime-callback", tool: "event" } });
    expect(callbacks.length).toBeGreaterThan(0);
    expect(callbacks.every(row => row.callerModuleId === f.module.id && row.status === "succeeded")).toBe(true);
    const events = (await db.executionDetail.findMany({ where: { attemptId: firstAttempt.id }, orderBy: { seq: "asc" } })).map(row => executionEventSchema.parse(row.event));
    expect(events.some(event => event.payload.type === "message" && event.payload.role === "assistant" && event.payload.complete && event.payload.text === firstReply)).toBe(true);
    expect(events.every(event => event.runId === firstAttempt.runId && event.attemptId === firstAttempt.id && event.sessionId === firstAttempt.run.sessionId)).toBe(true);
    const storedSnapshot = executionSnapshotSchema.parse((await db.executionSnapshot.findUniqueOrThrow({ where: { attemptId: firstAttempt.id } })).snapshot);
    expect(storedSnapshot).toMatchObject({ status: "completed", stopConfirmed: true, missing: false, finalMessage: { text: firstReply } });
    expect(await launches()).toEqual([expect.objectContaining({ cwd: firstDone.projectPath, sessionDir: firstAttempt.logDir })]);

    // Follow the registered Web data source and message binding, not an invented test renderer.
    await moduleSupervisor(runtime.ports).start();
    const pages = await until(async () => {
      try { return JSON.parse(await readFile(join(f.ports.dataDir, "platform/data", web.id, "pages.json"), "utf8")) as { pages: { moduleId: string; data: { detail: { tool: string } }; spec: { elements: Record<string, unknown> } }[] }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pages: [] }; throw error; }
    }, value => value.pages.some(page => page.moduleId === coding.id), "actual Coding page registered with Web");
    const page = pages.pages.find(page => page.moduleId === coding.id)!;
    expect(page.data.detail.tool).toBe("ui-work");
    expect(page.spec.elements.messages).toMatchObject({ repeat: { statePath: "/detail/messages" }, children: ["messageItem"] });
    expect(page.spec.elements.messageItem).toMatchObject({ type: "Message", children: expect.arrayContaining(["messageBody"]) });
    expect(page.spec.elements.messageBody).toMatchObject({ type: "Markdown", props: { content: { $item: "content" } } });
    expect(assistant(await detail(first.sessionId)).map(message => message.content)).toEqual([firstReply]);

    // Shut down actual SDK subprocesses; rebuild the service and registry against the same temp SQLite/files.
    await runtime.stop();
    await db.$disconnect();
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${databaseFile}` }) });
    runtime = boot();
    await moduleSupervisor(runtime.ports).start();
    const reread = await detail(first.sessionId);
    expect(reread).toMatchObject({ sessionId: first.sessionId, workId: first.workId, project: first.project, projectPath: firstDone.projectPath, output: firstReply, status: "已完成" });
    expect(reread.messages).toEqual(firstDone.messages);
    expect(await launches()).toHaveLength(1); // Reads and restart must never start another model operation.
    expect(await ownerCall("ui-catalog")).toMatchObject({ defaultProject: first.project, projectGroups: [expect.objectContaining({ projectRef: first.project, sessions: [expect.objectContaining({ id: first.sessionId })] })] });

    // Select a second temp project through Coding's own UI command, then start a fresh conversation.
    const secondPath = join(f.root, "second-project");
    await mkdir(secondPath);
    await writeFile(join(secondPath, "AGENTS.md"), "SECOND_PROJECT_RULE_ONLY\n");
    await command({ action: "default-project", "request-key": "second-default", path: secondPath });
    const second = await command({ action: "create", "request-key": "second-first", text: "second-project-goal: reply independently" });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.project).not.toBe(first.project);
    const secondDone = await until(() => detail(second.sessionId), value => value.status === "已完成" && value.output === secondReply, "second project's independent reply");
    expect(secondDone.projectPath).toBe(await realpath(secondPath));
    expect(assistant(secondDone).map(message => message.content)).toEqual([secondReply]);
    expect(secondDone.messages.some(message => message.content.includes(firstReply) || message.content.includes("first-project-goal"))).toBe(false);
    await runtime.service.tick.settled({ includeRuns: true });
    const secondAttempt = await db.executionAttempt.findFirstOrThrow({ where: { workId: second.workId }, include: { run: true } });
    expect(secondAttempt.run.sessionId).not.toBe(firstAttempt.run.sessionId);
    expect(secondAttempt.logDir).not.toBe(firstAttempt.logDir);
    const recorded = await launches();
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ cwd: secondDone.projectPath, sessionDir: secondAttempt.logDir });
    expect(recorded[1]!.sessionId).not.toBe(recorded[0]!.sessionId);
    expect(recorded[1]!.cwd).toBe(await realpath(secondPath));
    expect(recorded[1]!.prompt).toContain("use native file tools to read AGENTS.md relative to the actual execution cwd");
    expect(recorded[1]!.prompt).toContain("Read it again each round");
    expect(recorded[1]!.prompt).not.toContain("SECOND_PROJECT_RULE_ONLY");
    expect(await readFile(join(recorded[1]!.cwd, "AGENTS.md"), "utf8")).toBe("SECOND_PROJECT_RULE_ONLY\n");
    expect(recorded[1]!.prompt).not.toContain("first-project-goal");
    expect((await detail(first.sessionId)).messages).toEqual(firstDone.messages);
    expect((await detail(second.sessionId)).messages).toEqual(secondDone.messages);
    expect(await db.executionAttempt.count()).toBe(2);
    const catalog = await ownerCall<{ defaultProject: string; projectGroups: { projectRef: string; sessions: { id: string }[] }[] }>("ui-catalog");
    expect(catalog.defaultProject).toBe(second.project);
    expect(catalog.projectGroups.find(group => group.projectRef === first.project)?.sessions.map(session => session.id)).toEqual([first.sessionId]);
    expect(catalog.projectGroups.find(group => group.projectRef === second.project)?.sessions.map(session => session.id)).toEqual([second.sessionId]);
    expect(errors).toEqual([]);
  } finally {
    if (runtime) { await stopAgentRuns(runtime.ports); await runtime.stop(); }
    await db.$disconnect();
    await f.close();
  }
}, 90_000);
