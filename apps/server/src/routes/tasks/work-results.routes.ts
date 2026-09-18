import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { RESULT_REQUEST_BYTES } from "@chrona/contracts/results";
import { createLocalTaskResultsService, readWorkResultCapabilities, WorkResultError, type WorkResultErrorCode } from "@chrona/engine";
import { isLocalOwnerAuthorized } from "../../middleware/auth";
import { isTrustedRequestOrigin, readEnv, resolveAllowedOrigins } from "../../config/env";

const statuses = { AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400, REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409, PRECONDITION_FAILED: 412, STORAGE_ERROR: 500 } as const satisfies Record<WorkResultErrorCode, number>;
function ownerAuthorized(c: Context) {
  return isLocalOwnerAuthorized(c.req.header("authorization")) &&
    isTrustedRequestOrigin(c.req.url, c.req.header("origin"), resolveAllowedOrigins(readEnv()));
}
function failed(c: Context, cause: unknown) {
  const error = cause instanceof WorkResultError ? cause : new WorkResultError("STORAGE_ERROR", "Work-result operation could not be completed");
  return c.json({ error: error.message, code: error.code }, statuses[error.code]);
}
async function call(c: Context, method: "read" | "publish" | "review" | "file" | "context" | "pageRead" | "pageWrite" | "pageCatalog" | "pageValidate") {
  if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return failed(c, new WorkResultError("VALIDATION_ERROR", "A JSON request is required"));
  }
  let input: unknown;
  try { input = await c.req.json(); }
  catch { return failed(c, new WorkResultError("VALIDATION_ERROR", "Invalid JSON request")); }
  try {
    const service = createLocalTaskResultsService(async () => ownerAuthorized(c));
    return c.json(await service[method](input));
  } catch (cause) { return failed(c, cause); }
}

/** Owner API, separate from scoped management MCP and the legacy Run result routes.
 * All POSTs reuse the exact shared request schemas; read remains read-only. */
export function createWorkResultRoutes() {
  return new Hono()
    .use("/results/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      if (!ownerAuthorized(c)) return failed(c, new WorkResultError("AUTH_REQUIRED", "Local owner authorization is required"));
      return next();
    })
    .use("/results/*", bodyLimit({ maxSize: RESULT_REQUEST_BYTES, onError: (c) => c.json({ error: "Work-result request exceeds 96 KiB", code: "VALIDATION_ERROR" }, 413) }))
    .get("/results/capabilities", (c) => c.json(readWorkResultCapabilities(["tasks:read", "results:read", "results:write", "results:review", "artifacts:read", "artifacts:write"])))
    .post("/results/page/read", (c) => call(c, "pageRead"))
    .post("/results/page/input", (c) => call(c, "pageWrite"))
    .post("/results/page/catalog", (c) => call(c, "pageCatalog"))
    .post("/results/page/validate", (c) => call(c, "pageValidate"))
    .post("/results/read", (c) => call(c, "read"))
    .post("/results/submit", (c) => call(c, "publish"))
    .post("/results/review", (c) => call(c, "review"))
    .post("/results/file", (c) => call(c, "file"))
    .post("/results/context", (c) => call(c, "context"));
}
