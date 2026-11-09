import { publicSystemTools, consumerInput, ackInput, withdrawalsInput } from "./tool-contract-declarations";
import { z } from "zod";
import { CallError, type Caller, type SystemModule } from "../module-calls";
import type { StewardPorts } from "../ports";
import { runtimeHealth } from "../runtime-health";
import { createProviderControl } from "../provider-channel";
import { activityRecords } from "../activity";
import { acknowledgeKernelFacts, factConsumer, readKernelFacts, selectFactConsumer, withdrawnKernelKeys } from "../notification-facts";
import { json, requireOwner } from "./shared";

async function consumer(ports: StewardPorts, workspaceId: string, caller: Caller, args: z.infer<typeof consumerInput>) {
  await requireOwner(ports.db, workspaceId, caller);
  return args.module === undefined ? factConsumer(ports.db, workspaceId) : selectFactConsumer(ports.db, workspaceId, args.module, ports.now());
}
/** Governed audit and finite facts only. Applications own wording, aggregation and delivery. */
export const activity: SystemModule = {
  name: "activity",
  description: "活动事实：受控审计记录和单个选定应用消费的内核事实；不组织页面或投递通知。",
  unrecorded: ["facts", "ack", "withdrawals"],
  tools: publicSystemTools.activity,
  async handle({ ports, workspaceId, caller }, name, args) {
    if (name === "runtime") return json(await runtimeHealth(ports, workspaceId));
    if (name === "runs") return json(await createProviderControl(ports, workspaceId).list(args.session === undefined ? undefined : String(args.session)));
    if (name === "records") return json(await activityRecords(ports, workspaceId, { ...(args.before ? { before: String(args.before) } : {}) }));
    if (name === "consumer") return json(await consumer(ports, workspaceId, caller, args as z.infer<typeof consumerInput>));
    if (name === "facts") return json(await readKernelFacts(ports.db, workspaceId, caller));
    if (name === "withdrawals") { const input = args as z.infer<typeof withdrawalsInput>; return json(await withdrawnKernelKeys(ports.db, workspaceId, caller, input.revision, input.keys)); }
    if (name === "ack") { const input = args as z.infer<typeof ackInput>; return json(await acknowledgeKernelFacts(ports.db, workspaceId, caller, input.revision, input.ids)); }
    throw new CallError("not_found", `activity.${name} not found`);
  },
};
