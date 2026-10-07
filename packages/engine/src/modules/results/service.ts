import type { z } from "zod";
import { Prisma } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { publishWorkResultSchema, readWorkResultSchema, reviewWorkResultSchema, resultFileSchema, resultScopeSchema, pageReadSchema, pageWriteSchema, pageValidateSchema, RESULT_REQUEST_BYTES, RESULT_RESPONSE_BYTES } from "@chrona/contracts/results";
import { WorkResultError, type TaskResultsPorts } from "./access";
import { publishWorkResult } from "./publish";
import { readWorkResult } from "./read";
import { reviewWorkResult } from "./review";
import { resultFile } from "./files";
import { resultContext } from "./context";
import { authorizeResult, requireResultPermission } from "./access";
import { describeWorkPageCatalog, workPageSchema } from "@chrona/ui-protocol/work-pages";
import { readPageInputs, writePageInput } from "./page-inputs";

function parseRequest<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > RESULT_REQUEST_BYTES) throw new Error("size");
    const parsed = schema.safeParse(raw);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > RESULT_REQUEST_BYTES) throw new Error("schema");
    return parsed.data;
  } catch { throw new WorkResultError("VALIDATION_ERROR", "Invalid or oversized work-result request"); }
}

async function runResultTransaction<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await withDatabaseTransaction(async () => {
      const result = await work();
      if (Buffer.byteLength(JSON.stringify(result)) > RESULT_RESPONSE_BYTES) throw new WorkResultError("PRECONDITION_FAILED", "Result response exceeds the supported budget");
      return result;
    });
  } catch (error) {
    if (error instanceof WorkResultError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw new WorkResultError("REVISION_CONFLICT", "Concurrent result change; read and reconcile before retrying");
    }
    // Do not leak database/provider payloads, filesystem paths or auth adapter details.
    throw new WorkResultError("STORAGE_ERROR", "Work-result operation could not be completed");
  }
}

/** Executor-independent application API. Trusted auth/local-file adapters required;
 * owner HTTP and scoped MCP share this writer without attaching any automation. */
export function createTaskResultsService(ports: TaskResultsPorts) {
  return {
    pageCatalog(raw: unknown) {
      const input = parseRequest(resultScopeSchema, raw);
      return runResultTransaction(async () => { await authorizeResult(ports, input, "pages:read"); return describeWorkPageCatalog(); });
    },
    pageValidate(raw: unknown) {
      const input = parseRequest(pageValidateSchema, raw);
      return runResultTransaction(async () => {
        const principal = await authorizeResult(ports, input, "pages:read"); requireResultPermission(principal, "pages:write");
        const result = workPageSchema.safeParse(input.page);
        return result.success ? { valid: true, issues: [] } : { valid: false, issues: result.error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".").slice(0, 300), message: i.message.slice(0, 300) })) };
      });
    },
    pageRead(raw: unknown) {
      const input = parseRequest(pageReadSchema, raw);
      return runResultTransaction(() => readPageInputs(ports, input));
    },
    pageWrite(raw: unknown) {
      const input = parseRequest(pageWriteSchema, raw);
      return runResultTransaction(() => writePageInput(ports, input));
    },
    context(raw: unknown) {
      const input = parseRequest(resultScopeSchema, raw);
      return runResultTransaction(() => resultContext(ports, input));
    },
    file(raw: unknown) {
      const input = parseRequest(resultFileSchema, raw);
      return runResultTransaction(() => resultFile(ports, input));
    },
    publish(raw: unknown) {
      const input = parseRequest(publishWorkResultSchema, raw);
      return runResultTransaction(() => publishWorkResult(ports, input));
    },
    review(raw: unknown) {
      const input = parseRequest(reviewWorkResultSchema, raw);
      return runResultTransaction(() => reviewWorkResult(ports, input));
    },
    read(raw: unknown) {
      const input = parseRequest(readWorkResultSchema, raw);
      return runResultTransaction(() => readWorkResult(ports, input));
    },
  };
}
export type TaskResultsService = ReturnType<typeof createTaskResultsService>;
