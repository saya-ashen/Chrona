import { createHash } from "node:crypto";
import type { StewardPorts } from "./ports";
import { runtimeStartSchema, agentInput } from "@chrona/contracts/steward";
import { authenticateRun } from "./run-auth";
import { StewardError } from "./errors";
import type { Caller } from "./module-system-types";

/** Immutable identity is established by registration and checked again by the supervisor before delivery. */
export async function isAgentApplication(ports: StewardPorts, caller: { moduleId: string; hash: string }, workspaceId: string) {
  const module = await ports.db.module.findFirst({ where: { id: caller.moduleId, workspaceId, name: "agent", builtin: true, status: "active", activeHash: caller.hash } });
  if (!module) return false;
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: caller.hash } } });
  return version?.source === "builtin" && version.status === "approved";
}
export async function authorizeAgentRequest(ports: StewardPorts, workspaceId: string, name: string, raw: Record<string, unknown>, caller: Caller) {
  name = name.replace(/^work-/, "");
  if (name === "projects" && caller.kind !== "module") throw new StewardError("forbidden", "Agent projects requires an admitted module caller");
  // Configure is an owner tool; routing and the live Agent callback both check its authority.
  if (name === "configure" && caller.kind === "owner") return;
  if (caller.kind === "module") {
    if (!await ports.db.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active" }, select: { id: true } })) throw new StewardError("forbidden", "Agent caller is no longer active");
    return;
  }
  if (name === "complete" || name === "completion") throw new StewardError("forbidden", "Completion requires an admitted application caller");
  if (caller.kind !== "kernel") throw new StewardError("forbidden", "Agent requires an admitted caller");
  let args: Record<string, unknown>;
  try { args = agentInput(name, JSON.parse(String(raw.input))); }
  catch { throw new StewardError("invalid", "Invalid Agent request"); }
  if (name !== "start") return;
  const input = runtimeStartSchema.parse(args), digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await ports.db.$transaction(async tx => {
    const authenticated = await authenticateRun(tx, input.token, ports.now());
    const { run } = authenticated;
    if ([authenticated.workspaceId !== workspaceId, run.id !== input.runId, input.operationId !== run.id, run.cwd !== input.cwd, run.lane !== input.lane, run.deadlineAt !== null && (input.deadline === null || new Date(input.deadline) > run.deadlineAt)].some(Boolean)) throw new StewardError("forbidden", "Agent start exceeds the claimed Run");
    const existing = await tx.providerLaunch.findUnique({ where: { runId: run.id } });
    if (existing) {
      if (existing.digest !== digest) throw new StewardError("conflict", "Agent operation identity changed");
      return;
    }
    await tx.providerLaunch.create({ data: { runId: run.id, digest, createdAt: ports.now() } });
  });
}
