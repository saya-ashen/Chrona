import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { processCapability, ProcessSupervisionUnavailableError, requireDescendantStop, spawnSupervised } from "@chrona/process";

/** Trusted local composition only; never populated from a run request. */
export type PiProcessInput = { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; helperPath?: string };
export type PiProcess = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr"> & {
  /** Resolves only after the owned process tree is proven stopped; uncertainty rejects. */
  closed: Promise<{ code: number | null; signal: string | null }>;
  /** Requests full tree cleanup; the signal does not target the guardian. */
  kill(signal: NodeJS.Signals): void;
};

/** Trusted local Pi requires native proof for all descendants before releasing capacity. */
export function launchPiProcess(input: PiProcessInput): PiProcess {
  const capability = processCapability({ helperPath: input.helperPath });
  if (!capability.available || capability.scope !== "descendants") throw new ProcessSupervisionUnavailableError(capability.reason ?? "Pi requires verified descendant supervision; this platform is unsupported");
  const task = spawnSupervised(input.file, input.args, { cwd: input.cwd, env: input.env, timeoutMs: input.timeoutMs, helperPath: input.helperPath });
  return {
    stdin: task.process.stdin, stdout: task.process.stdout, stderr: task.process.stderr,
    closed: task.exited.then(requireDescendantStop).then(({ code, signal }) => ({ code, signal })),
    kill: (_signal: NodeJS.Signals) => task.stop(),
  };
}
