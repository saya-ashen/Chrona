import {
  EXECUTION_PROTOCOL, EDITOR_HTTP, EXECUTION_HTTP_STATUS, editorRequestSchema, editorEventsQuerySchema, executionIdSchema,
  executionJsonBytes, type ExecutionPrincipal, type ExecutionCommand,
} from "@chrona/contracts/steward";
import { chrona } from "../../../packages/integrations/src/steward/module-sdk/sdk";
import { createFakeExecutionEventStore, createFakeExecutionPorts, P1FixtureError } from "../../../packages/engine/src/modules/steward/p1-fixtures";

/** No-model endpoint only. This fixed test principal is not a production owner proof. */
export function createEditorTransportFixture(socket: string) {
  const principal: ExecutionPrincipal = { workspaceId: "probe-workspace", ownerId: "probe-owner", caller: { kind: "owner" } };
  const fake = createFakeExecutionPorts({ projects: new Map([["probe-project", { workspaceId: principal.workspaceId, ownerId: principal.ownerId, moduleId: "coding", canonicalPath: "/tmp/probe-project" }]]) });
  const events = createFakeExecutionEventStore(), shutdown = new AbortController();
  let ref: Awaited<ReturnType<typeof fake.ports.start>> | null = null, reserved = false;
  const error = (requestId: string, code: keyof typeof EXECUTION_HTTP_STATUS) => Response.json({ v: EXECUTION_PROTOCOL, requestId, ok: false, error: { code, message: code, retryable: code === "capacity" || code === "unavailable" } }, { status: EXECUTION_HTTP_STATUS[code] });
  async function consume(command: ExecutionCommand, signal: AbortSignal) {
    if (command.op === "start") {
      const { op: _op, ...start } = command;
      ref = await fake.ports.start(principal, start);
      if (!reserved) { events.reserve(principal, ref); reserved = true; }
      return ref;
    }
    if (command.op === "get" || command.op === "attach") return fake.ports.get(principal, command.workId);
    if (command.op === "lookup_start") return fake.ports.lookupStart(principal, command.commandKey);
    if (command.op === "detach") { fake.detach(); return { accepted: true }; }
    if (command.op === "events" || command.op === "snapshot") {
      const view = await fake.ports.get(principal, command.workId);
      if (view.runId !== command.runId || view.attemptId !== command.attemptId) throw new P1FixtureError("conflict");
      const target = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
      return command.op === "snapshot" ? events.store.snapshot(principal, target) : events.store.read(principal, { ...target, cursor: command.cursor, limit: command.limit, waitMs: command.waitMs, signal });
    }
    throw new Error("Unsupported fixture command");
  }
  async function readCommand(request: Request): Promise<unknown> {
    const body = await request.text();
    if (executionJsonBytes(body) > 64 * 1024) throw new Error("too_large");
    return JSON.parse(body);
  }
  function requestIdentity(raw: unknown) {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return { requestId: executionIdSchema.safeParse(value.requestId).data ?? "invalid", version: value.v };
  }
  function parseQuery(url: URL): { requestId: string; command: ExecutionCommand } | Response {
    const requestId = executionIdSchema.safeParse(url.searchParams.get("requestId")).data ?? "invalid";
    if (url.searchParams.get("v") !== EXECUTION_PROTOCOL) return error(requestId, "unsupported_version");
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) return error(requestId, "invalid");
    const parsed = editorEventsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return error(requestId, "invalid");
    const { v: _v, requestId: id, ...args } = parsed.data;
    return { requestId: id, command: { op: "events", ...args } };
  }
  async function parseBody(request: Request) {
    const raw = await readCommand(request), identity = requestIdentity(raw);
    if (identity.version !== EXECUTION_PROTOCOL) return error(identity.requestId, "unsupported_version");
    const parsed = editorRequestSchema.safeParse(raw);
    return parsed.success ? { requestId: parsed.data.requestId, command: parsed.data.command } : error(identity.requestId, "invalid");
  }
  async function fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/headers")) return Response.json({ auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), path: url.pathname }, { headers: { "set-cookie": "private=1" } });
    let requestId = "invalid";
    try {
      let parsed: Awaited<ReturnType<typeof parseBody>>;
      if (request.method === "GET" && url.pathname === EDITOR_HTTP.events) parsed = parseQuery(url);
      else if (request.method === "POST" && url.pathname === EDITOR_HTTP.commands) parsed = await parseBody(request);
      else return error(requestId, "not_found");
      if (parsed instanceof Response) return parsed;
      requestId = parsed.requestId;
      const data = await consume(parsed.command, AbortSignal.any([request.signal, shutdown.signal]));
      return Response.json({ v: EXECUTION_PROTOCOL, requestId, ok: true, data });
    } catch (caught) {
      if (caught instanceof SyntaxError) return error(requestId, "invalid");
      if (caught instanceof Error && caught.message === "too_large") return error(requestId, "too_large");
      if (caught instanceof P1FixtureError) return error(requestId, caught.code);
      throw caught;
    }
  }
  const previous = process.env.CHRONA_HTTP_SOCKET;
  process.env.CHRONA_HTTP_SOCKET = socket;
  let server: ReturnType<typeof chrona.serve>;
  try { server = chrona.serve(fetch, { idleTimeout: 30 }); }
  finally { if (previous === undefined) delete process.env.CHRONA_HTTP_SOCKET; else process.env.CHRONA_HTTP_SOCKET = previous; }
  return { server, fake, events, ref: () => ref, close() { shutdown.abort(); server.stop(true); } };
}
