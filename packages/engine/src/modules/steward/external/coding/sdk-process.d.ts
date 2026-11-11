// Public chrona/process SDK subpath. Runtime supplies the SDK package to applications.
declare module "chrona/process" {
  export function spawnSupervised(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; helperPath?: string }): {
    process: import("node:child_process").ChildProcessWithoutNullStreams;
    stop(): void;
    exited: Promise<{ code: number | null; signal: string | null; stop: { state: "stopped" | "unknown"; scope: "descendants" | "process-group"; treeClean: boolean; reason: string } }>;
  };
}
