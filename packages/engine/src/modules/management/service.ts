/* eslint-disable complexity -- Idempotency and all local mutation branches share one atomic command boundary. */
import { db, withDatabaseTransaction } from "@/lib/db";
import type { Prisma, ManagementCommand } from "@/generated/prisma/client";
import { managementTools, managementCreateSchema, managementUpdateSchema, managementActionSchema, managementDeleteSchema, managementSearchSchema, managementReadSchema, type ManagementToolName } from "@chrona/contracts/api";
import { stableJsonHash } from "../ai";
import { appendCanonicalEvent, withCommandActor } from "../events";
import { refreshManagementClient, requireManagementClient, type ManagementIdentity } from "./clients";
import { ManagementError, managementFailure, managementSuccess } from "./errors";
import { assertRevision, managementTaskSnapshot, readManagementContext, readManagementTask, requireScopes, scopedTask, searchManagementTasks } from "./reads";
import { createManagedTask, prepareManagedUpdate, updateManagedTask, validateCreation } from "./mutations";
import { actionIsAsync, isManagementControlAction, runManagementAction, validateManagementAction } from "./actions";
import { startManagementWorker } from "./worker";
import type { ManagementDeps } from "./types";

export const managementJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function commandReceipt(command: ManagementCommand, replayed = false) {
  return { commandId: command.id, requestId: command.requestId, taskId: command.taskId, phase: command.phase, state: command.state, errorCode: command.errorCode, replayed, recordedAt: command.updatedAt.toISOString(), result: command.result };
}
export function createManagementService(deps: ManagementDeps) {
  return {
    authorize: requireManagementClient,
    startWorker: () => startManagementWorker(deps),
    async call(identity: ManagementIdentity, tool: string, raw: unknown) {
      try {
        const client = await refreshManagementClient(identity);
        requireScopes(client, ["tasks:read"]);
        if (!Object.hasOwn(managementTools, tool)) throw new ManagementError("VALIDATION_ERROR", "Unknown management tool");
        if (Buffer.byteLength(JSON.stringify(raw)) > 65_536) throw new ManagementError("VALIDATION_ERROR", "Management input exceeds 64 KiB");
        const name = tool as ManagementToolName;
        const input = managementTools[name].parse(raw);
        if (name === "chrona_context_read") return managementSuccess(await readManagementContext(client));
        if (name === "chrona_task_search") return managementSuccess(await searchManagementTasks(client, managementSearchSchema.parse(raw)));
        if (name === "chrona_task_read") return managementSuccess(await readManagementTask(client, managementReadSchema.parse(raw)));
        if (name === "chrona_task_delete" && managementDeleteSchema.parse(raw).mode === "preview") {
          const value = managementDeleteSchema.parse(raw);
          requireScopes(client, ["tasks:delete"]);
          const task = await scopedTask(client, value.taskId);
          const impact = await deps.tasks.getDeleteImpact({ taskId: value.taskId, workspaceId: client.workspaceId });
          await assertDeleteScope(client, impact.taskIds, impact.assets.map((asset) => asset.id));
          return managementSuccess({ ...(await managementTaskSnapshot(client, task.id)), impact });
        }
        if (name === "chrona_task_create" && managementCreateSchema.parse(raw).dryRun) return managementSuccess({ dryRun: true, normalized: await validateCreation(client, managementCreateSchema.parse(raw)) });
        if (name === "chrona_task_update" && managementUpdateSchema.parse(raw).dryRun) {
          const prepared = await prepareManagedUpdate(client, managementUpdateSchema.parse(raw));
          return managementSuccess({ dryRun: true, taskId: prepared.task.id, changes: Object.keys(managementUpdateSchema.parse(raw).patch), immediatePlanning: prepared.immediate });
        }
        return managementSuccess(await withDatabaseTransaction(async () => {
          const authorized = await refreshManagementClient(client);
          if (!("requestId" in input) || typeof input.requestId !== "string") throw new ManagementError("VALIDATION_ERROR", "requestId is required");
          const payloadHash = stableJsonHash(input);
          const prior = await db.managementCommand.findUnique({ where: { clientId_toolName_requestId: { clientId: authorized.id, toolName: name, requestId: input.requestId } } });
          if (prior) {
            if (prior.payloadHash !== payloadHash) throw new ManagementError("IDEMPOTENCY_CONFLICT", "requestId already identifies a different command");
            // Scope changes may revoke the ability to replay a receipt as well.
            await requireWriteScopes(authorized, name, raw);
            return commandReceipt(prior, true);
          }
          const command = await db.managementCommand.create({ data: { clientId: authorized.id, workspaceId: authorized.workspaceId, toolName: name, requestId: input.requestId, payloadHash, input: managementJson(input) } });
          return withCommandActor({ actorType: "agent", actorId: authorized.id, source: "management_mcp", correlationId: command.id }, async () => {
            let taskId: string, workBlockId: string | null = null, phase = "completed", state = "completed";
            let stageData: unknown = {}, outcome: string;
            if (name === "chrona_task_create") {
              const create = managementCreateSchema.parse(raw);
              await validateCreation(authorized, create);
              const result = await createManagedTask(authorized, create, deps);
              taskId = result.taskId; workBlockId = result.workBlockId; stageData = result.stageData; outcome = "created";
              if (result.immediate) { phase = "planning"; state = "queued"; } else if (create.schedule) phase = "scheduled";
            } else if (name === "chrona_task_update") {
              const result = await updateManagedTask(authorized, managementUpdateSchema.parse(raw), deps);
              taskId = result.taskId; workBlockId = result.workBlockId; stageData = result.stageData; outcome = result.outcome;
              if (result.immediate) { phase = "planning"; state = "queued"; }
            } else if (name === "chrona_task_action") {
              const action = managementActionSchema.parse(raw);
              const scope = await validateManagementAction(authorized, action);
              taskId = action.taskId; workBlockId = scope.workBlockId; outcome = action.action.type;
              if (actionIsAsync(action)) { phase = action.action.type === "generate_plan" ? "planning" : isManagementControlAction(action) ? "control" : "action"; state = "queued"; }
              else await runManagementAction(authorized, action, deps, `management:${command.id}`);
            } else {
              const deletion = managementDeleteSchema.parse(raw);
              if (deletion.mode !== "delete") throw new ManagementError("VALIDATION_ERROR", "Expected deletion command");
              requireScopes(authorized, ["tasks:delete"]);
              const task = await scopedTask(authorized, deletion.taskId);
              assertRevision(task, deletion.expectedRevision);
              await assertDeleteScope(authorized, deletion.expectedTaskIds, deletion.expectedAssetIds);
              await deps.tasks.delete({ taskId: task.id, workspaceId: authorized.workspaceId, expectedTaskIds: deletion.expectedTaskIds, expectedAssetIds: deletion.expectedAssetIds });
              taskId = task.id; outcome = "deleted";
            }
            if (outcome !== "deleted") await appendCanonicalEvent({ eventType: "task.management_command", workspaceId: authorized.workspaceId, taskId, actorType: "agent", actorId: authorized.id, source: "management_mcp", correlationId: command.id, payload: { commandId: command.id, tool: name, outcome, phase }, summary: `Management command: ${outcome}`, dedupeKey: `management:${command.id}:submitted` });
            const snapshot = outcome === "deleted" ? { taskId } : await managementTaskSnapshot(authorized, taskId);
            const updated = await db.managementCommand.update({ where: { id: command.id }, data: { taskId, workBlockId, state, phase, stageData: managementJson(stageData), result: managementJson({ outcome, ...snapshot }) } });
            return commandReceipt(updated);
          });
        }));
      } catch (error) { return managementFailure(error); }
    },
  };
}
async function assertDeleteScope(client: ManagementIdentity, taskIds: string[], assetIds: string[]) {
  const assets = await db.goalAsset.count({ where: { id: { in: assetIds }, goal: { workspaceId: client.workspaceId } } });
  if (assets !== new Set(assetIds).size) throw new ManagementError("NOT_FOUND", "Deletion impact contains an unavailable asset");
  const count = await db.task.count({ where: { id: { in: taskIds }, workspaceId: client.workspaceId } });
  if (count !== new Set(taskIds).size) throw new ManagementError("NOT_FOUND", "Deletion impact contains an unavailable task");
}
async function requireWriteScopes(client: ManagementIdentity, name: ManagementToolName, raw: unknown) {
  // Replay validates capability, not mutable task state/provider availability.
  if (name === "chrona_task_delete") return requireScopes(client, ["tasks:delete"]);
  if (name === "chrona_task_action") {
    const { actionScopes } = await import("./actions");
    return requireScopes(client, actionScopes(managementActionSchema.parse(raw)));
  }
  requireScopes(client, ["tasks:write"]);
  const input = name === "chrona_task_create" ? managementCreateSchema.parse(raw) : managementUpdateSchema.parse(raw).patch;
  if (input.schedule !== undefined || input.dueAt !== undefined || input.recurrence !== undefined) requireScopes(client, ["schedule:write"]);
  if (input.mode && input.mode !== "todo" || input.timing) requireScopes(client, ["plans:write"]);
  if (input.mode === "automatic" || input.executionConfig || input.start || input.aiClientId !== undefined) requireScopes(client, ["executions:control"]);
}
