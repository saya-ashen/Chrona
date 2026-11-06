import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** Trusted local composition only; never populated from a run request. */
export type PiProcessInput = { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
export type PiProcess = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr"> & {
  /** A supervised launcher resolves only after its owned process tree is proven stopped; uncertainty rejects. */
  closed: Promise<{ code: number | null; signal: string | null }>;
  kill(signal: NodeJS.Signals): void;
};

/** Existing ordinary Provider behavior: direct-child closure, without a process-tree claim. */
export function launchPiProcess(input: PiProcessInput): PiProcess {
  const child = spawn(input.file, input.args, { cwd: input.cwd, env: input.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let failedToStart = false;
  const closed = new Promise<{ code: number | null; signal: string | null }>(resolveClosed => {
    child.once("error", () => { failedToStart = true; });
    child.once("close", (code, signal) => resolveClosed({ code: failedToStart ? null : code, signal }));
  });
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, closed, kill: signal => { child.kill(signal); } };
}
