import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { WORK_REQUEST_BYTES } from "@chrona/contracts/work";
import { createLocalWorkRecordsService, workCapabilities, WorkResultError, type WorkResultErrorCode } from "@chrona/engine";
import { isLocalOwnerAuthorized } from "../../middleware/auth";
import { isTrustedRequestOrigin, readEnv, resolveAllowedOrigins } from "../../config/env";
const statuses = { AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400, REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409, PRECONDITION_FAILED: 412, STORAGE_ERROR: 500 } as const satisfies Record<WorkResultErrorCode, number>;
function ownerAuthorized(c: Context) {
  return isLocalOwnerAuthorized(c.req.header("authorization")) && isTrustedRequestOrigin(c.req.url, c.req.header("origin"), resolveAllowedOrigins(readEnv()));
}
function failed(c: Context, cause: unknown) {
  const error = cause instanceof WorkResultError ? cause : new WorkResultError("STORAGE_ERROR", "Work-record operation could not be completed");
  return c.json({ error: error.message, code: error.code }, statuses[error.code]);
}
async function call(c: Context, method: "search" | "read" | "capture" | "update") {
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failed(c, new WorkResultError("VALIDATION_ERROR", "A JSON request is required"));
  let input: unknown;
  try { input = await c.req.json(); } catch { return failed(c, new WorkResultError("VALIDATION_ERROR", "Invalid JSON request")); }
  try { return c.json(await createLocalWorkRecordsService(async () => ownerAuthorized(c))[method](input)); }
  catch (cause) { return failed(c, cause); }
}
export function createWorkRecordRoutes() {
  return new Hono()
    .use("/work-records/*", async (c, next) => { c.header("Cache-Control", "no-store"); if (!ownerAuthorized(c)) return failed(c, new WorkResultError("AUTH_REQUIRED", "Owner authorization is required")); return next(); })
    .use("/work-records/*", bodyLimit({ maxSize: WORK_REQUEST_BYTES, onError: c => c.json({ code: "VALIDATION_ERROR", error: "Work request exceeds 32 KiB" }, 413) }))
    .get("/work-records/capabilities", c => c.json({ ...workCapabilities(["tasks:read", "work:read", "work:write"]), canResolve: workCapabilities(["tasks:read", "work:read", "work:write"]).canWrite }))
    .post("/work-records/search", c => call(c, "search"))
    .post("/work-records/read", c => call(c, "read"))
    .post("/work-records/capture", c => call(c, "capture"))
    .post("/work-records/update", c => call(c, "update"));
}
