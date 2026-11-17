import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { CallError, createExecutionDelivery, kernelExecutionCleanup, resolveExecutionPrincipal, type StewardPorts } from "@chrona/kernel";
import { executionAuthorityApprovalSchema, kernelCleanupInputSchema } from "@chrona/contracts/steward";
import { readEnv } from "./config/env";
import { callRemoteExecution, remoteExecutionReceiver } from "./remote-execution-binding";

const DEVICE = "/api/remote-execution/device/v1/";
const OWNER = "/api/remote-execution/owner/v1/";
const operations = ["pair", "poll", "report", "reconcile", "model"] as const;
const ownerTools = ["pairing-create", "mapping-set", "device-revoke", "status"] as const;
const MAX_BODY = 524_288;
export function isRemoteExecutionDevicePath(path: string, method: string) {
  return method === "POST" && operations.some(operation => path === `${DEVICE}${operation}`);
}
export function isRemoteExecutionOwnerPath(path: string, method: string) {
  return method === "POST" && ["authority", "cleanup", ...ownerTools].some(operation => path === `${OWNER}${operation}`);
}
function ownerAuthorized(authorization: string | undefined) {
  const key = readEnv().API_KEY;
  if (!key?.trim()) throw new CallError("unavailable", "Owner authentication is unconfigured");
  const actual = Buffer.from(authorization ?? ""), expected = Buffer.from(`Bearer ${key}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new CallError("forbidden", "Owner authentication required");
}
function bearer(authorization: string | undefined) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization ?? "");
  if (!match) throw new CallError("forbidden", "Device authentication required");
  return match[1]!;
}
/** Count actual streamed bytes before decoding; Content-Length is never trusted. */
async function body(request: Request) {
  if (!request.body) throw new CallError("invalid", "Request body required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel().catch(() => {}); throw new CallError("too_large", "Request body exceeds byte limit"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(), value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return { text, value: value as Record<string, unknown> };
  } catch { throw new CallError("invalid", "Invalid JSON request"); }
}
function failure(error: unknown) {
  const code = error instanceof CallError ? error.code : "unavailable";
  const status = code === "too_large" ? 413 : code === "invalid" ? 400 : code === "forbidden" ? 403 : code === "conflict" ? 409 : 503;
  return Response.json({ code: `REMOTE_EXECUTION_${code.toUpperCase()}` }, { status, headers: { "Cache-Control": "no-store" } });
}
export function createRemoteExecutionRouter(ports: StewardPorts) {
  const app = new Hono();
  for (const operation of operations) app.post(`${DEVICE}${operation}`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      if (!isRemoteExecutionDevicePath(c.req.path, c.req.method)) throw new CallError("forbidden", "Invalid ingress path");
      const credential = bearer(c.req.header("authorization")), input = await body(c.req.raw);
      for (const key of ["credential", "caller", "ownerId", "workspaceId", "app", "receiver"]) if (Object.hasOwn(input.value, key)) throw new CallError("invalid", "Host identity fields are not device input");
      // Preserve the original member text: the application's strict parser still detects duplicate keys.
      const members = input.text.slice(1, -1).trim();
      const forwarded = `{"credential":${JSON.stringify(credential)}${members ? `,${members}` : ""}}`;
      return Response.json(await callRemoteExecution(ports, `device-${operation}`, forwarded), { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
  });
  for (const tool of ownerTools) app.post(`${OWNER}${tool}`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      ownerAuthorized(c.req.header("authorization"));
      return Response.json(await callRemoteExecution(ports, tool, (await body(c.req.raw)).text, "owner"), { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
  });
  app.post(`${OWNER}cleanup`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      ownerAuthorized(c.req.header("authorization"));
      const parsed = kernelCleanupInputSchema.safeParse((await body(c.req.raw)).value);
      if (!parsed.success) throw new CallError("invalid", "Invalid execution cleanup request");
      const principal = await resolveExecutionPrincipal(ports, "ws_default", { kind: "owner", via: null });
      return Response.json(await kernelExecutionCleanup(ports, principal, parsed.data), { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
  });
  app.post(`${OWNER}authority`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      ownerAuthorized(c.req.header("authorization"));
      const parsed = executionAuthorityApprovalSchema.safeParse((await body(c.req.raw)).value);
      if (!parsed.success) throw new CallError("invalid", "Invalid execution authority approval");
      const receiver = await remoteExecutionReceiver(ports);
      if (Object.entries(receiver).some(([key, value]) => parsed.data.receiver[key as keyof typeof receiver] !== value)) throw new CallError("conflict", "Authority receiver is not the activated application");
      const principal = await resolveExecutionPrincipal(ports, receiver.workspaceId, { kind: "owner", via: null });
      return Response.json(await createExecutionDelivery(ports).approveAuthority(principal, parsed.data), { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
  });
  return app;
}
