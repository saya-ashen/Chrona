import { z } from "zod";
import { managedToolSchema, STEWARD_ACTIONS, DELEGATION_STATUSES, type ManagedTool, type TOOL_TRANSITIONS } from "@chrona/contracts/steward";
import type { PrismaClient, Prisma, ManagedTool as ToolRow } from "@chrona/db/generated/prisma/client";
import { chooseHandling, nextToolState, type HandlingSignals } from "@chrona/domain/steward/handling";
import { decidePermission } from "@chrona/domain/steward/permission";
import { toolSpecSchema, validateToolSpec, evaluateEventRule, type RuleEvent } from "@chrona/domain/steward/tool-spec";

type Tx = Prisma.TransactionClient;
export class ToolConflictError extends Error { readonly code = "TOOL_CONFLICT"; constructor() { super("Tool version or state changed."); } }
export class ToolNotFoundError extends Error { readonly code = "TOOL_NOT_FOUND"; constructor() { super("Tool not found."); } }
export class ToolRunRefusedError extends Error {
  constructor(readonly code: "TOOL_NOT_ENABLED" | "TOOL_NOT_PERMITTED" | "TOOL_RUN_FAILED" | "SCRIPT_DRAFT_ONLY") { super(code === "SCRIPT_DRAFT_ONLY" ? "Script drafts cannot run: Chrona has no arbitrary-script sandbox; human review is required." : code); }
}
function isScriptDraft(spec: ToolRow["spec"]) { return spec !== null && typeof spec === "object" && !Array.isArray(spec) && spec.type === "script_draft"; }
function view(row: ToolRow): ManagedTool {
  const { workspaceId: _workspace, spec: _spec, disabledAt: _disabled, retiredAt: _retired, ...fields } = row;
  return managedToolSchema.parse({ ...fields, ...Object.fromEntries(["authorizedAt", "enabledAt", "lastRunAt", "lastSuccessAt", "lastFailureAt", "createdAt", "updatedAt"].map((key) => [key, (row[key as keyof ToolRow] as Date | null)?.toISOString() ?? null])) });
}
const policySchema = z.object({ id: z.string(), revision: z.number().int(), status: z.enum(DELEGATION_STATUSES), allowedActions: z.array(z.enum(STEWARD_ACTIONS)), askFirstActions: z.array(z.enum(STEWARD_ACTIONS)), expiresAt: z.date().nullable() });
const eventSchema = z.object({ title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200), connectionKind: z.enum(["local_test", "reddit_inbox"]).optional() });
type Input = { affairId?: string; signals: HandlingSignals };
function assertAuthorizationActor(input: { action: string; actorKey?: string }) {
  if (input.action === "authorize" && !input.actorKey?.trim()) throw new Error("Explicit user actorKey required for authorization.");
}
async function get(tx: Tx, workspaceId: string, id: string) {
    const row = await tx.managedTool.findFirst({ where: { workspaceId, id } });
    if (!row) throw new ToolNotFoundError();
    return row;
  }
  async function save(tx: Tx, row: ToolRow, data: Prisma.ManagedToolUpdateManyMutationInput) {
    const changed = await tx.managedTool.updateMany({ where: { workspaceId: row.workspaceId, id: row.id, version: row.version, state: row.state }, data });
    if (!changed.count) throw new ToolConflictError();
    return view(await get(tx, row.workspaceId, row.id));
  }
/** Internal service: transports must authenticate workspace membership and user actorKey. */
export function createStewardTools({ db, now = () => new Date() }: { db: PrismaClient | Tx; now?: () => Date }) {
  const transaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => "$transaction" in db ? db.$transaction(fn) : fn(db);
  async function audit(tx: Tx, subject: { workspaceId: string; id: string }, kind: string, details: Prisma.InputJsonObject, actorKey = "system:steward") {
    await tx.stewardAudit.create({ data: { workspaceId: subject.workspaceId, subjectId: subject.id, kind: `tool.${kind}`, actorKey, details, createdAt: now() } });
  }
  return {
    recommend(_workspaceId: string, input: Input) { return chooseHandling(input.signals); },
    async generate(workspaceId: string, input: Input & { name: string; purpose: string; spec: unknown; dataScopes: string[]; actorKey: string }) {
      const choice = chooseHandling(input.signals);
      if (choice.mode !== "script" && choice.mode !== "panel") return { created: false as const, choice };
      const spec = toolSpecSchema.parse(input.spec);
      if ((spec.type === "event_rule" ? "script" : "panel") !== choice.mode) throw new Error("Handling choice and spec kind disagree.");
      const fields = managedToolSchema.pick({ name: true, purpose: true, dataScopes: true }).parse({ name: input.name, purpose: input.purpose, dataScopes: input.dataScopes });
      return transaction(async (tx) => {
        if (input.affairId && !await tx.affair.findFirst({ where: { id: input.affairId, workspaceId } })) throw new ToolNotFoundError();
        const row = await tx.managedTool.create({ data: { workspaceId, affairId: input.affairId, ...fields, spec, kind: choice.mode, handlingMode: choice.mode, selectionRationale: choice.rationale, state: "generated", version: 1 } });
        await audit(tx, { workspaceId, id: row.id }, "generated", { choice, version: 1 }, input.actorKey);
        return { created: true as const, choice, tool: view(row) };
      });
    },
    async transition(workspaceId: string, id: string, input: { action: (typeof TOOL_TRANSITIONS)[number]; expectedVersion: number; actorKey?: string }) {
      return transaction(async (tx) => {
        const row = await get(tx, workspaceId, id);
        if (row.version !== input.expectedVersion) throw new ToolConflictError();
        if (isScriptDraft(row.spec) && ["validate", "authorize", "enable"].includes(input.action)) throw new ToolRunRefusedError("SCRIPT_DRAFT_ONLY");
        const validation = input.action === "validate" ? validateToolSpec(row.spec) : undefined;
        const state = nextToolState(view(row).state, input.action, { version: row.version, validatedVersion: row.validatedVersion, validationPassed: validation?.passed });
        assertAuthorizationActor(input);
        const result = await save(tx, row, { state,
          ...(validation ? { validationSummary: validation.summary, validatedVersion: validation.passed ? row.version : null } : {}),
          ...(input.action === "authorize" ? { authorizedAt: now() } : {}),
          ...(input.action === "enable" ? { enabledAt: now(), disabledAt: null } : {}),
          ...(input.action === "disable" ? { disabledAt: now() } : {}),
          ...(input.action === "retire" ? { retiredAt: now() } : {}),
        });
        await audit(tx, { workspaceId, id }, input.action, { state, version: row.version }, input.actorKey);
        return result;
      });
    },
    async edit(workspaceId: string, id: string, input: { spec: unknown; expectedVersion: number; actorKey: string }) {
      return transaction(async (tx) => {
        const row = await get(tx, workspaceId, id);
        if (row.version !== input.expectedVersion) throw new ToolConflictError();
        const spec = toolSpecSchema.parse(input.spec);
        if ((spec.type === "event_rule" ? "script" : "panel") !== row.kind) throw new Error("Cannot change tool kind.");
        const state = nextToolState(view(row).state, "edit", { version: row.version, validatedVersion: row.validatedVersion });
        const result = await save(tx, row, { spec, version: { increment: 1 }, state, validationSummary: null, validatedVersion: null, authorizedAt: null, enabledAt: null, disabledAt: null, retiredAt: null });
        await audit(tx, { workspaceId, id }, "edited", { version: row.version + 1 }, input.actorKey);
        return result;
      });
    },
    async run(workspaceId: string, id: string, { events, actorKey }: { events: RuleEvent[]; actorKey: string }) {
      // Entire bounded, in-process execution shares the permission snapshot transaction.
      // Return refusals from the transaction, then throw so refusal audits survive.
      const result = await transaction(async (tx) => {
        const row = await get(tx, workspaceId, id);
        const refuse = async (code: ToolRunRefusedError["code"]) => {
          await audit(tx, { workspaceId, id }, "run_refused", { code, version: row.version }, actorKey);
          return { error: code };
        };
        if (isScriptDraft(row.spec)) return refuse("SCRIPT_DRAFT_ONLY");
        if (row.state !== "enabled") return refuse("TOOL_NOT_ENABLED");
        // An affair-less tool has no implicit workspace-wide delegation authority.
        const delegations = row.affairId ? await tx.delegation.findMany({ where: { workspaceId, affairId: row.affairId, status: "active" } }) : [];
        const allowed = delegations.some((d) => {
          const parsed = policySchema.safeParse(d);
          // Connection-scoped grants cannot authorize arbitrary caller-supplied events.
          return d.connectionId === null && parsed.success && decidePermission({ action: "run_tool", delegation: parsed.data, now: now() }).outcome === "allowed";
        });
        if (!allowed) return refuse("TOOL_NOT_PERMITTED");
        try {
          const spec = toolSpecSchema.parse(row.spec);
          let rows: Record<string, string>[] = [];
          let matches: { index: number; matched: boolean; disposition?: string; note?: string }[] = [];
          if (spec.type === "event_rule") {
            const bounded = z.array(eventSchema).max(500).parse(events.slice(0, 500));
            matches = bounded.map((event, index) => ({ index, ...evaluateEventRule(spec, event) })).filter((match) => match.matched);
          } else {
            const scope = { workspaceId, affairId: row.affairId };
            if (spec.source === "affair_events") rows = (await tx.inboundEvent.findMany({ where: { ...scope, linkStatus: "confirmed" }, take: 200, orderBy: [{ occurredAt: "desc" }, { id: "asc" }] })).map((e) => ({ title: e.title, author: e.author, occurredAt: e.occurredAt.toISOString(), status: e.status, note: "" }));
            else rows = (await tx.attentionItem.findMany({ where: scope, take: 200, orderBy: [{ createdAt: "desc" }, { id: "asc" }] })).map((a) => ({ title: a.title, author: "", occurredAt: a.createdAt.toISOString(), status: a.status, note: a.whatHappened }));
            if (spec.sort) { const { key, direction } = spec.sort; rows.sort((a, b) => a[key].localeCompare(b[key]) * (direction === "asc" ? 1 : -1)); }
            rows = rows.map((r) => Object.fromEntries(spec.columns.map((c) => [c.key, r[c.key]])));
          }
          await save(tx, row, { lastRunAt: now(), lastSuccessAt: now() });
          await audit(tx, { workspaceId, id }, "run_succeeded", { version: row.version, count: spec.type === "event_rule" ? matches.length : rows.length }, actorKey);
          return { matches, rows };
        } catch (error) {
          if (error instanceof ToolConflictError) throw error;
          await save(tx, row, { lastRunAt: now(), lastFailureAt: now() });
          await audit(tx, { workspaceId, id }, "run_failed", { version: row.version }, actorKey);
          return { error: "TOOL_RUN_FAILED" as const };
        }
      });
      if ("error" in result) throw new ToolRunRefusedError(result.error);
      return result;
    },
    async list(workspaceId: string, { affairId }: { affairId?: string } = {}) {
      return (await db.managedTool.findMany({ where: { workspaceId, ...(affairId ? { affairId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] })).map(view);
    },
  };
}
