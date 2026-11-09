/**
 * Common Coding HTTP transport. Register with the actual SDK as
 * `chrona.serve(request => handleCodingHttp(request, raw => handleCodingCommand(context, raw)))`.
 * The SDK passes a standard Request; it has no onhttp event. Registration and
 * the manifest listen path belong to the application entry point.
 *
 * POST /api/coding/v1/commands takes the common command itself, without an HTTP
 * wrapper. Dispatch owns strict business validation (including unknown fields,
 * operation allowlisting and the protocol's smaller command size limit).
 * Success: 200 {result: <dispatch output>}. Failure: {error: {code, message}}.
 * Coded application errors preserve their public message and map to the status
 * below. Unrecognized failures become unavailable/503 with a fixed message;
 * stacks, causes and arbitrary error properties are never serialized.
 *
 * Authentication remains in the server's global /api API-key middleware. This
 * adapter never derives a principal from body fields, headers or query strings.
 * Events use the same POST command path. There is no GET polling endpoint or
 * disconnect-to-cancel behavior: only an explicit business command stops work.
 */
export const CODING_HTTP_COMMANDS_PATH = "/api/coding/v1/commands";
export const CODING_HTTP_MAX_BODY_BYTES = 256 * 1024;

const APPLICATION_STATUS = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  capacity: 429,
  too_large: 413,
  unavailable: 503,
} as const;

export type CodingHttpErrorCode = keyof typeof APPLICATION_STATUS
  | "method_not_allowed" | "unsupported_media_type" | "too_large";
export type CodingHttpResponse = { result: unknown }
  | { error: { code: CodingHttpErrorCode; message: string } };

class TransportError extends Error {
  constructor(readonly code: CodingHttpErrorCode, readonly status: number, message: string) {
    super(message);
  }
}

function failure(code: CodingHttpErrorCode, status: number, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

function applicationFailure(error: unknown): Response {
  if (error !== null && typeof error === "object" && "code" in error
    && typeof error.code === "string" && Object.hasOwn(APPLICATION_STATUS, error.code)) {
    const code = error.code as keyof typeof APPLICATION_STATUS;
    const message = "message" in error && typeof error.message === "string" && error.message.length > 0
      ? error.message : `Coding request ${code}`;
    return failure(code, APPLICATION_STATUS[code], message);
  }
  return failure("unavailable", 503, "Coding service unavailable");
}

function checkContentType(request: Request): void {
  // JSON is UTF-8. Permit the conventional charset parameter, but do not
  // reinterpret another encoding or accept a different JSON-like media type.
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(request.headers.get("content-type") ?? "")
    || !/^(?:identity)?$/i.test(request.headers.get("content-encoding") ?? "")) {
    throw new TransportError("unsupported_media_type", 415, "Expected application/json encoded as UTF-8");
  }
}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > CODING_HTTP_MAX_BODY_BYTES) {
    throw new TransportError("too_large", 413, "Coding request exceeds 256 KiB");
  }
  if (!request.body) throw new TransportError("invalid", 400, "Invalid JSON body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CODING_HTTP_MAX_BODY_BYTES) {
        throw new TransportError("too_large", 413, "Coding request exceeds 256 KiB");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Cancel only the unread request stream. This never invokes business cancel
    // and does not wait for a potentially stalled stream cancellation callback.
    void reader.cancel().catch(() => {});
    if (error instanceof TransportError) throw error;
    throw new TransportError("invalid", 400, "Invalid JSON body");
  } finally {
    reader.releaseLock();
  }
}

export async function handleCodingHttp(
  request: Request,
  dispatch: (raw: unknown) => Promise<unknown>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== CODING_HTTP_COMMANDS_PATH) return failure("not_found", 404, "Coding endpoint not found");
  if (request.method !== "POST") return failure("method_not_allowed", 405, "Expected POST", { Allow: "POST" });

  let raw: unknown;
  try {
    checkContentType(request);
    raw = await readJson(request);
  } catch (error) {
    if (error instanceof TransportError) return failure(error.code, error.status, error.message);
    return failure("invalid", 400, "Invalid JSON body");
  }
  try {
    const result = await dispatch(raw);
    // Undefined cannot be represented in the documented success envelope.
    if (result === undefined) return applicationFailure(undefined);
    return Response.json({ result });
  } catch (error) {
    return applicationFailure(error);
  }
}
