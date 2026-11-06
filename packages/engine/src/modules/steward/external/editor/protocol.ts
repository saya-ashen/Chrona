import { chrona } from "chrona";
import { editorEventsQuerySchema, type EditorCommandConsumer, type ExecutionView, type ExecutionCommand } from "./contract.js";

function coding<K extends "create" | "get" | "list" | "send" | "answer" | "cancel" | "results" | "accept", T>(name: K, input: object) {
  return chrona.call<T>(`coding.${name}`, { input: JSON.stringify(input) });
}
async function ref(input: { workId: string; runId: string; attemptId: string }): Promise<{ workId: string; runId: string; attemptId: string }> {
  const view = await coding<"get", ExecutionView>("get", { workId: input.workId });
  if (view.runId !== input.runId || view.attemptId !== input.attemptId) throw Object.assign(new Error("Execution reference does not match work"), { code: "conflict" });
  return { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
}
/** The kernel resolves this admitted owner entry; no body/header can choose its principal. */
export const editorCommands: EditorCommandConsumer = {
  start: input => coding("create", input),
  get: input => coding("get", input),
  lookup_start: input => chrona.call("executions.lookup-start", input),
  list: input => coding("list", input),
  send: input => coding("send", input),
  answer: input => coding("answer", input),
  cancel: input => coding("cancel", input),
  attach: input => coding("get", { workId: input.workId }),
  detach: async () => ({ accepted: true }),
  events: async input => chrona.call("executions.events", { ...input, ...await ref(input) }),
  snapshot: async input => chrona.call("executions.snapshot", await ref(input)),
  results: input => coding("results", input),
  accept: input => coding("accept", input),
};
export function handleEditorCommand<K extends ExecutionCommand["op"]>(command: Extract<ExecutionCommand, { op: K }>): ReturnType<EditorCommandConsumer[K]>;
// eslint-disable-next-line complexity -- Exhaustive wire op dispatch preserves each input/output pair without unsafe union casts.
export function handleEditorCommand(command: ExecutionCommand): ReturnType<EditorCommandConsumer[ExecutionCommand["op"]]> {
  switch (command.op) {
    case "start": { const { op: _op, ...input } = command; return editorCommands.start(input); }
    case "get": { const { op: _op, ...input } = command; return editorCommands.get(input); }
    case "lookup_start": { const { op: _op, ...input } = command; return editorCommands.lookup_start(input); }
    case "list": { const { op: _op, ...input } = command; return editorCommands.list(input); }
    case "send": { const { op: _op, ...input } = command; return editorCommands.send(input); }
    case "answer": { const { op: _op, ...input } = command; return editorCommands.answer(input); }
    case "cancel": { const { op: _op, ...input } = command; return editorCommands.cancel(input); }
    case "attach": { const { op: _op, ...input } = command; return editorCommands.attach(input); }
    case "detach": { const { op: _op, ...input } = command; return editorCommands.detach(input); }
    case "events": { const { op: _op, ...input } = command; return editorCommands.events(input); }
    case "snapshot": { const { op: _op, ...input } = command; return editorCommands.snapshot(input); }
    case "results": { const { op: _op, ...input } = command; return editorCommands.results(input); }
    case "accept": { const { op: _op, ...input } = command; return editorCommands.accept(input); }
  }
}
export function parseEditorEventsQuery(params: URLSearchParams) {
  const values: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) throw Object.assign(new Error("Duplicate query key"), { code: "invalid" });
    values[key] = value;
  }
  return editorEventsQuerySchema.parse(values);
}

/** v2 uses the same owner-routed coding product from web, MCP and editor. */
export function handleWorkEditorRequest(request: import("./contract.js").WorkRequest): Promise<unknown> {
  return chrona.call("coding.work", { input: JSON.stringify(request) });
}
