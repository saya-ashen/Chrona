import { syncRunFromRuntime } from "./sync-run";

export class RuntimeSync {
  syncRun(input: Parameters<typeof syncRunFromRuntime>[0]) {
    return syncRunFromRuntime(input);
  }
}

export const runtimeSync = new RuntimeSync();
