import { randomUUID } from "node:crypto";
import { z } from "zod";
import { inputs, awaitingSchema, linkSchema, reportResultSchema, settingsSchema, id } from "./schema";
import { MindStore, capacity, conflict, digest, forbidden, invalid } from "./store";
import { DAY, freshSignal, matches, runtimeView } from "./policy";
import { agendaPage, decisionsPage } from "./responses";
import { addReportCandidate } from "./report-candidates";
import { archivedSignal, archiveSignals, pruneTerminalProposals } from "./retention";
import type { Caller, Concern, NoteInput, Signal, SignalInput, State, Tool } from "./types";

function owner(caller: Caller | undefined, admittedOwner = false) { if (caller?.kind !== "owner" && !(admittedOwner && caller?.kind === "module")) forbidden(); }
function scope(caller: Caller | undefined) {
  if (caller?.kind === "owner") return "owner";
  if (caller?.kind === "module") return `module:${caller.moduleId}`;
  if (caller?.kind === "provider") return `provider:${caller.runId}`;
  return forbidden("Authenticated application or owner required");
}
function json<T>(value: string, schema: z.ZodType<T>): T {
  try { return schema.parse(JSON.parse(value)); } catch { return invalid("Invalid structured JSON input"); }
}
function patchTimes(concern: Concern, args: NoteInput, now: string) {
  const mapping = { "due-at": "dueAt", "revisit-at": "revisitAt", "silent-until": "silentUntil", "expected-progress-at": "expectedProgressAt", "progress-at": "progressAt" } as const;
  for (const [input, field] of Object.entries(mapping)) {
    const value = args[input as keyof typeof mapping];
    if (value !== undefined) concern[field] = value || null;
  }
  if (concern.silentUntil && Date.parse(concern.silentUntil) - Date.parse(now) > 30 * DAY) invalid("Snooze is bounded to 30 days");
  if (concern.progressAt && Date.parse(concern.progressAt) > Date.parse(now)) invalid("Progress must have happened already");
  if (args["due-at"] !== undefined) concern.escalation = "none";
}
// eslint-disable-next-line complexity -- Owner patch fields, proposal acceptance and association changes commit as one bounded mutation.
function note(state: State, args: NoteInput, now: string) {
  let concern = state.concerns.find(c => c.id === args.id);
  if (args.id && !concern) invalid("Unknown concern id");
  const proposal = args["proposal-id"] ? state.proposals.find(p => p.id === args["proposal-id"] && p.status === "pending") : undefined;
  if (args["proposal-id"] && !proposal) invalid("Unknown pending proposal");
  if (!concern) {
    if (!args.title && !proposal) invalid("A new concern needs a title");
    if (state.concerns.length >= 200) capacity("Mind concern capacity reached");
    concern = { id: `c-${randomUUID()}`, revision: 0, title: args.title ?? proposal!.title, goal: proposal?.goal ?? "", project: proposal?.project ?? "", status: "watching", priority: "normal", userExplicit: true,
      dueAt: null, revisitAt: null, silentUntil: null, expectedProgressAt: null, progressAt: null, awaiting: [], links: [], escalation: "none", lastCheckedAt: null, lastAssessment: null, createdAt: now, updatedAt: now };
    state.concerns.push(concern);
  }
  for (const field of ["title", "goal", "project", "status", "priority"] as const) { const value = args[field]; if (value !== undefined) Object.assign(concern, { [field]: value }); }
  if (args["user-explicit"] !== undefined) concern.userExplicit = args["user-explicit"];
  if (args.awaiting !== undefined) concern.awaiting = json(args.awaiting, z.array(awaitingSchema).max(12));
  if (args.links !== undefined) concern.links = json(args.links, z.array(linkSchema).max(20));
  patchTimes(concern, args, now);
  if (concern.links.some(link => Date.parse(link.checkedAt) > Date.parse(now))) invalid("Evidence cannot be checked in the future");
  concern.updatedAt = now; concern.revision++;
  // Associations follow the owner's current exact conditions, including edits or stopping a concern.
  for (const signal of state.signals) {
    if (!matches(concern, signal)) {
      signal.associations = signal.associations.filter(cid => cid !== concern.id);
      signal.reviewed = signal.reviewed.filter(cid => cid !== concern.id);
    } else if (freshSignal(signal, Date.parse(now)) && !signal.associations.includes(concern.id)) signal.associations.push(concern.id);
  }
  if (proposal) { proposal.status = "accepted"; proposal.concernId = concern.id; proposal.updatedAt = now; }
  return { concern };
}
function ingest(state: State, args: SignalInput, caller: Extract<Caller, { kind: "module" }>, now: string) {
  if (Date.parse(args["occurred-at"]) > Date.parse(now) + 60_000) invalid("Signal is in the future");
  if (args["progress-at"] && Date.parse(args["progress-at"]) > Date.parse(args["occurred-at"])) invalid("Progress cannot follow its source observation");
  const fingerprint = digest(argsWithoutKey(args));
  const previous = state.signals.find(s => s.moduleId === caller.moduleId && s.eventId === args["event-id"]);
  if (previous) {
    if (previous.digest !== fingerprint) conflict("Source event-id was reused with different evidence; use a new event-id for a new version");
    return { signalId: previous.id, associations: previous.associations, duplicate: true };
  }
  const archived = archivedSignal(state, caller.moduleId, args["event-id"], fingerprint);
  if (archived) return archived;
  const signal: Signal = {
    id: `s-${randomUUID()}`, digest: fingerprint, source: caller.module, moduleId: caller.moduleId, eventId: args["event-id"], event: args.event, ref: args.ref, version: args.version,
    thread: args.thread, from: args.from, domain: args.domain, kind: args.kind, text: args.text, occurredAt: args["occurred-at"], receivedAt: now, progressAt: args["progress-at"] ?? null,
    associations: [], reviewed: [], dailyReviewedAt: null,
  };
  if (freshSignal(signal, Date.parse(now))) signal.associations = state.concerns.filter(c => matches(c, signal)).map(c => c.id);
  archiveSignals(state, now, signal);
  if (state.signals.length >= 512) capacity("Pending signal capacity reached; review before sending more");
  state.signals.push(signal);
  return { signalId: signal.id, associations: signal.associations, duplicate: false };
}
function argsWithoutKey(args: SignalInput) { const { "request-key": _key, ...rest } = args; return rest; }
// eslint-disable-next-line complexity -- Keep caller, snapshot revision and exact evidence checks adjacent at the report boundary.
function report(state: State, args: z.infer<typeof inputs.report>, caller: Caller | undefined) {
  const decision = state.decisions.find(d => d.id === args["decision-id"]);
  if (!decision || state.runtime.currentDecisionId !== decision.id) forbidden("Report must belong to the current Mind reasoning request");
  // Current Agent contexts call tools as the originating Mind module. Provider callers are also bound when available.
  if (!(caller?.kind === "module" && caller.module === "mind") && !(caller?.kind === "provider" && caller.runId === decision.runId)) forbidden("Only the current Mind reasoning run may report");
  const result = json(args.result, reportResultSchema);
  if (new Set(result.concerns.map(c => c.id)).size !== result.concerns.length) invalid("Duplicate concern in report");
  for (const item of result.concerns) {
    if (!decision.concernIds.includes(item.id) || decision.revisions[item.id] !== item.revision) conflict("Report concern revision is outside this reasoning snapshot");
    if (new Set(item.signalIds).size !== item.signalIds.length || item.signalIds.some(sid => !decision.signalIds.includes(sid) || !state.signals.some(s => s.id === sid && s.associations.includes(item.id) && state.concerns.some(c => c.id === item.id && matches(c, s))))) invalid("Report evidence is outside this concern association");
  }
  const reportId = digest({ decisionId: decision.id, key: args["request-key"], result });
  addReportCandidate(decision, { reportId, result, verified: false });
  return { accepted: true as const, reportId, decisionId: decision.id, pendingVerification: true as const };
}
export class MindService {
  constructor(readonly store: MindStore) {}
  /** Only the local Files adapter calls this after a successful identity/contract-pinned read. */
  observeFile(state: State, observation: { moduleId: string; path: string; version: string; text: string }, now: string) {
    const { moduleId, path, version, text } = observation;
    return ingest(state, inputs.signal.parse({ "request-key": `file:${digest([moduleId, path, version])}`, "event-id": digest([path, version, now]), event: "file.changed", ref: path, version, text, "occurred-at": now }), { kind: "module", module: "files", moduleId, hash: "read-contract" }, now);
  }
  // eslint-disable-next-line complexity -- This dispatcher deliberately makes each public tool's actual-caller policy explicit.
  async tool(name: Tool, raw: unknown, caller: Caller | undefined, now: string, admittedOwner = false): Promise<unknown> {
    const args = inputs[name].parse(raw);
    if (name === "ui-agenda") {
      owner(caller, admittedOwner);
      return agendaPage(await this.store.read(), args as z.infer<typeof inputs.agenda>, now);
    }
    if (name === "agenda") {
      if (!(caller?.kind === "owner" || caller?.kind === "module" && caller.module === "mind" || caller?.kind === "provider")) forbidden("Mind agenda is private");
      const state = await this.store.read();
      if (caller.kind === "provider" && !state.decisions.some(d => d.id === state.runtime.currentDecisionId && d.runId === caller.runId)) forbidden("Provider is outside the current Mind run");
      return agendaPage(state, args as z.infer<typeof inputs.agenda>, now);
    }
    if (name === "decisions") {
      owner(caller, admittedOwner);
      return decisionsPage(await this.store.read(), args as z.infer<typeof inputs.decisions>);
    }
    if (name === "ui-settings") { owner(caller, admittedOwner); return this.settings(args as z.infer<typeof inputs["ui-settings"]>, now); }
    if (name === "check") { owner(caller, admittedOwner); return { runtime: runtimeView(await this.store.read()) }; }
    const mutation = args as { "request-key": string };
    if (name === "note" || name === "ui-dismiss") owner(caller, admittedOwner);
    if (name === "signal" && (caller?.kind !== "module" || caller.module === "mind")) forbidden("Signal identity must come from another authenticated module");
    if ((name === "report" || name === "propose") && !(caller?.kind === "module" || caller?.kind === "provider")) forbidden(name === "report" ? "Owners cannot forge a reasoning report" : "Suggestions require an authenticated module");
    if (name === "report" && !(caller?.kind === "module" && caller.module === "mind" || caller?.kind === "provider")) forbidden("Only the current Mind reasoning run may report");
    return this.store.receipt({ scope: `${scope(caller)}:${name}`, key: mutation["request-key"], payload: args, now }, state => {
      if (name === "note") return note(state, args as NoteInput, now);
      if (name === "ui-dismiss") {
        const proposal = state.proposals.find(p => p.id === (args as z.infer<typeof inputs["ui-dismiss"]>).id && p.status === "pending");
        if (!proposal) invalid("Unknown pending proposal");
        proposal.status = "dismissed"; proposal.updatedAt = now;
        return { proposal };
      }
      if (name === "signal") return ingest(state, args as SignalInput, caller as Extract<Caller, { kind: "module" }>, now);
      if (name === "report") return report(state, args as z.infer<typeof inputs.report>, caller);
      return this.propose(state, args as z.infer<typeof inputs.propose>, caller, now);
    });
  }
  // eslint-disable-next-line complexity -- Validate proposal source ownership and pending-only transitions before any state change.
  private propose(state: State, args: z.infer<typeof inputs.propose>, caller: Caller | undefined, now: string) {
    if (!args.title || !args.reason) invalid("A suggestion needs a title and reason");
    const signalIds = args["signal-ids"] ? json(args["signal-ids"], z.array(id).max(20)) : [];
    if (new Set(signalIds).size !== signalIds.length || signalIds.some(sid => !state.signals.some(s => s.id === sid))) invalid("Unknown or duplicate source signal");
    const current = state.decisions.find(d => d.id === state.runtime.currentDecisionId);
    if (caller?.kind === "provider" && caller.runId !== current?.runId) forbidden("Provider is outside the Mind reasoning run");
    if (caller?.kind === "module" && caller.module !== "mind" && signalIds.some(sid => !state.signals.some(s => s.id === sid && s.moduleId === caller.moduleId))) forbidden("Suggestions may reference only the caller's source signals");
    // Mutation receipts retain exact terminal responses after history compaction.
    pruneTerminalProposals(state);
    if (state.proposals.length >= 64) capacity("Suggestion capacity reached; owner review is required");
    const proposal = { id: `p-${randomUUID()}`, title: args.title, goal: args.goal ?? "", project: args.project ?? "", reason: args.reason, source: caller?.kind === "module" ? caller.module : caller?.kind ?? "unknown", moduleId: caller?.kind === "module" ? caller.moduleId : null, signalIds, status: "pending" as const, concernId: null, createdAt: now, updatedAt: now };
    state.proposals.push(proposal);
    return { proposal };
  }
  private async settings(args: z.infer<typeof inputs["ui-settings"]>, now: string) {
    if (!Object.keys(args).length) return (await this.store.read()).settings;
    return this.store.update(state => {
      const patch = Object.fromEntries(Object.entries(args).map(([k, v]) => [k.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), v]));
      state.settings = settingsSchema.parse({ ...state.settings, ...patch });
      state.runtime.nextCheckAt = now;
      return state.settings;
    });
  }
}
