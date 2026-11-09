// Author-test-only entry: isolate the SDK instance from copied user data and simulate optional Web absence.
import { chrona } from "chrona";
const directory = process.env.CHRONA_MIND_OFFLINE_STATE;
if (!directory) throw new Error("Offline entry requires an explicit temporary state directory");
chrona.paths.data = directory;
const actualCall = chrona.call;
let absent = true;
chrona.call = ((target: string, args?: Record<string, unknown>, options?: { key?: string; timeoutMs?: number }) => {
  if (target === "web.page-set" && absent) { absent = false; return Promise.reject(new Error("Web unavailable in offline fixture")); }
  return actualCall(target, args, options);
}) as typeof chrona.call;
await import("./index");
