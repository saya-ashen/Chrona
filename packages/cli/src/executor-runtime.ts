import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { z } from "zod";
import { EXECUTOR_PROTOCOL, executorIdentitySchema, type ExecutorFinal } from "@chrona/contracts/steward";
import { createExecutorClient, createExecutorDaemon, createDeviceWorkspacePreparer, executorCredential, ExecutorJournal, prepareExecutorIncarnation, drainExecutorFinals } from "@chrona/integrations/executor";
import { canonicalExecutionFinalDisplay, captureWorkspaceChanges } from "@chrona/engine/executor";
import { providerText } from "@chrona/domain/steward/provider";
import { privateDirectory, privateJson, privateWrite, readExecutorConfig, validateExecutorPaths, type ExecutorCliConfig } from "./executor-config";
import { compiledExecutor } from "./executor-entry";

const identitySchema = executorIdentitySchema.extend({ origin: z.string(), label: z.string() }).strict();
export async function pairExecutor(dataDir: string, code: string) {
  const config = readExecutorConfig(dataDir);
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error("Pairing code must be exactly 64 hexadecimal characters on stdin");
  const previous = existsSync(join(dataDir, "identity.json")) ? privateJson(join(dataDir, "identity.json"), identitySchema) : null;
  if (previous && !existsSync(join(dataDir, "credential"))) throw new Error("Paired device credential is missing; refusing replacement");
  const credential = executorCredential(join(dataDir, "credential"));
  const receipt = await createExecutorClient(config.origin, credential).request("pair", { v: EXECUTOR_PROTOCOL, requestId: randomUUID(), code, label: config.label });
  const identity = { executorId: receipt.executorId, generation: receipt.generation, origin: config.origin, label: config.label };
  if (previous && JSON.stringify(previous) !== JSON.stringify(identity)) throw new Error("Pair receipt differs from the original device identity");
  privateWrite(join(dataDir, "identity.json"), identity);
  return { executorId: receipt.executorId, generation: receipt.generation };
}
export function assertExecutorPlatform() {
  const version = process.platform === "linux" ? spawnSync("systemd-run", ["--version"], { encoding: "utf8", timeout: 4000 }) : null;
  if (!version || version.status !== 0 || !version.stdout.startsWith("systemd 262 ")) throw new Error("Executor requires verified native Linux systemd 262");
}
function canonicalFinal(final: ExecutorFinal, secrets: readonly string[]) {
  const display = canonicalExecutionFinalDisplay({ ...final, finalMessage: final.finalMessage ? { ...final.finalMessage, text: providerText(final.finalMessage.text, [...secrets], 20_000, true) } : null,
    outcome: { ...final.outcome, error: final.outcome.error ? providerText(final.outcome.error, [...secrets], 2000, true) : null } });
  return { ...final, ...display };
}
function daemonOptions(config: ExecutorCliConfig, dataDir: string, executorId: string, generation: number, incarnation: string) {
  const credential = executorCredential(join(dataDir, "credential"));
  const mappings = config.mappings.map(({ projectRef, mappingRevision, ...mapping }) => ({ ...mapping, placement: { executorId, projectRef, mappingRevision } }));
  return { client: createExecutorClient(config.origin, credential), fence: { executorId, generation, incarnation }, journal: new ExecutorJournal(join(dataDir, "journal")),
    provider: { ...config.pi, chronaExtension: join(executorResourceDir(), "external-plugins", "pi-steward-agent", "chrona-tools.ts") },
    prepareWorkspace: createDeviceWorkspacePreparer(mappings, join(dataDir, "workspaces")),
    canonicalFinal: (final: ExecutorFinal, secrets: readonly string[]) => canonicalFinal(final, [...secrets, credential]), captureWorkspaceChanges,
    ...(compiledExecutor ? { processEntry: { file: process.execPath, args: ["__executor-process"] } } : {}) };
}
// Read resource selection only in the foreground daemon, never the internal process dispatcher.
function executorResourceDir() { return process.env.CHRONA_RESOURCE_DIR ?? (compiledExecutor ? join(dirname(process.execPath), "resources") : resolve(import.meta.dir, "../../..")); }
export async function runExecutor(dataDir: string, continueAfterOwner: (proposal: { executorId: string; generation: number; expectedIncarnation: string | null; nextIncarnation: string }) => Promise<boolean>, signal: AbortSignal) {
  assertExecutorPlatform();
  const config = readExecutorConfig(dataDir); validateExecutorPaths(config, dataDir);
  const identity = privateJson(join(dataDir, "identity.json"), identitySchema);
  if (identity.origin !== config.origin || identity.label !== config.label) throw new Error("Executor configuration no longer matches the paired identity");
  const proposal = { executorId: identity.executorId, generation: identity.generation, ...prepareExecutorIncarnation(join(dataDir, "incarnation")) };
  if (!await continueAfterOwner(proposal) || signal.aborted) return;
  const daemon = createExecutorDaemon(daemonOptions(config, dataDir, identity.executorId, identity.generation, proposal.nextIncarnation));
  // daemon.run authenticates/reconciles first; Enter itself grants no authority and never performs owner CAS.
  try { await daemon.run(signal); } finally { await daemon.close(); }
}

/** Retained finals use the original fence; only server authentication proves its binding. */
export async function drainExecutor(dataDir: string) {
  const config = readExecutorConfig(dataDir);
  const identity = privateJson(join(dataDir, "identity.json"), identitySchema);
  if ([identity.origin !== config.origin, identity.label !== config.label].some(Boolean)) throw new Error("Executor configuration no longer matches the paired identity");
  if (!existsSync(join(dataDir, "credential"))) throw new Error("Paired device credential is missing; refusing replacement");
  if (!lstatSync(join(dataDir, "journal"), { throwIfNoEntry: false })) return;
  privateDirectory(join(dataDir, "journal"));
  const journal = new ExecutorJournal(join(dataDir, "journal")), incarnations = new Set<string>();
  for (const name of readdirSync(journal.directory)) {
    if (!/^chrona-executor-[a-f0-9]{64}\.service\.json$/.test(name)) continue;
    const saved = journal.read(name.slice(0, -5))!;
    if (saved.ack?.stopConfirmed) continue;
    const assignment = saved.journal.assignment;
    if (assignment.executorId !== identity.executorId || assignment.generation !== identity.generation) throw new Error("Pending journal differs from paired device identity; retained");
    incarnations.add(assignment.incarnation);
  }
  if (incarnations.size > 1) throw new Error("Pending journals have multiple original incarnations; retained");
  const [incarnation] = incarnations;
  if (!incarnation) return;
  await drainExecutorFinals({ client: createExecutorClient(config.origin, executorCredential(join(dataDir, "credential"))),
    fence: { executorId: identity.executorId, generation: identity.generation, incarnation }, journal });
}
