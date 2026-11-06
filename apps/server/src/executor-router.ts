import { Hono, type Context } from "hono";
import type { z } from "zod";
import { EXECUTOR_HTTP, EXECUTOR_OWNER_HTTP, EXECUTOR_PROTOCOL, EXECUTION_HTTP_STATUS, executionIdSchema, executorRequestSchemas, executorOwnerPairSchema, executorOwnerRevokeSchema, executorOwnerIncarnationSchema, parseExecutorResponse, type ExecutorOperation, type ExecutorRequests, type ExecutorResponses, type ExecutorPrincipal, type ExecutorTarget } from "@chrona/contracts/steward";
import { createExecutorAuth, assertExecutorRequest, assertExecutorTarget, CallError, type StewardPorts } from "@chrona/engine";

export function isExecutorPath(path: string, method: string) {
  return Object.values(EXECUTOR_HTTP).some(endpoint => endpoint.path === path && endpoint.method === method);
}
export function isExecutorOwnerPath(path: string, method: string) {
  return Object.values(EXECUTOR_OWNER_HTTP).some(endpoint => endpoint.path === path && endpoint.method === method);
}
function failure(code: keyof typeof EXECUTION_HTTP_STATUS, requestId = "invalid") {
  return Response.json({ v: EXECUTOR_PROTOCOL, requestId, ok: false, error: { code, message: `Executor request ${code}`, retryable: code === "unavailable" || code === "capacity" } }, { status: EXECUTION_HTTP_STATUS[code] });
}
function errorCode(error: unknown): keyof typeof EXECUTION_HTTP_STATUS {
  return error instanceof CallError && error.code in EXECUTION_HTTP_STATUS ? error.code as keyof typeof EXECUTION_HTTP_STATUS : "unavailable";
}
function bearer(authorization: string | undefined) {
  const credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new CallError("forbidden", "Device credential rejected");
  return credential;
}
function sameTarget(a: ExecutorTarget, b: ExecutorTarget) {
  return (Object.keys(a) as (keyof ExecutorTarget)[]).every(key => a[key] === b[key]);
}
function validateIdentity(who: ExecutorPrincipal, data: ExecutorResponses[ExecutorOperation]) {
  if (!("executorId" in data)) return;
  if (data.executorId !== who.executorId || data.generation !== who.generation || !("incarnation" in data) || data.incarnation !== who.incarnation) throw new Error("Controller fence mismatch");
}
function validateCorrelation(input: ExecutorRequests[ExecutorOperation], data: ExecutorResponses[ExecutorOperation]) {
  if ("final" in input && "digest" in data && data.digest !== input.digest) throw new Error("Final digest mismatch");
  if ("questionKey" in input && "questionKey" in data) {
    if (data.questionKey !== input.questionKey || !sameTarget(data.target, input.target)) throw new Error("Question correlation mismatch");
  }

}
function validateLaunches(who: ExecutorPrincipal, data: ExecutorResponses[ExecutorOperation]) {
  if (!("launches" in data)) return;
  for (const { assignment } of data.launches) {
    if (assignment.executorId !== who.executorId || assignment.generation !== who.generation || assignment.incarnation !== who.incarnation || assignment.mapping.executorId !== who.executorId) throw new Error("Launch fence mismatch");
  }
}
function validateDrain(who: ExecutorPrincipal, data: ExecutorResponses[ExecutorOperation]) {
  if (who.mode === "active" || !("decisions" in data)) return;
  if (data.decisions.some(decision => decision.action === "report") || (who.mode === "drain" && data.reconciled)) throw new Error("Recovery response rejected");
}
function validateResponse(op: ExecutorOperation, input: ExecutorRequests[ExecutorOperation], data: ExecutorResponses[ExecutorOperation], who?: ExecutorPrincipal) {
  const envelope = parseExecutorResponse(op, input.requestId, { v: EXECUTOR_PROTOCOL, requestId: input.requestId, ok: true, data });
  if (!envelope.ok) throw new Error("Invalid controller response");
  if (who) { validateIdentity(who, envelope.data); validateDrain(who, envelope.data); validateLaunches(who, envelope.data); }
  validateCorrelation(input, envelope.data);
  return envelope;
}
async function assertReconciliationCommitted(ports: StewardPorts, who: ExecutorPrincipal, data: ExecutorResponses[ExecutorOperation]) {
  if (!("reconciled" in data) || !data.reconciled) return;
  const current = await ports.db.executionExecutor.findUnique({ where: { id: who.executorId } });
  if (!current?.reconciledAt || current.revokedAt || current.incarnation !== who.incarnation || current.generation !== who.generation) throw new CallError("unavailable", "Reconciliation not committed");
}
async function dispatch<K extends ExecutorOperation>(ports: StewardPorts, op: K, credential: string, input: ExecutorRequests[K], signal: AbortSignal) {
  const controller = ports.executorController;
  if (!controller) throw new CallError("unavailable", "Executor controller unavailable");
  if (op === "pair") return validateResponse("pair", input as ExecutorRequests["pair"], await createExecutorAuth(ports).pair(credential, input as ExecutorRequests["pair"]));
  const request = input as ExecutorRequests[Exclude<ExecutorOperation, "pair">];
  const mode = op === "final" || op === "reconcile" ? "drain" : "active";
  const auth = createExecutorAuth(ports);
  const who = op === "reconcile" ? await auth.authenticateReconcile(credential, request) : await auth.authenticate(credential, request, mode);
  await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "ExecutionExecutor" SET "id" = "id" WHERE 0`;
    await assertExecutorRequest(tx, who, op as Exclude<ExecutorOperation, "pair">, request);
  });
  // Controller ingress rechecks the same identity/target in its effect transaction.
  const call = controller[op as Exclude<ExecutorOperation, "pair">] as (who: ExecutorPrincipal, input: typeof request, signal: AbortSignal) => Promise<ExecutorResponses[K]>;
  const data = await call(who, request, signal);
  await assertReconciliationCommitted(ports, who, data);
  if ("entries" in request && "decisions" in data) {
    for (const decision of data.decisions) {
      if (request.entries.some(entry => sameTarget(entry.target, decision.target))) continue;
      // Server-retained omissions are legitimate only for this exact authenticated assignment.
      await ports.db.$transaction(tx => assertExecutorTarget(tx, who, decision.target, undefined, true));
    }
  }
  return validateResponse(op, input, data, who);
}

async function readBody(request: Request, limit: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new CallError("invalid", "Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new CallError("too_large", "Body exceeds byte budget");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CallError("invalid", "Invalid JSON body"); }
}

function ownerHandler<T>(ports: StewardPorts, schema: z.ZodType<T>, action: (owner: NonNullable<StewardPorts["executorOwner"]>, input: T) => Promise<unknown>) {
  return async (c: Context) => {
    c.header("Cache-Control", "no-store");
    try {
      const input = schema.safeParse(await readBody(c.req.raw, 4096));
      if (!input.success) return failure("invalid");
      if (!ports.executorOwner) return failure("unavailable");
      return c.json(await action(ports.executorOwner, input.data));
    } catch (error) { return failure(errorCode(error)); }
  };
}

/** Mounted before module proxy; each route has a raw stream byte limit before JSON decoding. */
export function createExecutorRouter(ports: StewardPorts) {
  const app = new Hono();
  for (const op of Object.keys(EXECUTOR_HTTP) as ExecutorOperation[]) {
    const endpoint = EXECUTOR_HTTP[op];
    app.post(endpoint.path, async c => {
      c.header("Cache-Control", "no-store");
      let requestId = "invalid";
      try {
        const credential = bearer(c.req.header("authorization"));
        const raw = await readBody(c.req.raw, endpoint.bytes);
        if (raw && typeof raw === "object" && "requestId" in raw) {
          const parsedId = executionIdSchema.safeParse(raw.requestId);
          if (parsedId.success) requestId = parsedId.data;
        }
        if (raw && typeof raw === "object" && "v" in raw && raw.v !== EXECUTOR_PROTOCOL) return failure("unsupported_version", requestId);
        const parsed = executorRequestSchemas[op].safeParse(raw);
        if (!parsed.success) return failure("invalid", requestId);
        return c.json(await dispatch(ports, op, credential, parsed.data, c.req.raw.signal));
      } catch (error) { return failure(errorCode(error), requestId); }
    });
  }
  app.post(EXECUTOR_OWNER_HTTP.pairingCodes.path, ownerHandler(ports, executorOwnerPairSchema, (owner, input) => owner.createPairing(input)));
  app.post(EXECUTOR_OWNER_HTTP.revoke.path, ownerHandler(ports, executorOwnerRevokeSchema, (owner, input) => owner.revoke(input)));
  app.post(EXECUTOR_OWNER_HTTP.incarnation.path, ownerHandler(ports, executorOwnerIncarnationSchema, (owner, input) => owner.prepareIncarnation(input)));
  return app;
}
