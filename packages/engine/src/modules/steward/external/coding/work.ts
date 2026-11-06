import type { EditorCommandConsumer, ExecutionStart, ExecutionView } from "./contract.js";
import { readRegistry, serializeWork } from "./work-v2-storage";
import { reconcileCodingResult } from "./results";
import { codingError, lookupCodingWork, readCodingWork, writeCodingWork, remember, type CodingContext, type CodingWork } from "./storage";

type Input<K extends keyof EditorCommandConsumer> = Parameters<EditorCommandConsumer[K]>[0];

export function createCodingWork(context: CodingContext, input: ExecutionStart): Promise<ExecutionView> {
  return serializeWork(() => createLegacyWork(context, input));
}
async function createLegacyWork(context: CodingContext, input: ExecutionStart): Promise<ExecutionView> {
  const registry = await readRegistry(context);
  if (registry.records.some(record => record.views.some(view => view.workId === input.workId) || record.start.commandKey === input.commandKey || record.start.kind === "group" && record.start.children.some(child => child.commandKey === input.commandKey))) throw codingError("conflict", "Identity belongs to a v2 work");
  let work: CodingWork;
  try {
    work = await readCodingWork(context, input.workId);
    if (JSON.stringify(work.start) !== JSON.stringify(input)) throw codingError("conflict", "Work already has a different start command");
    if (work.ref) return getCodingWork(context, { workId: input.workId });
    // A lost receipt must be looked up before the original command can be explicitly resubmitted.
    try {
      const view = await context.call<ExecutionView>("executions.lookup-start", { commandKey: work.start.commandKey });
      remember(work, view);
      await writeCodingWork(context, work);
      return view;
    } catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; }
  } catch (error) {
    if ((error as { code?: string }).code !== "not_found") throw error;
    work = { start: input, results: [], acceptances: [] };
    await writeCodingWork(context, work);
  }
  const view = await context.call<ExecutionView>("executions.start", work.start);
  remember(work, view);
  await writeCodingWork(context, work);
  return view;
}
export async function getCodingWork(context: CodingContext, input: Input<"get">): Promise<ExecutionView> {
  const { work, view } = await lookupCodingWork(context, input);
  await reconcileCodingResult(context, work, view);
  await writeCodingWork(context, work);
  return view;
}
export function listCodingWorks(context: CodingContext, input: Input<"list">) {
  return context.call<Awaited<ReturnType<EditorCommandConsumer["list"]>>>("executions.list", input);
}
export function sendCodingWork(context: CodingContext, input: Input<"send">) {
  return context.call<{ accepted: true }>("executions.send", input);
}
export function answerCodingWork(context: CodingContext, input: Input<"answer">) {
  return context.call<{ accepted: true }>("executions.answer", input);
}
export async function cancelCodingWork(context: CodingContext, input: Input<"cancel">) {
  const view = await context.call<ExecutionView>("executions.cancel", input);
  await getCodingWork(context, { workId: input.workId });
  return view;
}
