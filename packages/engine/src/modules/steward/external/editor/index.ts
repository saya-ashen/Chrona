import { chrona } from "chrona";
import { EDITOR_HTTP, EXECUTION_PROTOCOL, EXECUTION_HTTP_STATUS, editorRequestSchema, executionIdSchema, type ExecutionError, WORK_PROTOCOL, WORK_LIMITS, workRequestSchema, parseWorkResponse, type ExecutionEventPage } from "./contract.js";
import { handleEditorCommand, parseEditorEventsQuery, handleWorkEditorRequest } from "./protocol";
import { pollEditorEvents } from "./poll";

function failure(requestId: string, error: unknown, version: string = EXECUTION_PROTOCOL) {
  const value = error as { code?: string; retryAfterMs?: number } | null;
  const code: ExecutionError["code"] = value?.code && Object.hasOwn(EXECUTION_HTTP_STATUS, value.code) ? value.code as ExecutionError["code"] : "unavailable";
  const retryable = code === "capacity" || code === "unavailable";
  const retryAfterMs = code === "capacity" && typeof value?.retryAfterMs === "number" ? Math.min(60_000, Math.max(0, value.retryAfterMs)) : undefined;
  return Response.json({ v: version, requestId, ok: false, error: { code, message: `Editor request ${code}`, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } }, {
    status: EXECUTION_HTTP_STATUS[code], headers: retryAfterMs === undefined ? {} : { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
  });
}
function invalid(code = "invalid") { return Object.assign(new Error(code), { code }); }
function requestId(value: unknown) {
  const parsed = executionIdSchema.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}
async function postWorkCommand(request: Request, input: import("./contract.js").WorkRequest) {
    const data = input.command.op === "events"
      ? await pollEditorEvents(request, input.command, async command => {
        const read = { ...input, command };
        const response = parseWorkResponse(read, { v: WORK_PROTOCOL, requestId: input.requestId, ok: true, data: await handleWorkEditorRequest(read) });
        if (!response.ok) throw invalid(response.error.code);
        return response.data as ExecutionEventPage;
      })
      : await handleWorkEditorRequest(input);
    return parseWorkResponse(input, { v: WORK_PROTOCOL, requestId: input.requestId, ok: true, data });
}
async function decodeCommandBody(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw invalid();
  let raw: unknown;
  let text: string;
  try { text = await request.text(); raw = JSON.parse(text); } catch { throw invalid(); }
  return { raw, text };
}
async function postCommand(request: Request, setId: (id: string) => void, setVersion: (version: string) => void) {
  const { raw, text } = await decodeCommandBody(request);
  const body = raw as { requestId?: unknown; v?: unknown } | null;
  setId(requestId(body?.requestId));
  if (body?.v === WORK_PROTOCOL) {
    setVersion(WORK_PROTOCOL);
    if (Buffer.byteLength(text) > WORK_LIMITS.requestBytes) throw invalid("too_large");
    const parsedWork = workRequestSchema.safeParse(raw);
    if (!parsedWork.success) throw invalid();
    return postWorkCommand(request, parsedWork.data);
  }
  if (typeof body?.v === "string" && body.v !== EXECUTION_PROTOCOL) throw invalid("unsupported_version");
  const parsed = editorRequestSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const command = parsed.data.command;
  return command.op === "events" ? pollEditorEvents(request, command) : handleEditorCommand(command);
}
export async function handler(request: Request): Promise<Response> {
  let id = "invalid", version: string = EXECUTION_PROTOCOL;
  try {
    const url = new URL(request.url);
    if (url.pathname === EDITOR_HTTP.commands && request.method === "POST") {
      const data = await postCommand(request, value => { id = value; }, value => { version = value; });
      return Response.json(version === WORK_PROTOCOL ? data : { v: EXECUTION_PROTOCOL, requestId: id, ok: true, data });
    }
    if (url.pathname === EDITOR_HTTP.events && request.method === "GET") {
      id = requestId(url.searchParams.get("requestId"));
      if (url.searchParams.getAll("v").length === 1 && url.searchParams.get("v") !== EXECUTION_PROTOCOL) throw invalid("unsupported_version");
      let query;
      try { query = parseEditorEventsQuery(url.searchParams); } catch (error) {
        if ((error as { code?: string }).code === "invalid") throw error;
        throw invalid();
      }
      const { v: _v, requestId: _requestId, ...input } = query;
      const data = await pollEditorEvents(request, { op: "events", ...input });
      return Response.json({ v: EXECUTION_PROTOCOL, requestId: id, ok: true, data });
    }
    throw invalid("not_found");
  } catch (error) { return failure(id, error, version); }
}
chrona.serve(handler, { idleTimeout: 30 });
