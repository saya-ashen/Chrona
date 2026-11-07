import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { executionViewSchema, runtimeCompletionSchema } from "@chrona/contracts/steward";
import { moduleAgentInput, type ModuleAgentTool } from "./module-contracts";

type Caller = { kind: "module"; module: string; moduleId: string; hash: string };
type Completion = z.infer<typeof runtimeCompletionSchema>;
const receipt = z.object({ owner: z.string(), hash: z.string(), digest: z.string(), kind: z.enum(["execution", "completion"]), execution: executionViewSchema.optional(), result: runtimeCompletionSchema.optional(), failure: z.boolean().optional(), released: z.boolean().optional() }).strict();
type Receipt = z.infer<typeof receipt>;
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type Request = { name: ModuleAgentTool; args: Record<string, unknown>; caller: Caller; callId: string };
/** Module identity always comes from trigger.caller; arguments cannot select another owner or a host path. */
export function createModuleAgentOperations(data: string, call: Call, complete: (args: Record<string, unknown>) => Promise<Completion>, controlRun: (name: string, args: { operationId: string; message?: string }) => Promise<unknown>) {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const file = (id: string) => join(data, "module-operations", id + ".json");
  const active = new Map<string, Promise<unknown>>();
  const admit = (request: Request, execution?: Receipt["execution"]) => call("runtime-callback.agent-admit", { callId: request.callId, operation: request.name, ...(execution ? { execution } : {}) });
  async function save(id: string, row: Receipt) {
    await writeFile(file(id) + ".pending", JSON.stringify(row), { mode: 0o600 });
    await rename(file(id) + ".pending", file(id));
  }
  async function load(id: string, caller: Caller) {
    let row: Receipt;
    try { row = receipt.parse(JSON.parse(await readFile(file(id), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (row.owner !== caller.moduleId || row.hash !== caller.hash) throw new Error("forbidden: Agent operation belongs to another module or version");
    return row;
  }
  async function launchCompletion(request: Request, id: string, row: Receipt) {
    const reservation = z.object({ reservationId: z.string(), model: z.string(), thinking: z.string().optional(), timeoutMs: z.number() }).parse(await admit(request));
    const { args } = request;
    const work = complete({ prompt: args.prompt, system: args.system, maxOutputTokens: args.maxOutputTokens, model: reservation.model, thinking: reservation.thinking, timeoutMs: reservation.timeoutMs }).then(result => {
      row.result = { ...result, text: result.text.slice(0, Number(args.maxOutputTokens) * 4) };
    }).catch(() => { row.failure = true; }).then(async () => {
      await save(id, row);
      await call("runtime-callback.agent-settle", { reservationId: reservation.reservationId, ...(row.result ? { result: row.result } : {}), failed: !!row.failure });
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
      if (!previous.execution && !previous.result && !previous.failure && !active.has(id)) throw new Error("unknown: Agent operation requires reconciliation");
      return { operationId: id };
    }
    if (name === "complete" && active.size >= 64) throw new Error("capacity: Agent completions full");
    const row: Receipt = { owner: caller.moduleId, hash: caller.hash, digest, kind: name === "start" ? "execution" : "completion" };
    // Claim before any launch/reservation; an uncertain effect must never be replayed after restart.
    await mkdir(join(data, "module-operations"), { recursive: true, mode: 0o700 });
    await writeFile(file(id), JSON.stringify(row), { mode: 0o600, flag: "wx" });
    try {
      if (name === "start") { row.execution = executionViewSchema.parse(await admit(request)); await save(id, row); }
      else await launchCompletion(request, id, row);
    } catch (error) { row.failure = true; await save(id, row); throw error; }
    return { operationId: id };
  }
  async function release(request: Request, id: string, row: Receipt) {
    if (row.kind === "execution" && !row.execution) throw new Error("unknown: Agent execution requires reconciliation");
    if (row.kind === "completion" && !row.result && !row.failure) throw new Error("conflict: Agent completion remains unconfirmed");
    const result = await admit(request, row.execution);
    row.released = true; await save(id, row);
    return result;
  }
  function completionStatus(id: string, row: Receipt) {
    if (row.kind !== "completion") throw new Error("invalid: Not a completion");
    return { result: row.result ?? null, failure: !!row.failure || !row.result && !active.has(id) };
  }
  async function performControl(request: Request, result: unknown) {
    const command = z.object({ perform: z.boolean(), operationId: z.string() }).parse(result);
    if (command.perform) await controlRun(request.name, { operationId: command.operationId, ...(request.name === "inject" ? { message: String(request.args.message) } : {}) });
    return request.name === "inject" ? { accepted: true } : { requested: true };
  }
  async function control(request: Request) {
    const id = String(request.args.operationId), row = await load(id, request.caller);
    if (!row || row.released) throw new Error("not_found: Agent operation not found");
    if (request.name === "completion") return completionStatus(id, row);
    if (request.name === "release") return release(request, id, row);
    if (!row.execution) throw new Error("unknown: Agent execution requires reconciliation");
    const result = await admit(request, row.execution);
    if (request.name === "inject" || request.name === "abort") return performControl(request, result);
    return request.name === "status" ? { operationId: id, execution: result } : result;
  }
  return { async handle(name: ModuleAgentTool, raw: unknown, caller: Caller, callId: string) {
    const args = moduleAgentInput(name, raw) as Record<string, unknown>;
    const request = { name, args, caller, callId };
    return name === "start" || name === "complete" ? start(request) : control(request);
  } };
}
