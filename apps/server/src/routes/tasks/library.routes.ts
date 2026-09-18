import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { LIBRARY_LIMITS } from "@chrona/contracts/library";
import { createLocalLibraryService, WorkResultError, type WorkResultErrorCode } from "@chrona/engine";
import { isLocalOwnerAuthorized } from "../../middleware/auth";
import { isTrustedRequestOrigin, readEnv, resolveAllowedOrigins } from "../../config/env";
const statuses = { AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400, REVISION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, PRECONDITION_FAILED: 412, STORAGE_ERROR: 500 } as const satisfies Record<WorkResultErrorCode, number>;
function ownerAuthorized(c: Context) { return isLocalOwnerAuthorized(c.req.header("authorization")) && isTrustedRequestOrigin(c.req.url, c.req.header("origin"), resolveAllowedOrigins(readEnv())); }
function failed(c: Context, cause: unknown) {
  const error = cause instanceof WorkResultError ? cause : new WorkResultError("STORAGE_ERROR", "Library operation could not be completed");
  return c.json({ error: error.message, code: error.code }, statuses[error.code]);
}
async function call(c: Context, method: "read" | "write") {
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failed(c, new WorkResultError("VALIDATION_ERROR", "A JSON request is required"));
  let input: unknown;
  try { input = await c.req.json(); } catch { return failed(c, new WorkResultError("VALIDATION_ERROR", "Invalid JSON request")); }
  try { return c.json(await createLocalLibraryService(async () => ownerAuthorized(c))[method](input)); } catch (cause) { return failed(c, cause); }
}
export function createLibraryRoutes() {
  return new Hono().use("/library/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!ownerAuthorized(c)) return failed(c, new WorkResultError("AUTH_REQUIRED", "Owner authorization is required"));
    return next();
  }).use("/library/*", bodyLimit({ maxSize: LIBRARY_LIMITS.requestBytes, onError: (c) => c.json({ error: "Library request exceeds 32 KiB", code: "VALIDATION_ERROR" }, 413) }))
    .post("/library/read", (c) => call(c, "read")).post("/library/update", (c) => call(c, "write"));
}
