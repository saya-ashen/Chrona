import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { executionStartV2Schema, executionProjectGrantP2Schema, workCleanupInputSchema, workCleanupReceiptSchema, workWorkspaceSchema, executionSourceReceiptSchema, executionChangesSchema } from "@chrona/contracts/steward";
import { z } from "zod";
import type { StewardPorts, ServerWorkspaceRequest, PreparedServerWorkspace } from "./ports";
import { CallError, registerLocalModule } from "./module-calls";
import { json, tool } from "./system/shared";
import { runtimeCall } from "./local-runtime";
import { captureExecutionChanges, readExecutionChanges } from "./execution-result";

const principalSchema = z.object({ workspaceId: z.string().min(1), ownerId: z.string().min(1), caller: z.discriminatedUnion("kind", [z.object({ kind: z.literal("owner") }).strict(), z.object({ kind: z.literal("module"), moduleId: z.string().min(1), hash: z.string().min(1) }).strict()]) }).strict();
const requestSchema = z.object({ principal: principalSchema, input: executionStartV2Schema, grant: executionProjectGrantP2Schema, attemptId: z.string().uuid(), workspaceRef: z.string().uuid(), phase: z.enum(["admission", "claim"]) }).strict().refine(value => value.grant.executor === "server", "Server grant required");
const preparedSchema = z.object({ lockId: z.string().uuid(), bindingDigest: z.string(), cwd: z.string(), projectDirectoryIdentity: z.string(), workspaceDirectoryIdentity: z.string(), workspace: workWorkspaceSchema, sourceReceipt: executionSourceReceiptSchema.nullable(), verifiedAt: z.string().datetime({ offset: true }) }).strict();
const locks = new WeakMap<StewardPorts, Map<string, { workspaceId: string; prepared: PreparedServerWorkspace }>>();
function held(ports: StewardPorts) {
  let map = locks.get(ports);
  if (!map) { map = new Map(); locks.set(ports, map); }
  return map;
}
async function projectRules(ports: StewardPorts, workspaceId: string, runId: string) {
  const row = await ports.db.executionAttempt.findFirst({ where: { workspaceId, runId, executorId: "server" }, include: { run: true } });
  if (!row?.resolvedCwd || row.capabilityRevokedAt || row.run.status !== "running") throw new CallError("forbidden", "Project rules require an active execution");
  try { return { text: (await readFile(join(row.resolvedCwd, "AGENTS.md"), "utf8")).slice(0, 32_000) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: "" }; throw error; }
}
async function executionCapture(ports: StewardPorts, workspaceId: string, name: string, args: Record<string, unknown>) {
  const row = await ports.db.executionAttempt.findFirst({ where: { workspaceId, ...(name === "capture" ? { runId: String(args.runId) } : { id: String(args.attemptId) }) }, include: { run: true } });
  if (!row) throw new CallError("not_found", "Execution capture not found");
  if (row.executorId !== "server" || !row.resolvedCwd) throw new CallError("forbidden", "Capture belongs to another host");
  if (name === "result") return json(await readExecutionChanges(row));
  await captureExecutionChanges(ports, row.runId);
  return { captured: true };
}
async function cleanup(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  const principal = principalSchema.parse(args.principal);
  if (principal.workspaceId !== workspaceId) throw new CallError("forbidden", "Workspace cleanup scope mismatch");
  if (!ports.executionWorkspaces) throw new CallError("unavailable", "Workspace cleanup is unavailable");
  return json(await ports.executionWorkspaces.cleanup(principal, workCleanupInputSchema.parse(args.input)));
}
async function prepare(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  if (!ports.executionServerWorkspace) throw new CallError("unavailable", "Server workspace preparation is not configured");
  const request = args.request as unknown as ServerWorkspaceRequest;
  if (request.principal.workspaceId !== workspaceId) throw new CallError("forbidden", "Workspace preparation scope mismatch");
  if (held(ports).size >= 64) throw new CallError("capacity", "Workspace preparation capacity exhausted");
  const prepared = await ports.executionServerWorkspace.prepare(request), lockId = randomUUID();
  held(ports).set(lockId, { workspaceId, prepared });
  const { release: _release, ...view } = prepared;
  return json({ lockId, ...view });
}
function release(ports: StewardPorts, workspaceId: string, lockId: string) {
  const row = held(ports).get(lockId);
  if (!row || row.workspaceId !== workspaceId) throw new CallError("not_found", "Workspace lock not found");
  row.prepared.release(); held(ports).delete(lockId);
  return { released: true };
}
/** Preparation I/O is outside the writer transaction; the module retains its lock until explicit release. */
export function registerWorkspaceModule() {
  registerLocalModule({ name: "workspace-local", description: "Local execution workspace", unrecorded: ["prepare", "release", "cleanup", "capture", "result", "rules"],
    tools: [
      tool("prepare", "Prepare an authorized workspace", {}, [], { visibility: ["kernel"], input: z.object({ request: requestSchema }).strict(), output: preparedSchema }),
      tool("release", "Release a preparation lock", {}, [], { visibility: ["kernel"], input: z.object({ lockId: z.string().uuid() }).strict(), output: z.object({ released: z.literal(true) }).strict() }),
      tool("cleanup", "Receipt-first workspace cleanup", {}, [], { visibility: ["kernel"], input: z.object({ principal: principalSchema, input: workCleanupInputSchema }).strict(), output: workCleanupReceiptSchema }),
      tool("rules", "Read selected project rules", {}, [], { visibility: ["kernel"], input: z.object({ runId: z.string().min(1) }).strict(), output: z.object({ text: z.string().max(32_000) }).strict() }),
      tool("capture", "Capture stopped execution files", {}, [], { visibility: ["kernel"], input: z.object({ runId: z.string().min(1) }).strict(), output: z.object({ captured: z.literal(true) }).strict() }),
      tool("result", "Read immutable execution capture", {}, [], { visibility: ["kernel"], input: z.object({ attemptId: z.string().min(1) }).strict(), output: executionChangesSchema.nullable() }),
    ],
    async handle({ ports, workspaceId }, name, args) {
      if (name === "rules") return projectRules(ports, workspaceId, String(args.runId));
      if (name === "capture" || name === "result") return executionCapture(ports, workspaceId, name, args);
      if (name === "cleanup") return cleanup(ports, workspaceId, args);
      if (name === "release") return release(ports, workspaceId, String(args.lockId));
      return prepare(ports, workspaceId, args);
    },
  });
}
export async function prepareLocalWorkspace(ports: StewardPorts, request: ServerWorkspaceRequest): Promise<Omit<PreparedServerWorkspace, "release"> & { release(): Promise<void> }> {
  registerWorkspaceModule();
  const { lockId, ...prepared } = await runtimeCall<Omit<PreparedServerWorkspace, "release"> & { lockId: string }>(ports, request.principal.workspaceId, "workspace-local.prepare", { request });
  return { ...prepared, async release() { await runtimeCall(ports, request.principal.workspaceId, "workspace-local.release", { lockId }); } };
}
