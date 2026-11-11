import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runtimeStartSchema, runtimeOutcomeSchema, type ProviderAdapter, type ProviderRunInput, type RuntimeStart } from "@chrona/contracts/steward";
import { transcriptRedactor } from "@chrona/logging/redaction";
import { writeJournal } from "./journal";
import { currentHostGeneration, hostStopped } from "./host-recovery";
import { launchConfigurationSchema, type LaunchConfiguration } from "./configuration";
import { runtimeCompletionSchema } from "@chrona/contracts/steward";
import { completionInput } from "./schema";
import { completionHandle, type CompletionResult, type PrepareCompletion } from "./completions";

type Handle = ReturnType<ProviderAdapter["start"]>;
type Outcome = Awaited<Handle["done"]>;
type Row = { completion?: CompletionResult; digest: string; hostGeneration?: string; configuration?: LaunchConfiguration; outcome?: Outcome; failure?: boolean; handle?: Handle; receipt?: Promise<void> };
const legacySchema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), configuration: launchConfigurationSchema.optional(), result: runtimeCompletionSchema.optional() }).strict();
const savedSchema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), hostGeneration: z.string().regex(/^[a-f0-9]{64}$/).optional(), configuration: launchConfigurationSchema.optional(), outcome: runtimeOutcomeSchema.optional(), completion: runtimeCompletionSchema.optional() }).strict();
export class PiError extends Error {
  constructor(readonly code: "conflict" | "unknown" | "not_found" | "capacity" | "unavailable" | "invalid" | "forbidden", message: string) { super(message); }
}
const digestOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type PrepareRun = (request: RuntimeStart) => Promise<{ provider: ProviderAdapter; input: ProviderRunInput; configuration?: LaunchConfiguration }>;
type Control = { operationId: string; message?: string; images?: ProviderRunInput["images"]; request?: Record<string, unknown> };
async function controlLive(name: string, row: Row, args: Control) {
  if (name === "abort" && row.outcome) return { requested: true };
  if (!row.handle) throw new PiError("unknown", "Pi control requires reconciliation");
  if (name === "abort") { void row.handle.abort().catch(() => { row.failure = true; }); return { requested: true }; }
  if (row.outcome || row.failure) throw new PiError("conflict", "Pi operation ended or requires reconciliation");
  if (name === "inject") {
    if (typeof args.message !== "string") throw new PiError("invalid", "Message required");
    await row.handle.inject(args.message, args.images); return { accepted: true };
  }
  if (name === "native") {
    if (!row.handle.native) throw new PiError("unavailable", "Pi native protocol unavailable");
    if (!args.request) throw new PiError("invalid", "Native request required");
    const response = await row.handle.native(args.request);
    // The routed shared JSON envelope is narrower than Pi's transport bound.
    // Preserve the whole reply or report explicit loss; never slice it to fit.
    if (Buffer.byteLength(JSON.stringify(response)) > 65_536) throw Object.assign(new Error("Pi native response exceeds the routed envelope bound"), { code: "too_large" });
    return { response };
  }
  throw new PiError("not_found", "Pi tool not found");
}
/** Identity is durable before launch. Unknown launches consume capacity and are never replayed. */
export function createPiOperations(data: string, prepare: PrepareRun, settled?: (operationId: string, callbacks: string, outcome: Outcome) => Promise<void>, capacity = 64, prepareCompletion?: PrepareCompletion) {
  const rows = new Map<string, Row>(), starting = new Map<string, Promise<{ operationId: string }>>();
  const directory = join(data, "operations"), path = (id: string) => join(directory, `${digestOf(id)}.json`);
  let loading: Promise<void> | undefined, stopping = false;
  const isStopping = () => stopping;
  async function read(path: string): Promise<Row> {
    const saved = savedSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return { ...saved, ...(!saved.outcome ? { failure: true } : {}) };
  }
  async function recover(file: string, row: Row) {
    if (row.handle || row.outcome || !row.hostGeneration || !await hostStopped(data, row.hostGeneration)) return;
    const outcome: Outcome = { outcome: "failed", sessionId: null, error: "Pi host exited; descendants are confirmed stopped. External effects remain unconfirmed; work was not replayed." };
    await writeJournal(file, { digest: row.digest, hostGeneration: row.hostGeneration, configuration: row.configuration, outcome, completion: row.completion });
    row.outcome = outcome; row.failure = false;
  }
  async function load() {
    loading ??= (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Preserve claims from the former completion-only journal across upgrades.
      const legacyDirectory = join(data, "completions");
      const legacyFiles = await readdir(legacyDirectory).catch(error => { if (error.code === "ENOENT") return []; throw error; });
      for (const name of legacyFiles) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        try { await readFile(join(directory, name)); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const old = legacySchema.parse(JSON.parse(await readFile(join(legacyDirectory, name), "utf8")));
        await writeJournal(join(directory, name), { digest: old.digest, configuration: old.configuration, ...(old.result ? { outcome: { outcome: "finished", sessionId: null, error: null }, completion: old.result } : {}) }, true);
      }
      for (const name of await readdir(directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const row = await read(join(directory, name));
        await recover(join(directory, name), row);
        if (!row.outcome) rows.set(name.slice(0, -5), row);
      }
    })();
    await loading;
  }
  async function owned(id: string) {
    await load();
    const key = digestOf(id), live = rows.get(key);
    if (live) { await recover(path(id), live); return live; }
    let row: Row;
    try { row = await read(path(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PiError("not_found", "Pi operation not found"); throw error; }
    if (!row.outcome) rows.set(key, row);
    await recover(path(id), row);
    return row;
  }
  type Completion = z.infer<typeof completionInput>;
  const idOf = (request: RuntimeStart | Completion) => "operationId" in request ? request.operationId : request.commandKey;
  async function prior(request: RuntimeStart | Completion) {
    let row: Row;
    try { row = await owned(idOf(request)); }
    catch (error) { if (error instanceof PiError && error.code === "not_found") return false; throw error; }
    if (row.digest !== digestOf(request)) throw new PiError("conflict", "Pi operation identity changed");
    if (row.failure) throw new PiError("unknown", "Pi launch requires reconciliation");
    return true;
  }
  async function launch(request: RuntimeStart | Completion) {
    const id = idOf(request), digest = digestOf(request);
    if (await prior(request)) return { operationId: id };
    if (isStopping()) throw new PiError("unavailable", "Pi host is stopping");
    if ([...rows.values()].filter(row => !row.outcome).length >= capacity) throw new PiError("capacity", "Pi operations full");
    const isCompletion = !("operationId" in request);
    const prepared = "operationId" in request ? await prepare(request) : await prepareCompletion!(request);
    if (isCompletion && !prepared.provider.complete) throw new PiError("unavailable", "Pi completion unavailable");
    if (isStopping()) throw new PiError("unavailable", "Pi host is stopping");
    // Preparation may yield while other launches consume capacity.
    if ([...rows.values()].filter(row => !row.outcome).length >= capacity) throw new PiError("capacity", "Pi operations full");
    const row: Row = { digest, hostGeneration: currentHostGeneration(), configuration: prepared.configuration };
    rows.set(digestOf(id), row);
    try { await writeJournal(path(id), { digest, hostGeneration: row.hostGeneration, configuration: row.configuration }, true); }
    catch { row.failure = true; throw new PiError("unknown", "Pi launch claim requires reconciliation"); }
    let completed: ReturnType<typeof completionHandle> | undefined;
    try {
      if (isCompletion) {
        completed = completionHandle(prepared as Awaited<ReturnType<PrepareCompletion>>, (request as Completion).maxOutputTokens);
        row.handle = completed.handle;
      } else row.handle = prepared.provider.start(prepared.input as ProviderRunInput);
    } catch { row.failure = true; throw new PiError("unknown", "Pi launch remains unconfirmed"); }
    if (row.configuration && "operationId" in request) void (prepared.input as ProviderRunInput).events?.raw?.({ type: "chrona_configuration", ...row.configuration }).catch(() => {});
    const redact = transcriptRedactor();
    row.receipt = row.handle.done.then(async outcome => {
      const checked = runtimeOutcomeSchema.parse(outcome);
      if (checked.error) checked.error = redact("token" in request ? checked.error.split(request.token).join("[redacted]") : checked.error, 2000);
      const result = completed?.result();
      await writeJournal(path(id), { digest, hostGeneration: row.hostGeneration, configuration: row.configuration, outcome: checked, completion: result });
      row.outcome = checked; row.completion = result; row.failure = false;
      if ("callbacks" in request && request.callbacks) void settled?.(id, request.callbacks, checked).catch(() => {});
    }).catch(() => { row.failure = true; });
    return { operationId: id };
  }
  async function start(raw: unknown) {
    const request = runtimeStartSchema.parse(raw);
    if (!request.callbacks) throw new PiError("forbidden", "Pi start requires kernel-bound callbacks");
    const pending = starting.get(request.operationId);
    if (pending) { await pending; return launch(request); }
    const task = launch(request); starting.set(request.operationId, task);
    try { return await task; } finally { starting.delete(request.operationId); }
  }
  async function complete(raw: unknown) {
    if (!prepareCompletion) throw new PiError("unavailable", "Pi completion unavailable");
    const request = completionInput.parse(raw), id = request.commandKey;
    const pending = starting.get(id);
    if (pending) { await pending; return launch(request); }
    const task = launch(request); starting.set(id, task);
    try { return await task; } finally { starting.delete(id); }
  }
  async function control(name: string, args: Control) {
    const row = await owned(args.operationId);
    if (name === "status") return { operationId: args.operationId, outcome: row.outcome ?? null, failure: row.failure ?? false, ...(row.completion ? { completion: row.completion } : {}) };
    if (name === "release") {
      if (!row.outcome) throw new PiError("conflict", "Pi completion remains unconfirmed");
      rows.delete(digestOf(args.operationId));
      return { released: true };
    }
    return controlLive(name, row, args);
  }
  async function stop() {
    stopping = true;
    await Promise.allSettled([...starting.values()]);
    const active = [...rows.values()].filter(row => row.handle && !row.outcome);
    await Promise.all(active.map(async row => { try { await row.handle!.abort(); } finally { await row.handle!.done; await row.receipt; } }));
  }
  return { start, complete, control, stop };
}
