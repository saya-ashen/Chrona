import { conflict, invalid, capacity } from "./store";
import type { State } from "./types";
import { runtimeView, stats } from "./policy";

export const RESPONSE_BYTES = 230 * 1024;
export const encodedBytes = (result: unknown) => Buffer.byteLength(JSON.stringify({ result }), "utf8");
type PageArgs = { cursor?: string; limit?: number };
function offset(args: PageArgs, state: State, kind: string, total: number) {
  if (!args.cursor) return 0;
  const match = /^(agenda|decisions):(\d+):(\d+)$/.exec(args.cursor);
  if (!match || match[1] !== kind) return invalid("Invalid page cursor");
  if (Number(match[2]) !== state.revision) return conflict("Records changed; refresh from the first page");
  const value = Number(match[3]);
  if (!Number.isSafeInteger(value) || value < 0 || value >= total) return invalid("Page cursor is outside these records");
  return value;
}
function page<T>(state: State, args: PageArgs, kind: string, rows: T[], result: (items: T[]) => Record<string, unknown>) {
  const start = offset(args, state, kind, rows.length), selected: T[] = [];
  const wrap = () => {
    const end = start + selected.length;
    return { ...result(selected), cursor: args.cursor ?? null, nextCursor: end < rows.length ? `${kind}:${state.revision}:${end}` : null, limited: end < rows.length, total: rows.length };
  };
  for (const row of rows.slice(start, start + (args.limit ?? 50))) {
    selected.push(row);
    if (encodedBytes(wrap()) > RESPONSE_BYTES) { selected.pop(); break; }
  }
  if (!selected.length && start < rows.length) capacity("A Mind record exceeds the response budget");
  const output = wrap();
  if (encodedBytes(output) > RESPONSE_BYTES) capacity("Mind response exceeds the response budget");
  return output;
}
export function agendaPage(state: State, args: PageArgs, now: string) {
  const rows = [...state.concerns.map(concern => ({ concern })), ...state.proposals.map(proposal => ({ proposal }))];
  const base = { runtime: runtimeView(state), stats: stats(state, Date.parse(now)) };
  return page(state, args, "agenda", rows, selected => ({ ...base,
    concerns: selected.flatMap(row => "concern" in row ? [row.concern] : []),
    proposals: selected.flatMap(row => "proposal" in row ? [row.proposal] : []),
  }));
}
export function decisionsPage(state: State, args: PageArgs) {
  // Internal report candidates and launch material never leave the application.
  const rows = [...state.decisions].reverse().map(d => ({ id: d.id, at: d.at, kind: d.kind, concernIds: d.concernIds, signalIds: d.signalIds,
    revisions: d.revisions, sourceKinds: d.sourceKinds, phase: d.phase, contextId: d.contextId, runId: d.runId, tools: d.tools,
    report: d.report, finishedAt: d.finishedAt, error: d.error, interactions: d.interactions, notification: d.notification }));
  return page(state, args, "decisions", rows, decisions => ({ decisions }));
}
