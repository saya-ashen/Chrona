import { join } from "node:path";
import { kernelAgentInputs, providerNativeOutput, runtimeTranscriptSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import { publicSystemTools } from "./tool-contract-declarations";
import type { SystemModule } from "../modules/module-system-types";
import { CallError } from "../modules/module-call-error";
import { json } from "./shared";
import { assertApprovedAgentPrincipal } from "../agent/agent-context-admission";
import { admitContextPrimitive, ownedRun, view, type ModulePrincipal } from "../agent/agent-context";
import { assertAgentInterruptPrincipal } from "../agent/agent-context-admission";
import { contextInteractions } from "../agent/agent-context-read";
import { callProviderEndpoint, listAgentProviders, registerAgentProvider, runProviderBinding, providerSnapshot } from "../agent/agent-provider";
import { maskProviderPayload } from "../agent/agent-provider-redaction";
import { liveRuns } from "../execution/runs";
import { finishRunFromProviderStatus } from "../agent/agent-provider-finalization";
import type { StewardPorts } from "../ports";

function cursorSequence(cursor: string | undefined, runId: string, kind: string) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { runId: string; kind: string; sequence: number };
    if (value.runId !== runId || value.kind !== kind || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error();
    return value.sequence;
  } catch { throw new CallError("invalid", "Read cursor belongs to another Run or view"); }
}
async function read(ports: StewardPorts, principal: ModulePrincipal, args: ReturnType<typeof kernelAgentInputs.read.parse>) {
  const after = cursorSequence(args.cursor, args.runId, args.view), until = Date.now() + args.waitMs;
  let run = await ownedRun(ports.db, principal, args.runId);
  let rows;
  for (;;) {
    rows = await ports.db.runEvent.findMany({ where: { runId: run.id, sequence: { gt: after }, kind: args.view === "native" ? "raw" : { not: "raw" } }, orderBy: { sequence: "asc" }, take: args.limit });
    if (rows.length || !view(run).active || Date.now() >= until) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
    await assertApprovedAgentPrincipal(ports.db, principal);
    run = await ownedRun(ports.db, principal, args.runId);
  }
  let transcript;
  let transcriptState: { status: "available" | "pending" | "unavailable"; reason?: string } = { status: "unavailable", reason: "Provider does not expose normalized transcripts" };
  if (args.view === "native" && !rows.length && after === 0 && !view(run).active) throw new CallError("unavailable", "Provider retained no native output for this Run");
  if (args.view === "normalized") {
    try {
      const binding = await runProviderBinding(ports, principal.workspaceId, run.id), declaration = providerSnapshot(binding.declaration);
      if (declaration.endpoints.transcript) {
        const raw = await callProviderEndpoint(ports, principal.workspaceId, binding, "transcript", { sessionDir: join(ports.dataDir, "sessions", run.sessionId!, ".chrona", "sessions"), limit: args.limit });
        // A normalized conversation is a collection of messages, not a native RPC reply.
        // Keep its complete bounded transcript below the 32 MiB module transport envelope.
        transcript = runtimeTranscriptSchema.parse(maskProviderPayload(runtimeTranscriptSchema.parse(raw), [], 16 * 1024 * 1024));
        transcriptState = { status: "available" };
      }
    } catch (error) {
      // Retained Run records remain readable while optional live transcript delivery is unavailable.
      if (!(error instanceof CallError) || !["unavailable", "not_found", "unknown", "forbidden", "conflict"].includes(error.code)) throw error;
      transcriptState = { status: "pending", reason: error.message };
      console.error(JSON.stringify({ component: "agent", event: "transcript.pending", runId: run.id, error: error.message }));
    }
  }
  const items = rows.map(row => ({ sequence: row.sequence, at: row.createdAt.toISOString(), kind: row.kind, payload: row.payload }));
  const sequence = items.at(-1)?.sequence ?? after;
  return { run: view(run), items, nextCursor: view(run).active || items.length === args.limit ? Buffer.from(JSON.stringify({ runId: run.id, kind: args.view, sequence })).toString("base64url") : null, ended: !view(run).active, interactions: await contextInteractions(ports, run), ...(args.view === "normalized" ? { transcriptState } : {}), ...(transcript ? { transcript } : {}) };
}

export const agent: SystemModule = {
  name: "agent", description: "Registered providers and caller-owned durable Agent Runs.", tools: publicSystemTools.agent,
  unrecorded: ["register", "providers", "run", "read", "write", "stop", "native"],
  async handle({ ports, workspaceId, caller, call, run: scope }, name, raw) {
    if (name === "register") return json(await registerAgentProvider(ports, workspaceId, caller, kernelAgentInputs.register.parse(raw)));
    if (name === "providers") return json(await listAgentProviders(ports, workspaceId, kernelAgentInputs.providers.parse(raw)));
    if (caller.kind !== "module") throw new CallError("forbidden", "Agent Runs require their actual module caller");
    const principal = { workspaceId, ownerId: "owner", caller } satisfies ModulePrincipal;
    if (name === "read") await assertApprovedAgentPrincipal(ports.db, principal);
    if (name === "read") return json(await read(ports, principal, kernelAgentInputs.read.parse(raw)));
    if (!call?.key) throw new CallError("invalid", "Agent commands require a call key");
    if (name === "run") {
      const args = kernelAgentInputs.run.parse(raw);
      return json(await admitContextPrimitive(ports, principal, "run", { ...args, requestKey: call.key, providerRegistration: true, ...(scope ? { callScope: { moduleRunId: scope.moduleRunId, eventKey: scope.eventKey } } : {}) }));
    }
    if (name === "write") {
      const args = kernelAgentInputs.write.parse(raw);
      if (args.input.kind === "answer") {
        const binding = await runProviderBinding(ports, workspaceId, args.runId);
        if (!providerSnapshot(binding.declaration).capabilities.interactions) throw new CallError("unavailable", "Provider does not support interactions");
        return json(await admitContextPrimitive(ports, principal, "respond", { runId: args.runId, requestKey: call.key, questionId: args.input.questionId, answer: args.input.answer }));
      }
      const command = { runId: args.runId, requestKey: call.key, message: args.input.text };
      const admission = await admitContextPrimitive(ports, principal, "write", command) as { perform: boolean };
      if (admission.perform) {
        const handle = liveRuns.get(args.runId);
        if (!handle) throw new CallError("unknown", "Run operation is disconnected and requires reconciliation");
        await handle.inject(args.input.text);
        await admitContextPrimitive(ports, principal, "write", command, true);
      }
      return { accepted: true };
    }
    if (name === "stop") {
      const args = kernelAgentInputs.stop.parse(raw), command = { ...args, requestKey: call.key };
      await assertAgentInterruptPrincipal(ports.db, principal, args.runId);
      const admission = await admitContextPrimitive(ports, principal, "interrupt", command) as { perform: boolean };
      if (admission.perform) {
        const binding = await runProviderBinding(ports, workspaceId, args.runId), handle = liveRuns.get(args.runId);
        if (handle) await handle.abort();
        else if (await ports.db.providerLaunch.findUnique({ where: { runId: args.runId } })) await callProviderEndpoint(ports, workspaceId, { ...binding, requestKey: `provider-stop:${args.runId}:${call.key}` }, "abort", { operationId: args.runId });
        await admitContextPrimitive(ports, principal, "interrupt", command, true);
        const status = await callProviderEndpoint(ports, workspaceId, binding, "status", { operationId: args.runId }).catch(error => {
          console.error(JSON.stringify({ component: "agent", event: "stop_status.failed", runId: args.runId, error: String(error) }));
          return null;
        });
        await finishRunFromProviderStatus(ports, workspaceId, args.runId, status);
      }
      const current = await ownedRun(ports.db, principal, args.runId);
      return json({ ...view(current), stopConfirmed: current.stopStatus === "confirmed" });
    }
    if (name === "native") {
      const args = kernelAgentInputs.native.parse(raw);
      await ownedRun(ports.db, principal, args.runId);
      const binding = await runProviderBinding(ports, workspaceId, args.runId);
      if (!providerSnapshot(binding.declaration).capabilities.native) throw new CallError("unavailable", "Provider has no native interface");
      const command = { ...args, requestKey: call.key };
      const admission = await admitContextPrimitive(ports, principal, "native", command) as { perform: boolean; result: unknown };
      if (!admission.perform) return json(admission.result);
      if (!await ports.db.providerLaunch.findUnique({ where: { runId: args.runId } })) throw new CallError("conflict", "Provider operation has not started");
      const output = providerNativeOutput.parse(await callProviderEndpoint(ports, workspaceId, { ...binding, requestKey: `provider-native:${args.runId}:${call.key}` }, "native", { operationId: args.runId, request: args.request }));
      const result = providerNativeOutput.parse(maskProviderPayload(output));
      await admitContextPrimitive(ports, principal, "native", command, true, { perform: false, operationId: args.runId, result } as Prisma.InputJsonValue);
      return json(result);
    }
    throw new CallError("not_found", "Unknown Agent tool");
  },
};
