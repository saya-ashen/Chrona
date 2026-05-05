import type { RuntimeAdapter } from "./adapter-factory";

export async function syncRunEvents(
  adapter: RuntimeAdapter,
  runtimeSessionKey: string,
): Promise<{ messages?: Array<{ role?: string; content?: string }> }> {
  return adapter.readHistory({ runtimeSessionKey }) as Promise<{ messages?: Array<{ role?: string; content?: string }> }>;
}
