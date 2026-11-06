import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { configureExecutor } from "./executor-config";

async function stdinLine(prompt?: string, signal?: AbortSignal): Promise<string | null> {
  if (prompt) process.stderr.write(prompt);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const stop = () => lines.close();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) lines.close();
  try { for await (const line of lines) return line; return null; } finally { signal?.removeEventListener("abort", stop); lines.close(); }
}
async function executeLockedExecutorCommand(operation: string, dataDir: string, requestFile?: string) {
  if (operation === "configure" && requestFile) { configureExecutor(dataDir, requestFile); console.log("Executor private configuration saved."); return; }
  if (operation === "pair") {
    const code = await stdinLine(); if (code === null) throw new Error("Pairing code required on stdin");
    const { pairExecutor } = await import("./executor-runtime");
    console.log(JSON.stringify(await pairExecutor(dataDir, code))); return;
  }
  if (operation === "drain") {
    const { drainExecutor } = await import("./executor-runtime");
    await drainExecutor(dataDir); console.log("Retained executor finals acknowledged with confirmed stop."); return;
  }
  if (operation !== "run") throw new Error("Invalid internal executor operation");
  const { runExecutor } = await import("./executor-runtime");
  const abort = new AbortController(), stop = () => abort.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    await runExecutor(dataDir, async proposal => {
      console.log(JSON.stringify(proposal));
      const prompt = proposal.expectedIncarnation === null
        ? "No previous local proposal: first pairing may authenticate/reconcile; an existing server binding still requires independent owner CAS. Enter to verify; EOF exits.\n"
        : "Verify the server binding independently: expectedIncarnation is the previous LOCAL proposal, not proof of server state. Apply explicit owner CAS if already bound, then Enter to authenticate/reconcile; EOF exits.\n";
      return await stdinLine(prompt, abort.signal) === "";
    }, abort.signal);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
export function registerExecutorCommands(program: Command) {
  const executor = program.command("executor").description("Fixed local executor; native Linux systemd 262 + util-linux flock only, explicit private Pi profile, foreground owner handoff (no unattended restart)");
  for (const [operation, description] of [
    ["configure <request-file>", "Validate explicit Pi/profile/commit mappings and save private immutable pairing configuration; no profile discovery"],
    ["pair", "Read one-time pairing code from stdin; save only device credential/identity, never owner API_KEY"],
    ["drain", "Bounded final-only retry with original incarnation; no Pi/profile read, owner CAS, polling or launch; unresolved records fail"],
    ["run", "Foreground: fresh incarnation, independent owner CAS then Enter; authenticate/reconcile before polling; EOF exits without launch"],
  ]) executor.command(operation!).description(description!)
    .requiredOption("--data-dir <directory>", "Dedicated absolute private executor directory; busy OS lock refuses local changes")
    .action(async (...args: unknown[]) => {
      const file = operation!.startsWith("configure") ? args[0] as string : undefined;
      const options = args[file === undefined ? 0 : 1] as { dataDir: string };
      const { lockedExecutorCommand } = await import("./executor-lock");
      const dataDir = resolve(options.dataDir), selected = operation!.split(" ")[0]!;
      process.exitCode = await lockedExecutorCommand(selected, dataDir, () => executeLockedExecutorCommand(selected, dataDir, file === undefined ? undefined : resolve(file)));
    });
}
