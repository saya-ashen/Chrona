import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { writeAgentJournal } from "./journal";
import { join } from "node:path";
import { z } from "zod";
import { runtimeCompletionSchema, moduleAgentInput, type ModuleAgentTool, hardLimitsSchema } from "@chrona/contracts/steward";
import type { ModelPolicy } from "./model-policy";

type Caller = { kind: "module"; module: string; moduleId: string; hash: string };
type Completion = z.infer<typeof runtimeCompletionSchema>;
const receipt = z.object({ owner: z.string(), hash: z.string(), digest: z.string(), kind: z.literal("completion"), reservationId: z.string().optional(), result: runtimeCompletionSchema.optional(), failure: z.boolean().optional() }).strict();
type Receipt = z.infer<typeof receipt>;
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type Request = { name: ModuleAgentTool; args: Record<string, unknown>; caller: Caller; callId: string };
/** Module identity always comes from trigger.caller; arguments cannot select another owner or a host path. */
export function createModuleAgentOperations(data: string, call: Call, complete: (args: Record<string, unknown>) => Promise<Completion>, policy: Pick<ModelPolicy, "select">) {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const file = (id: string) => join(data, "module-operations", id + ".json");
  const active = new Map<string, Promise<unknown>>();
  const uncertainWrites = new Set<string>();
  const admit = (request: Request) => call("runtime-callback.agent-admit", { callId: request.callId, operation: request.name });
  async function save(id: string, row: Receipt) {
    try { await writeAgentJournal(file(id), row); }
    catch (error) { uncertainWrites.add(id); throw error; }
  }
  async function load(id: string, caller: Caller) {
    if (uncertainWrites.has(id)) throw new Error("unknown: Agent receipt persistence requires reconciliation");
    let row: Receipt;
    try { row = receipt.parse(JSON.parse(await readFile(file(id), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (row.owner !== caller.moduleId || row.hash !== caller.hash) throw new Error("forbidden: Agent operation belongs to another module or version");
    return row;
  }
  async function settle(row: Receipt) {
    if (row.reservationId && (row.result || row.failure)) await call("runtime-callback.agent-settle", { reservationId: row.reservationId, ...(row.result ? { result: row.result } : {}), failed: !!row.failure });
  }
  async function launchCompletion(request: Request, id: string, row: Receipt) {
    const reservation = z.object({ reservationId: z.string(), declaredTier: z.string(), effectiveHardLimits: hardLimitsSchema }).strict().parse(await admit(request));
    row.reservationId = reservation.reservationId;
    await save(id, row);
    const { args } = request;
    const work = (async () => {
      const target = await policy.select(reservation.declaredTier, reservation.effectiveHardLimits, Number(args.maxOutputTokens));
      row.result = runtimeCompletionSchema.parse(await complete({ prompt: args.prompt, system: args.system, ...target }));
    })().catch(error => {
      // An explicitly unknown result is not evidence that provider execution stopped.
      if ((error as { code?: string } | null)?.code !== "unknown" && !/^unknown:/.test(String((error as Error | null)?.message))) row.failure = true;
    }).then(async () => {
      await save(id, row);
      await settle(row);
    }).finally(() => active.delete(id));
    active.set(id, work);
    void work.catch(() => {});
  }
  async function start(request: Request) {
    const { args, caller, name } = request;
    const id = hash([caller.moduleId, name, args.commandKey]), digest = hash(args);
    const previous = await load(id, caller);
    if (previous) {
      if (previous.digest !== digest) throw new Error("conflict: Agent command key reused");
      if (!previous.result && !previous.failure && !active.has(id)) throw new Error("unknown: Agent operation requires reconciliation");
      return { operationId: id };
    }
    if (active.size >= 64) throw new Error("capacity: Agent completions full");
    const row: Receipt = { owner: caller.moduleId, hash: caller.hash, digest, kind: "completion" };
    // Claim before any launch/reservation; an uncertain effect must never be replayed after restart.
    await mkdir(join(data, "module-operations"), { recursive: true, mode: 0o700 });
    await writeAgentJournal(file(id), row, true);
    // Admission transport uncertainty retains the receipt and any pending capacity.
    await launchCompletion(request, id, row);
    return { operationId: id };
  }
  async function completionStatus(request: Request) {
    const id = String(request.args.operationId), row = await load(id, request.caller);
    if (!row) throw new Error("not_found: Agent operation not found");
    // A renamed receipt is not acknowledged until its file and directory sync have completed.
    if (active.has(id)) return { result: null, failure: false };
    // Reconcile the original reservation from durable stop evidence after a lost callback.
    await settle(row);
    return { result: row.result ?? null, failure: !!row.failure, ...(!row.result && !row.failure && !active.has(id) ? { unknown: true } : {}) };
  }
  return { async handle(name: ModuleAgentTool, raw: unknown, caller: Caller, callId: string) {
    const args = moduleAgentInput(name, raw) as Record<string, unknown>;
    const request = { name, args, caller, callId };
    return name === "complete" ? start(request) : completionStatus(request);
  } };
}
