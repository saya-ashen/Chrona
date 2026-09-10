/* eslint-disable complexity -- Durable phases and ownership checks stay explicit around every side-effect boundary. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, withDatabaseTransaction } from "@/lib/db";
import type { ManagementCommand, Prisma } from "@/generated/prisma/client";
import { managementActionSchema, managementScopeSchema } from "@chrona/contracts/api";
import { withCommandActor, appendCanonicalEvent } from "../events";
import { updateTask } from "../tasks/update-task";
import { automationTimingSchema } from "@chrona/contracts";
import { refreshManagementClient, type ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { assertRevision, configRevision, managementTaskSnapshot, record, requireScopes, scopedTask } from "./reads";
import { resolveExecutionScope } from "../plan-execution/persistence/execution-scope";
import { actionScopes, runManagementAction, validateManagementAction } from "./actions";
import type { ManagementDeps } from "./types";

const LEASE_MS = 120_000;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const desiredSchema = z.object({ autoPlanGeneration: z.boolean(), autoExecute: z.boolean(), autoPlanGenerationTiming: automationTimingSchema, autoExecuteTiming: automationTimingSchema });

async function identityFor(command: ManagementCommand): Promise<ManagementIdentity> {
  const client = await db.managementClient.findUnique({ where: { id: command.clientId } });
  if (!client || client.workspaceId !== command.workspaceId) throw new ManagementError("AUTH_REQUIRED", "Client no longer authorized");
  const identity = await refreshManagementClient({ ...client, scopes: z.array(managementScopeSchema).parse(client.scopes) });
  requireScopes(identity, ["tasks:read"]);
  return identity;
}

/** One tick is exported for deterministic recovery tests. No network work runs in a DB transaction. */
export async function processNextManagementCommand(deps: ManagementDeps, owner = randomUUID(), lane: "all" | "normal" | "control" = "all"): Promise<boolean> {
  const command = await withDatabaseTransaction(async () => {
    const now = new Date();
    const candidate = await db.managementCommand.findFirst({ where: { ...(lane === "control" ? { phase: "control" } : lane === "normal" ? { phase: { not: "control" } } : {}), OR: [{ state: "queued" }, { state: "running", leaseUntil: { lt: now } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!candidate) return null;
    const claimed = await db.managementCommand.updateMany({ where: { id: candidate.id, state: candidate.state, leaseOwner: candidate.leaseOwner, leaseUntil: candidate.leaseUntil }, data: { state: "running", leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS) } });
    return claimed.count === 1 ? candidate : null;
  });
  if (!command) return false;
  let leaseLost = false;
  const owned = { id: command.id, state: "running", leaseOwner: owner };
  const heartbeat = setInterval(() => {
    void db.managementCommand.updateMany({ where: { ...owned, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).then((result) => { if (!result.count) leaseLost = true; }).catch(() => { leaseLost = true; });
  }, LEASE_MS / 4);
  heartbeat.unref();
  async function checkpoint(data: Prisma.ManagementCommandUpdateManyMutationInput) {
    if (leaseLost) throw new ManagementError("LEASE_LOST", "Command ownership changed");
    const result = await db.managementCommand.updateMany({ where: { ...owned, leaseUntil: { gt: new Date() } }, data });
    if (!result.count) { leaseLost = true; throw new ManagementError("LEASE_LOST", "Command ownership changed"); }
  }
  try {
    // An external dispatch may already have succeeded before process death. Never
    // start a second execution from a transport retry or an expired lease.
    if (command.phase === "dispatching") {
      await checkpoint({ state: "uncertain", errorCode: "EXECUTION_OUTCOME_UNKNOWN", leaseOwner: null, leaseUntil: null });
      return true;
    }
    const client = await identityFor(command);
    const taskId = command.taskId;
    if (!taskId) throw new ManagementError("NOT_FOUND", "Command task missing");
    await scopedTask(client, taskId, command.workBlockId ?? undefined);
    await withCommandActor({ actorType: "agent", actorId: client.id, source: "management_mcp", correlationId: command.id }, async () => {
      const key = `management:${command.id}`;
      const isAction = command.toolName === "chrona_task_action";
      const input = isAction ? managementActionSchema.parse(command.input) : null;
      const pinnedScope = await resolveExecutionScope(taskId, { workBlockId: command.workBlockId });
      if (pinnedScope.workBlockId !== command.workBlockId) throw new ManagementError("REVISION_CONFLICT", "Execution occurrence changed while command was queued");
      if (input) await validateManagementAction(client, { ...input, workBlockId: command.workBlockId ?? undefined });
      requireScopes(client, input ? actionScopes(input) : ["tasks:write", "plans:write"]);
      let stage = record(command.stageData);
      const desired = isAction ? null : desiredSchema.parse(stage.desiredAutomation);
      if (desired?.autoExecute) requireScopes(client, ["executions:control"]);
      if (command.phase === "planning") {
        if (!isAction) assertRevision(await scopedTask(client, taskId), String(stage.expectedRevision));
        const action = input?.action.type === "generate_plan" ? input.action : null;
        await checkpoint({ phase: "planning" });
        const generation = await deps.plan.generate({ taskId, workBlockId: command.workBlockId, idempotencyKey: `${key}:plan`, forceRefresh: action?.forceRefresh, userInstruction: action?.userInstruction });
        let committed: { planId: string; headStateVersion: number } | null = null;
        try {
          for await (const event of generation.events) {
            if (leaseLost) throw new ManagementError("LEASE_LOST", "Command ownership changed");
            if (event.type === "committed") committed = { planId: event.planId, headStateVersion: event.headStateVersion };
            if (["failed", "cancelled", "stale"].includes(event.type)) throw new ManagementError("PLAN_GENERATION_FAILED", "Plan generation did not commit");
          }
        } finally { generation.finish(); }
        if (!committed) throw new ManagementError("PLAN_GENERATION_FAILED", "Plan generation did not commit");
        stage = { ...stage, ...committed };
        await checkpoint({ phase: "accepting", stageData: json(stage) });
      }
      // Accept + restore configuration + transition are atomic. A UI edit while
      // planning invalidates the intent rather than being overwritten.
      if (command.phase === "planning" || command.phase === "accepting") {
        await withDatabaseTransaction(async () => {
          const fresh = await identityFor(command);
          requireScopes(fresh, input ? actionScopes(input) : ["tasks:write", "plans:write", ...(desired?.autoExecute ? ["executions:control"] : [])]);
          await checkpoint({ phase: "accepting" });
          if (desired) {
            assertRevision(await scopedTask(fresh, taskId), String(stage.expectedRevision));
            if (desired.autoExecute) await deps.plan.accept({ taskId, workBlockId: command.workBlockId, workspaceId: client.workspaceId, planId: z.string().parse(stage.planId), expectedHeadStateVersion: z.number().parse(stage.headStateVersion), idempotencyKey: `${key}:accept` });
            await updateTask({ taskId, ...desired }, { deferAutomation: true });
            stage = { ...stage, expectedRevision: configRevision((await scopedTask(fresh, taskId)).configRevision) };
          }
          const immediateExecution = desired?.autoExecute && stage.start === "now";
          await checkpoint({ stageData: json(stage), phase: immediateExecution ? "ready_to_execute" : "completed", state: immediateExecution ? "running" : "completed", result: json({ ...await managementTaskSnapshot(fresh, taskId), planId: stage.planId, outcome: immediateExecution ? "plan_accepted" : desired?.autoExecute ? "scheduled" : "plan_ready" }), ...(immediateExecution ? {} : { leaseOwner: null, leaseUntil: null }) });
        });
        if (!(desired?.autoExecute && stage.start === "now")) return;
      }
      const fresh = await identityFor(command);
      requireScopes(fresh, input ? actionScopes(input) : ["executions:control"]);
      const currentTask = await scopedTask(fresh, taskId, command.workBlockId ?? undefined);
      if (!input) assertRevision(currentTask, String(stage.expectedRevision));
      // Commit dispatch marker before the call: crash recovery reports uncertainty,
      // not fictitious failure/completion and never blindly repeats provider effects.
      await checkpoint({ phase: "dispatching" });
      if (input) {
        await runManagementAction(fresh, { ...input, workBlockId: command.workBlockId ?? undefined }, deps, key);
      } else {
        await deps.execution.dispatch({ taskId, action: { action: "start_manual", workBlockId: command.workBlockId ?? undefined, idempotencyKey: `${key}:execute` }, commandContext: { actor: { type: "agent", actorId: fresh.id }, origin: { channel: "mcp_tool", requestId: key } } });
      }
      await withDatabaseTransaction(async () => {
        await checkpoint({ state: "completed", phase: "completed", leaseOwner: null, leaseUntil: null, result: json({ ...await managementTaskSnapshot(fresh, taskId), outcome: "action_applied" }) });
        await appendCanonicalEvent({ workspaceId: fresh.workspaceId, taskId, eventType: "task.management_command_completed", actorType: "agent", actorId: fresh.id, source: "management_mcp", correlationId: command.id, payload: { commandId: command.id }, dedupeKey: `${key}:completed` });
      });
    });
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Heartbeat callbacks can change ownership during awaited provider work.
    if (!leaseLost) {
      const current = await db.managementCommand.findUnique({ where: { id: command.id }, select: { phase: true } });
      const uncertain = current?.phase === "dispatching";
      await checkpoint({ state: uncertain ? "uncertain" : "failed", errorCode: uncertain ? "EXECUTION_OUTCOME_UNKNOWN" : error instanceof ManagementError ? error.code : "COMMAND_FAILED", leaseOwner: null, leaseUntil: null }).catch(() => { /* A new owner now controls recovery. */ });
    }
  } finally { clearInterval(heartbeat); }
  return true;
}

export function startManagementWorker(deps: ManagementDeps) {
  const active = new Set<Promise<unknown>>(), control = new Set<Promise<unknown>>();
  let stopped = false;
  function launch(set: Set<Promise<unknown>>, lane: "normal" | "control") {
    const work = processNextManagementCommand(deps, randomUUID(), lane).catch(() => false).finally(() => { set.delete(work); });
    set.add(work);
  }
  function tick() {
    if (stopped) return;
    // Long provider calls cannot occupy the slot needed to stop/pause them.
    if (control.size === 0) launch(control, "control");
    if (active.size < 2) launch(active, "normal");
  }
  const timer = setInterval(tick, 1_000);
  timer.unref();
  tick();
  return { async stop() { stopped = true; clearInterval(timer); await Promise.allSettled([...active, ...control]); } };
}
