import { z } from "zod";
import { isEntryModule } from "@chrona/contracts/steward";
import * as outputs from "../system-outputs";
import { CallError, type Caller, type SystemModule } from "../module-calls";
import type { StewardPorts } from "../ports";
import { runtimeHealth } from "../runtime-health";
import { createProviderControl } from "../provider-channel";
import { activityRecords, activityRecordsOutput } from "../activity";
import { acknowledgeKernelFacts, factConsumer, kernelFactSchema, readKernelFacts, selectFactConsumer, withdrawnKernelKeys } from "../notification-facts";
import { tool, text, json, callerManifest } from "./shared";

const consumerInput = z.object({ module: z.string().min(1).nullable().optional() }).strict();
const ackInput = z.object({ revision: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(100) }).strict();
const withdrawalsInput = z.object({ revision: z.string().min(1), keys: z.array(z.string().max(4000)).min(1).max(100) }).strict();
const consumerOutput = z.object({ moduleId: z.string().nullable(), revision: z.string() });
async function consumer(ports: StewardPorts, workspaceId: string, caller: Caller, args: z.infer<typeof consumerInput>) {
  if (caller.kind !== "owner") {
    const manifest = caller.kind === "module" ? await callerManifest(ports.db, caller) : null;
    if (!manifest?.uses.includes("*") || !isEntryModule(manifest)) throw new CallError("forbidden", "Only an owner entry may select a fact consumer");
  }
  return args.module === undefined ? factConsumer(ports.db, workspaceId) : selectFactConsumer(ports.db, workspaceId, args.module, ports.now());
}
/** Governed audit and finite facts only. Applications own wording, aggregation and delivery. */
export const activity: SystemModule = {
  name: "activity",
  description: "活动事实：受控审计记录和单个选定应用消费的内核事实；不组织页面或投递通知。",
  unrecorded: ["facts", "ack", "withdrawals"],
  tools: [
    tool("runtime", "Runtime health facts without application presentation.", {}, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.runtimeOutput) }),
    tool("runs", "Bounded execution status, progress, usage and pending interactions. Read-only runtime facts; no transcript or execution authority.", { session: text("Optional exact session id") }, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.runsOutput) }),
    tool("records", "Bounded workspace audit facts, newest first. Only allowlisted metadata; never raw details or credential values.", { before: text("ISO time from the previous page") }, [], { idempotent: true, visibility: ["modules", "owner"], output: activityRecordsOutput }),
    tool("consumer", "Owner selects one active application id to consume kernel facts, or null for none. Pause the previous consumer before switching. Omit module to read the selection. Confirmed facts never replay on a switch.", {}, [], { visibility: ["owner"], input: consumerInput, output: consumerOutput }),
    tool("facts", "Selected application only: up to 50 pending finite kernel facts. Persist privately, then acknowledge before delivery. Not a generic audit or invocation dump.", {}, [], { idempotent: true, visibility: ["modules"], output: z.object({ revision: z.string(), facts: z.array(z.intersection(z.object({ id: z.string(), at: z.string().datetime() }), kernelFactSchema)).max(50) }) }),
    tool("withdrawals", "Selected application only: reconcile up to 100 private notification keys against durable withdrawals, including withdrawals consumed by another application. Check queued notifications before delivery after recovery or selection changes.", {}, [], { idempotent: true, visibility: ["modules"], input: withdrawalsInput, output: z.object({ withdrawn: z.array(z.string()).max(100) }) }),
    tool("ack", "Selected application only: acknowledge durable private ingestion under the current selection revision. Returns ids consumed by this application, including repeats; ids consumed by another application are excluded.", {}, [], { idempotent: true, visibility: ["modules"], input: ackInput, output: z.object({ acknowledged: z.array(z.string()).max(100) }) }),
  ],
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
