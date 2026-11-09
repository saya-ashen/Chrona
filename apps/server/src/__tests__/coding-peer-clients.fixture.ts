import { cp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { moduleManifestSchema, type ExecutionPorts, type ExecutionPrincipal, type ExecutionRef, type ExecutionStart, type ExecutionView } from "@chrona/contracts/steward";
import { agentFixture, kernelOrigin } from "@chrona/engine/test-support";
import { CallError, callSync, moduleSupervisor } from "@chrona/engine";
import { createScriptSandbox } from "../../../../packages/integrations/src/steward/script-sandbox";
import { createServerApp } from "../app";
import { createStewardRuntime } from "../steward-runtime";
import { resetEnvCacheForTests } from "../config/env";

export type Command = Record<string, unknown>;
export type Receipt<T = Record<string, unknown>> = { receipt: { requestKey: string; status: string; sessionId?: string; workId?: string; value: T } };
export type Conversation = { id: string; projectRef: string; currentWorkId: string | null; workIds: string[]; turns: { key: string; text: string; accepted: boolean }[] };
export type Project = { projectRef: string; path: string; label: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real SDK applications, auth, registry and SQLite event store; only execution is simulated.
 * agentFixture uses testDb({injectedAgent:false}), which creates a fresh OS-temp SQLite
 * database independently of DATABASE_URL. No provider, runtime ticking or TCP server runs.
 */
export async function codingPeerFixture() {
  const f = await agentFixture(), db = f.ports.db;
  // Fail closed before installing anything if the fixture ever stops using its own TempDB.
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(item => item.name === "main")?.file;
  if (!database || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) {
    await f.close();
    throw new Error("Coding acceptance requires its own OS-temp database");
  }
  const savedKey = process.env.API_KEY;
  process.env.API_KEY = "coding-peer-acceptance";
  resetEnvCacheForTests();
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: f.ports.dataDir, moduleSdk: f.ports.moduleSdk });
  const runtime = createStewardRuntime(db, { provider: null, dataDir: f.ports.dataDir, sandbox: { ...sandbox.health, startModule: sandbox.startModule } });
  Object.assign(runtime.ports, { agentApplication: f.ports.agentApplication, moduleBuiltinResources: f.ports.moduleBuiltinResources, moduleSdk: f.ports.moduleSdk });
  const ports = runtime.ports;
  try {
    async function install(name: "coding" | "coding-web") {
      const hash = `peer-${name}`, code = join(ports.dataDir, "platform/store", hash);
      await cp(resolve(import.meta.dir, "../../../../packages/engine/src/modules/steward/external", name), code, { recursive: true });
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
      const module = await db.module.create({ data: { workspaceId: f.workspaceId, name, status: "active", activeHash: hash } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return module;
    }
    const coding = await install("coding"), web = await install("coding-web");
    const principal: ExecutionPrincipal = { workspaceId: f.workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: coding.id, hash: coding.activeHash! } };
    const owner = { ...kernelOrigin(f.workspaceId), caller: { kind: "owner" as const, via: null } };
    const seenProjects: ExecutionPrincipal[] = [];
    const hostProjects = ports.executionProjects!;
    ports.executionProjects = {
      list(p) { seenProjects.push(structuredClone(p)); return hostProjects.list(p); },
      register(p, path) { seenProjects.push(structuredClone(p)); return hostProjects.register(p, path); },
      create(p, name) { seenProjects.push(structuredClone(p)); return hostProjects.create(p, name); },
    };
    const starts: { principal: ExecutionPrincipal; input: ExecutionStart; view: ExecutionView }[] = [];
    const sends: Command[] = [], stops: Command[] = [];
    const works = new Map<string, ExecutionView>();
    let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
    function authorize(p: ExecutionPrincipal) {
      if (!isDeepStrictEqual(p, principal)) throw new CallError("forbidden", "Fixture execution principal changed");
    }
    function view(workId: string): ExecutionView {
      const value = works.get(workId);
      if (!value) throw new CallError("not_found", "Fixture execution missing");
      return structuredClone(value);
    }
    async function state(workId: string, status: ExecutionView["status"], stopConfirmed: boolean, cancelRequested = false) {
      const value = view(workId), snapshot = await ports.executionEvents!.snapshot(principal, value);
      Object.assign(value, { status, stopConfirmed, cancelRequested }); works.set(workId, value);
      await db.run.update({ where: { id: value.runId }, data: { status: status === "completed" ? "finished" : status } });
      await db.executionAttempt.update({ where: { id: value.attemptId }, data: { stopConfirmedAt: stopConfirmed ? new Date() : null, cancelRequestedAt: cancelRequested ? new Date() : null } });
      // A terminal report without stop evidence is intentionally contradictory input to
      // the business gate. The real store correctly refuses to persist that snapshot.
      if (stopConfirmed || !["completed", "failed", "cancelled"].includes(status)) {
        await db.$transaction(tx => ports.executionEvents!.saveSnapshot(tx, principal, { ...snapshot, status, stopConfirmed, cancelRequested }));
      }
    }
    const execution: ExecutionPorts = {
      async start(p, input) {
        authorize(p);
        const old = starts.find(item => item.input.commandKey === input.commandKey);
        if (old) return view(old.view.workId);
        const grant = await ports.resolveExecutionProject!(p, input.projectRef);
        const parent = input.resumeFrom ? view(input.resumeFrom.workId) : undefined;
        const sessionId = parent?.sessionId ?? (await db.session.create({ data: { workspaceId: f.workspaceId, key: randomUUID(), source: "module", moduleId: coding.id } })).id;
        const run = await db.run.create({ data: { workspaceId: f.workspaceId, sessionId, lane: "foreground", trigger: "message", status: "running", provider: "offline-acceptance", tokenHash: randomUUID(), prompt: input.goal, cwd: grant.canonicalPath } });
        const attempt = await db.executionAttempt.create({ data: { workspaceId: p.workspaceId, ownerId: p.ownerId, callerKey: `module:${coding.id}`, moduleId: coding.id, callerHash: coding.activeHash!, workId: input.workId, commandKey: input.commandKey, requestDigest: JSON.stringify(input), runId: run.id, projectRef: input.projectRef, projectDigest: "fixture", resolvedCwd: grant.canonicalPath,
          // Agent controls delegate to the fixture instead of requiring a live Pi handle.
          executorId: "offline-acceptance", logDir: join(f.root, "logs", run.id), baseline: "snapshot:peer-acceptance", budget: input.budget } });
        const value: ExecutionView = { workId: input.workId, sessionId, runId: run.id, attemptId: attempt.id, projectRef: input.projectRef, status: "running", cancelRequested: false, stopConfirmed: false };
        await db.$transaction(tx => ports.executionEvents!.admit(tx, p, value));
        works.set(value.workId, value); starts.push({ principal: structuredClone(p), input: structuredClone(input), view: structuredClone(value) });
        if (gate) { const current = gate; gate = undefined; current.entered.resolve(); await current.release.promise; }
        return structuredClone(value);
      },
      async get(p, workId) { authorize(p); return view(workId); },
      async lookupStart(p, key) { authorize(p); const found = starts.find(item => item.input.commandKey === key); if (!found) throw new CallError("not_found", "Start missing"); return view(found.view.workId); },
      async resultSource(p, input) { authorize(p); const value = view(input.workId); if (value.runId !== input.runId || value.attemptId !== input.attemptId) throw new CallError("conflict", "Result reference changed"); const { projectRef: _p, status: _s, cancelRequested: _c, stopConfirmed: _stop, ...ref } = value; return { ...ref, baseline: { kind: "snapshot", digest: "peer-acceptance" } }; },
      async send(p, input) { authorize(p); sends.push(structuredClone(input)); },
      async cancel(p, input) { authorize(p); stops.push(structuredClone(input)); await state(input.workId, "running", false, true); return view(input.workId); },
      async answer() { throw new Error("No model questions in this execution fixture"); },
      async list() { throw new Error("Unexpected Agent-wide execution list"); },
      async admitControl() { throw new Error("Acceptance must not enter live provider controls"); },
    };
    ports.executions = execution;
    const app = await createServerApp({ steward: runtime });
    const request = async (command: Command, options: { key?: string | null; signal?: AbortSignal } = {}) => app.request("/api/coding/v1/commands", {
      method: "POST", headers: { "content-type": "application/json", ...(options.key === null ? {} : { authorization: `Bearer ${options.key ?? "coding-peer-acceptance"}` }) }, body: JSON.stringify(command), signal: options.signal,
    });
    async function http<T = Record<string, unknown>>(command: Command): Promise<T> {
      const response = await request(command), body = await response.json();
      if (response.status !== 200) {
        const runs = await db.moduleRun.findMany({ where: { moduleId: coding.id }, select: { exitCode: true, error: true } });
        throw new Error(`Coding HTTP ${response.status}: ${JSON.stringify(body)}; SDK runs=${JSON.stringify(runs)}`);
      }
      if (Object.keys(body).join() !== "result") throw new Error("Coding HTTP success must wrap exactly {result}");
      return body.result as T;
    }
    async function tool<T = Record<string, unknown>>(command: Command): Promise<T> { return (await callSync(ports, owner, "coding.command", { input: JSON.stringify(command) })).output as T; }
    async function ui<T = Record<string, unknown>>(name: string, args: Command = {}): Promise<T> { return (await callSync(ports, owner, `coding-web.${name}`, args)).output as T; }
    return { root: f.root, ports, db, coding, web, principal, seenProjects, starts, sends, stops, request, http, tool, ui, state, view,
      async directory(name: string) { const path = join(f.root, name); await mkdir(path); return path; },
      async alias(path: string) { const alias = path + "-alias"; await symlink(path, alias); return alias; },
      holdNextStart() { const next = { entered: deferred(), release: deferred() }; gate = next; return { entered: next.entered.promise, release: next.release.resolve }; },
      async message(workId: string, text: string) {
        const value = view(workId), snapshot = await ports.executionEvents!.snapshot(principal, value);
        const { workId: w, sessionId, runId, attemptId } = value;
        await ports.executionEvents!.append(principal, { workId: w, sessionId, runId, attemptId, seq: snapshot.highWatermark + 1, at: new Date().toISOString(), payload: { type: "message", messageId: `reply-${workId}`, role: "assistant", text, complete: true } });
      },
      async journal() { return JSON.parse(await readFile(join(ports.dataDir, "platform/data", coding.id, "sessions/index.json"), "utf8")); },
      async restartCoding() {
        await moduleSupervisor(ports).settleModule(coding.id);
        await tool({ op: "conversations.list" });
      },
      async detachWeb() { await moduleSupervisor(ports).settleModule(web.id); await db.module.update({ where: { id: web.id }, data: { status: "disabled" } }); },
      async close() {
        gate?.release.resolve();
        try { await runtime.stop(); } finally {
          await f.close();
          // This path was checked above; only this test's fresh database is removed.
          await rm(dirname(database), { recursive: true, force: true });
          if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
          resetEnvCacheForTests();
        }
      },
    };
  } catch (error) {
    await runtime.stop();
    await f.close();
    await rm(dirname(database), { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
    resetEnvCacheForTests();
    throw error;
  }
}

export type PeerFixture = Awaited<ReturnType<typeof codingPeerFixture>>;
export function target(sessionId: string, view: ExecutionRef) { return { sessionId, workId: view.workId, runId: view.runId, attemptId: view.attemptId }; }
