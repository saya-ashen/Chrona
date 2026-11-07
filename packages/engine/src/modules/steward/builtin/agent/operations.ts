import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { runtimeStartSchema, runtimeOutcomeSchema } from "@chrona/contracts/steward";

type Outcome = Awaited<ReturnType<ProviderAdapter["start"]>["done"]>;
type Row = { digest: string; outcome?: Outcome; failure?: boolean; handle?: ReturnType<ProviderAdapter["start"]> };
export class AgentError extends Error {
  constructor(readonly code: "conflict" | "unknown" | "not_found" | "capacity" | "unavailable" | "invalid", message: string) { super(message); }
}
/** The journal contains identity digests and stop-confirmed outcomes, never prompts, tokens or profiles. */
export function createAgentOperations(provider: ProviderAdapter | undefined, data: string, input: (raw: unknown) => ProviderRunInput) {
  const rows = new Map<string, Row>();
  const path = (id: string) => join(data, "operations", createHash("sha256").update(id).digest("hex") + ".json");
  async function owned(id: string) {
    const live = rows.get(id);
    if (live) return live;
    let saved: { digest: string; outcome?: Outcome };
    try { saved = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), outcome: runtimeOutcomeSchema.optional() }).strict().parse(JSON.parse(await readFile(path(id), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AgentError("not_found", "Agent operation not found"); throw error; }
    const row: Row = { digest: saved.digest, ...(saved.outcome ? { outcome: saved.outcome } : { failure: true }) };
    rows.set(id, row);
    return row;
  }
  async function start(raw: unknown) {
    if (!provider) throw new AgentError("unavailable", "Agent backend unconfigured");
    const request = runtimeStartSchema.parse(raw), id = request.operationId;
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    let previous: Row | undefined;
    try { previous = await owned(id); } catch (error) { if (!(error instanceof AgentError) || error.code !== "not_found") throw error; }
    if (previous) {
      if (previous.digest !== digest) throw new AgentError("conflict", "Agent operation identity changed");
      if (previous.failure) throw new AgentError("unknown", "Agent launch requires reconciliation");
      return { operationId: id };
    }
    if (rows.size >= 64) throw new AgentError("capacity", "Agent operations full");
    await mkdir(join(data, "operations"), { recursive: true, mode: 0o700 });
    await writeFile(path(id), JSON.stringify({ digest }), { flag: "wx", mode: 0o600 });
    const row: Row = { digest };
    rows.set(id, row);
    try { row.handle = provider.start(input(request)); }
    catch { row.failure = true; throw new AgentError("unknown", "Agent launch remains unconfirmed"); }
    void row.handle.done.then(async outcome => {
      const checked = runtimeOutcomeSchema.parse(outcome);
      await writeFile(path(id) + ".pending", JSON.stringify({ digest, outcome: checked }), { mode: 0o600 });
      await rename(path(id) + ".pending", path(id));
      row.outcome = checked;
    }).catch(() => { row.failure = true; });
    return { operationId: id };
  }
  async function control(name: string, args: { operationId: string; message?: string; images?: ProviderRunInput["images"] }) {
    const row = await owned(args.operationId);
    if (name === "status") return { operationId: args.operationId, outcome: row.outcome ?? null, failure: row.failure ?? false };
    if (name === "release") {
      if (!row.outcome) throw new AgentError("conflict", "Agent completion remains unconfirmed");
      rows.delete(args.operationId);
      // Retain the receipt so a repeated start cannot launch the same Run again.
      return { released: true };
    }
    if (!row.handle) throw new AgentError("unknown", "Agent control requires reconciliation");
    if (name === "abort") { void row.handle.abort().catch(() => { row.failure = true; }); return { requested: true }; }
    if (name === "inject") {
      if (row.outcome || row.failure) throw new AgentError("conflict", "Agent operation ended");
      if (typeof args.message !== "string") throw new AgentError("invalid", "Message required");
      await row.handle.inject(args.message, args.images);
      return { accepted: true };
    }
    throw new AgentError("not_found", "Agent tool not found");
  }
  async function stop() {
    await Promise.all([...rows.values()].filter(row => row.handle && !row.outcome).map(async row => { await row.handle!.abort(); await row.handle!.done; }));
  }
  return { start, control, stop };
}
