import { assertExecutionReceiver, deliverExecutionApplication, CallError, type StewardPorts } from "@chrona/kernel";
import type { ExecutionReceiver } from "@chrona/contracts/steward";

/** The selected owner workspace, never a device supplied workspace/module/header. */
export async function remoteExecutionReceiver(ports: StewardPorts): Promise<ExecutionReceiver> {
  const module = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId: "ws_default", name: "remote-execution" } } });
  if (!module?.activeHash) throw new CallError("unavailable", "Remote execution application is unavailable");
  const receiver = { workspaceId: module.workspaceId, moduleId: module.id, hash: module.activeHash, activationId: module.activationId };
  await assertExecutionReceiver(ports, receiver);
  return receiver;
}

export async function callRemoteExecution(ports: StewardPorts, tool: string, input: string, caller: "kernel" | "owner" = "kernel") {
  const receiver = await remoteExecutionReceiver(ports);
  await deliverExecutionApplication(ports, receiver, "bind", { input: JSON.stringify({ version: 1, workspaceId: receiver.workspaceId, ownerId: "owner", app: { moduleId: receiver.moduleId, hash: receiver.hash, activationId: receiver.activationId } }) });
  return deliverExecutionApplication(ports, receiver, tool, { input }, caller);
}
