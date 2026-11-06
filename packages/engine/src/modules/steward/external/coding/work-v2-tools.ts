import { WORK_LIMITS, executionIdSchema, workCleanupInputSchema, workRequestSchema } from "./contract.js";
import { codingError, type CodingContext } from "./storage";
import { handleWorkCommand, reconcileWorks } from "./work-v2";
import { readRegistry, findWork, serializeWork } from "./work-v2-storage";
import { cleanupWorkspace } from "./workspaces";

type WorkToolEvent = { id: string; caller?: { kind: string }; args: Record<string, unknown> };
function inputJson(input: unknown): unknown {
  if (typeof input !== "string") throw codingError("invalid", "Expected JSON input");
  if (Buffer.byteLength(input) > WORK_LIMITS.requestBytes) throw codingError("too_large", "Work request exceeds byte budget");
  try { return JSON.parse(input); } catch { throw codingError("invalid", "Expected JSON input"); }
}
function reconcileTool(context: CodingContext, event: WorkToolEvent) {
  if (event.caller?.kind !== "module") throw codingError("forbidden", "Reconciliation requires a module caller");
  const raw = inputJson(event.args.input);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || !("workId" in raw)) throw codingError("invalid", "Expected exact work identity");
  const workId = executionIdSchema.safeParse(raw.workId);
  if (!workId.success) throw codingError("invalid", "Invalid work identity");
  return reconcileWorks(context, workId.data);
}
function cleanupTool(context: CodingContext, raw: unknown) {
  const parsed = workCleanupInputSchema.safeParse(raw);
  if (!parsed.success) throw codingError("invalid", "Invalid cleanup input");
  const input = parsed.data;
  return serializeWork(async () => {
    const { view } = findWork(await readRegistry(context), input.workId);
    return cleanupWorkspace(context, view, input);
  });
}
export function handleWorkTool(context: CodingContext, event: WorkToolEvent): Promise<unknown> {
  if (event.id === "reconcile") return reconcileTool(context, event);
  if (!["owner", "provider", "module"].includes(event.caller?.kind ?? "")) throw codingError("forbidden", "Work requires an admitted caller");
  const raw = inputJson(event.args.input);
  if (event.id === "workspace-cleanup") {
    if (event.caller?.kind === "provider") throw codingError("forbidden", "Only the owner may clean a workspace");
    return cleanupTool(context, raw);
  }
  const parsed = workRequestSchema.safeParse(raw);
  if (!parsed.success) throw codingError("invalid", "Invalid work request");
  const request = parsed.data;
  if (request.command.op === "accept" && event.caller?.kind === "provider") throw codingError("forbidden", "Only the owner may accept a result");
  return handleWorkCommand(context, request.command);
}
