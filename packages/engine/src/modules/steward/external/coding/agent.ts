import { readdir, readFile } from "node:fs/promises";
import type { ExecutionView, ExecutionSnapshot, ExecutionResultSource } from "./contract.js";
import { join } from "node:path";
import { ModelError } from "chrona";
import type { CodingContext, CodingWork } from "./types";

function kebab(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(kebab);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), kebab(child)]));
}
/** Coding's work protocol is assembled here; Agent knows only executions and event streams. */
export async function callAgent<T>(context: CodingContext, operation: string, input: Record<string, unknown>): Promise<T> {
  const { workId, commandKey, goal, requestId, waitMs: _wait, ...rest } = input;
  const target = { ...rest, ...(workId !== undefined ? { executionId: workId } : {}), ...(commandKey !== undefined ? { requestKey: commandKey } : {}) };
  const call = <R>(name: string, args: Record<string, unknown>) => context.call<R>(`agent.${name}`, kebab(args) as Record<string, unknown>);
  switch (operation) {
    case "start": case "start-v2": {
      const result = await call<{ execution: ExecutionView; placement?: unknown }>("run", { ...target, prompt: goal });
      return (operation === "start" ? result.execution : result) as T;
    }
    case "lookup-start": return call("lookup", target);
    case "get": return call("get", { executionId: workId, ...(input.runId ? { runId: input.runId } : {}), ...(input.attemptId ? { attemptId: input.attemptId } : {}) });
    case "send": return call("write", target);
    case "answer": return call("respond", { ...target, questionId: requestId, answer: JSON.stringify(input.answer) });
    case "cancel": return call("interrupt", target);
    case "events": return call("stream", target);
    case "placement": case "locations": return call(operation, target);
    case "workspace-cleanup": return call("cleanup", input);
    case "snapshot": case "result-source": {
      const result = await call<{ snapshot: ExecutionSnapshot; source: ExecutionResultSource }>("inspect", target);
      return (operation === "snapshot" ? result.snapshot : result.source) as T;
    }
    case "list": {
      // The business list is the module's own registry, never an Agent-wide list of executions.
      let files: string[];
      try { files = await readdir(context.dir); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files = []; }
      const works: ExecutionView[] = [];
      for (const file of files.filter(name => name.endsWith(".json") && name !== "works-v2.json").sort()) {
        const work = JSON.parse(await readFile(join(context.dir, file), "utf8")) as CodingWork;
        if (!work.ref || typeof input.after === "string" && work.ref.attemptId <= input.after) continue;
        works.push(await call<ExecutionView>("get", { executionId: work.start.workId }));
      }
      works.sort((a, b) => a.attemptId.localeCompare(b.attemptId));
      const limit = Number(input.limit), page = works.slice(0, limit);
      return { works: page, after: works.length > limit ? page.at(-1)!.attemptId : null } as T;
    }
    default: throw new ModelError("invalid", "Unsupported coding execution operation");
  }
}
