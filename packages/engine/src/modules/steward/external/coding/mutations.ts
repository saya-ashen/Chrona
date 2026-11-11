import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ModelError } from "chrona";
import { saveSessionFile } from "./sessions";
import type { CodingContext } from "./types";
import { kernelAgentOutputs } from "./kernel-contract.js";
const outputFor = (target: string, output: unknown) => {
  const name = target.slice(6) as keyof typeof kernelAgentOutputs;
  if (!Object.hasOwn(kernelAgentOutputs, name)) throw new ModelError("unsupported", "Unsupported Coding mutation target");
  return kernelAgentOutputs[name].parse(output);
};

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export async function readPrivate<T>(context: CodingContext, name: string, maxBytes = 8 * 1024 * 1024): Promise<T | undefined> {
  try {
    const path = join(context.dir, "sessions", name);
    if ((await stat(path)).size > maxBytes) throw new ModelError("too_large", "Coding private journal exceeds storage budget");
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
type Mutation = { version: 1; target: string; key: string; args: Record<string, unknown>; metadata?: { workId: string; projectRef: string }; state: "pending" | "succeeded" | "failed"; output?: unknown; error?: { code: string; message: string } };
const definitive = new Set(["invalid", "forbidden", "unauthorized", "unsupported", "unsupported_version", "capacity"]);
const filename = (target: string, key: string) => `call-${digest(`${target}:${key}`)}.json`;

function applyReceipt(entry: Mutation, state: { status: string; output?: unknown; error?: string | { code: string; message: string } }) {
  if (state.status === "succeeded" && Object.hasOwn(state, "output")) { entry.output = outputFor(entry.target, state.output); entry.state = "succeeded"; }
  else if (state.status === "failed" && state.error) { entry.error = typeof state.error === "string" ? { code: "unavailable", message: state.error } : state.error; entry.state = "failed"; }
  else throw new ModelError("unavailable", "Original kernel call has no definitive outcome; automatic replay is prohibited");
}
async function recover(context: CodingContext, entry: Mutation, name: string): Promise<unknown> {
  if (entry.state === "pending") {
    if (!context.callStatus) throw new ModelError("unavailable", "Original kernel call outcome is unknown; automatic replay is prohibited");
    let state;
    try { state = await context.callStatus({ target: entry.target, key: entry.key }); }
    catch { throw new ModelError("unavailable", "Original kernel call receipt is unavailable; automatic replay is prohibited"); }
    applyReceipt(entry, state);
    await saveSessionFile(context, name, entry);
  }
  if (entry.state === "failed") throw new ModelError(entry.error?.code ?? "unavailable", entry.error?.message ?? "Kernel call failed");
  return entry.output;
}
export async function findMutation(context: CodingContext, target: string, commandKey: string) {
  const key = `coding-${digest(`${target}:${commandKey}`)}`, name = filename(target, key);
  const entry = await readPrivate<Mutation>(context, name);
  if (entry === undefined) return undefined;
  if (!(entry as unknown) || typeof (entry as unknown) !== "object" || (entry as { version: unknown }).version !== 1 || entry.target !== target || entry.key !== key || !["pending", "succeeded", "failed"].includes(entry.state)) throw new ModelError("conflict", "Invalid Coding call journal");
  return { entry, name };
}
export async function recoverMutation(context: CodingContext, target: string, commandKey: string) {
  const found = await findMutation(context, target, commandKey);
  if (!found) throw new ModelError("not_found", "Coding has no original kernel call receipt");
  return { output: await recover(context, found.entry, found.name), metadata: found.entry.metadata };
}
/** Persist intent before dispatch. A pending journal is recovered by callStatus, never by re-running a mutation. */
export async function mutate(context: CodingContext, target: string, commandKey: string, args: Record<string, unknown>, metadata?: Mutation["metadata"]): Promise<unknown> {
  const found = await findMutation(context, target, commandKey);
  if (found) {
    if (JSON.stringify(found.entry.args) !== JSON.stringify(args) || JSON.stringify(found.entry.metadata) !== JSON.stringify(metadata)) throw new ModelError("conflict", "Kernel call key belongs to another Coding command");
    return recover(context, found.entry, found.name);
  }
  const key = `coding-${digest(`${target}:${commandKey}`)}`, name = filename(target, key);
  const entry: Mutation = { version: 1, target, key, args, ...(metadata ? { metadata } : {}), state: "pending" };
  await saveSessionFile(context, name, entry);
  let output: unknown;
  try { output = await context.call(target, args, { key }); }
  catch (error) {
    const failure = error as { code?: string; message?: string };
    if (definitive.has(failure.code ?? "")) {
      entry.state = "failed"; entry.error = { code: failure.code!, message: failure.message ?? "Kernel rejected the call" };
      await saveSessionFile(context, name, entry);
    }
    throw error;
  }
  entry.output = outputFor(target, output); entry.state = "succeeded";
  await saveSessionFile(context, name, entry);
  return output;
}
