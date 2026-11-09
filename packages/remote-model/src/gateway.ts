import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { completionSSE, decodeAnswer, encodeRequest, receiptSchema, type ModelInput } from "./protocol";

export type RemoteModelGatewayInput = {
  deadlineAt: string;
  budget: { maxModelCalls: number; maxOutputTokens: number };
  /** Trusted composition binds this closure to the persisted exact delivery.
   * The request cannot choose a target, principal, provider or model. */
  model(key: string, input: ModelInput): Promise<unknown>;
};
function authorized(request: Request, token: string) {
  const auth = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${token}`);
  return auth.length === expected.length && timingSafeEqual(auth, expected);
}
function completionResponse(raw: unknown, encoded: ReturnType<typeof encodeRequest>) {
  const receipt = receiptSchema.parse(raw);
  if (receipt.status !== "completed" || receipt.result.outputTokens !== null && receipt.result.outputTokens > encoded.input.maxOutputTokens) throw new Error("Uncompleted or invalid model reservation");
  const answer = decodeAnswer(receipt.result.text, encoded.tools);
  return new Response(completionSSE(answer, receipt.reservationId), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}
/** Each instance belongs to one launch and exists only while its owned Pi tree
 * lives. Any unknown outcome latches closed. There is no automatic retry or new
 * key after pending, disconnect or provider failure. Durable accounting lives
 * exclusively in the kernel; these local checks are additional bounds. */
export function createRemoteModelGateway(input: RemoteModelGatewayInput) {
  const token = randomBytes(32).toString("hex"), deadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now() || !Number.isInteger(input.budget.maxModelCalls) || input.budget.maxModelCalls < 1 || input.budget.maxModelCalls > 60 || !Number.isInteger(input.budget.maxOutputTokens) || input.budget.maxOutputTokens < 1 || input.budget.maxOutputTokens > 32000) throw new Error("Invalid governed model launch bounds");
  let calls = 0, failed = false, busy = false;
  const error = (status: number) => Response.json({ error: { type: "chrona_gateway_error", message: "Governed completion unavailable; do not retry this execution" } }, { status });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, maxRequestBodySize: 256 * 1024,
    async fetch(request) {
      if (!authorized(request, token)) return error(401);
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") return error(404);
      if (failed || busy || calls >= input.budget.maxModelCalls || Date.now() >= deadline) return error(409);
      busy = true;
      try {
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > 256 * 1024) throw new Error("Request limit");
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const encoded = encodeRequest(JSON.parse(raw), input.budget.maxOutputTokens);
        if (Date.now() >= deadline) throw new Error("Model deadline");
        calls++;
        const key = `pi-model-${randomUUID()}`;
        // Kernel admission commits the immutable key+input before provider I/O.
        // A timeout racing the underlying call remains unknown, never replayed.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: unknown;
        try {
          result = await Promise.race([input.model(key, encoded.input), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Model deadline")), Math.max(1, deadline - Date.now())); })]);
        } finally { clearTimeout(timer); }
        if (Date.now() >= deadline) throw new Error("Model deadline");
        return completionResponse(result, encoded);
      } catch { failed = true; return error(502); }
      finally { busy = false; }
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, token, close() { failed = true; void server.stop(true); } };
}
