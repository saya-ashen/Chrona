import { record } from "./commands";
import { callAgent } from "./agent";
import { executionAcceptedSchema, type ExecutionCommandConsumer, type ExecutionStart, type ExecutionView } from "./contract.js";
import { reconcileCodingResult } from "./results";
import { codingGoal } from "./instructions";
import { codingError, lookupCodingWork, readCodingWork, writeCodingWork, remember, type CodingContext, type CodingWork } from "./storage";

type Input<K extends keyof ExecutionCommandConsumer> = Parameters<ExecutionCommandConsumer[K]>[0];

export async function createCodingWork(context: CodingContext, input: ExecutionStart): Promise<ExecutionView> {
  let work: CodingWork;
  try {
    work = await readCodingWork(context, input.workId);
    if (JSON.stringify(work.start) !== JSON.stringify(input)) throw codingError("conflict", "Work already has a different start command");
    if (work.ref) return getCodingWorkState(context, { workId: input.workId });
    // A lost receipt must be looked up before the original command can be explicitly resubmitted.
    try {
      const view = await callAgent<ExecutionView>(context, "lookup-start", { commandKey: work.start.commandKey });
      remember(work, view);
      await writeCodingWork(context, work);
      return view;
    } catch (error) { if ((error as { code?: string }).code !== "not_found") throw error; }
  } catch (error) {
    if ((error as { code?: string }).code !== "not_found") throw error;
    work = { start: input, results: [], acceptances: [] };
    await writeCodingWork(context, work);
  }
  const view = await callAgent<ExecutionView>(context, "start", { ...work.start, goal: codingGoal(work.start.goal) });
  remember(work, view);
  await writeCodingWork(context, work);
  return view;
}
/** Execution state is usable independently of optional result capture. */
export async function getCodingWorkState(context: CodingContext, input: Input<"get">): Promise<ExecutionView> {
  const { work, view } = await lookupCodingWork(context, input);
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
  return callAgent<Awaited<ReturnType<ExecutionCommandConsumer["list"]>>>(context, "list", input);
}
export class AgentAnswerRejected extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function answerRejection(raw: unknown): raw is { accepted: false; error: { code: string; message: string } } {
  return record(raw) && Object.keys(raw).length === 2 && raw.accepted === false && record(raw.error) && Object.keys(raw.error).length === 2
    && typeof raw.error.code === "string" && !!raw.error.code && raw.error.code.length <= 100 && typeof raw.error.message === "string" && raw.error.message.length <= 8000;
}
async function accepted(context: CodingContext, operation: "send" | "answer", input: Record<string, unknown>) {
  const response = await callAgent<unknown>(context, operation, input);
  if (operation === "answer" && answerRejection(response)) throw new AgentAnswerRejected(response.error.code, response.error.message);
  if (!executionAcceptedSchema.safeParse(response).success) throw codingError("conflict", "Agent control acceptance is unknown");
  return { accepted: true as const };
}
export function sendCodingWork(context: CodingContext, input: Input<"send">) { return accepted(context, "send", input); }
export function answerCodingWork(context: CodingContext, input: Input<"answer">) { return accepted(context, "answer", input); }
export async function cancelCodingWork(context: CodingContext, input: Input<"cancel">) {
  const view = await callAgent<ExecutionView>(context, "cancel", input);
  await getCodingWork(context, { workId: input.workId });
  return view;
}
