declare const CHRONA_COMPILED: boolean;
export const compiledExecutor = typeof CHRONA_COMPILED !== "undefined" && CHRONA_COMPILED;
/** Trusted local binary entry, selected before loading CLI/server configuration. */
export async function dispatchExecutorProcess(args: string[]): Promise<boolean> {
  if (args[0] !== "__executor-process") return false;
  const { runExecutorProcessEntry } = await import("@chrona/integrations/executor");
  await runExecutorProcessEntry(args.slice(1));
  return true;
}
