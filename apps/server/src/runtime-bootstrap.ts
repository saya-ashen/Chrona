import type { TaskOrchestrator } from "@chrona/engine";

type RuntimeBootstrapPort = {
  startTaskOrchestrator: () => TaskOrchestrator;
};

export type ServerRuntimeLifecycle = {
  stop: () => Promise<void>;
};

export function createServerRuntimeBootstrap(runtime: RuntimeBootstrapPort) {
  let lifecycle: ServerRuntimeLifecycle | null = null;

  return function bootstrapServerRuntime(): ServerRuntimeLifecycle {
    if (lifecycle) return lifecycle;

    const orchestrator = runtime.startTaskOrchestrator();
    lifecycle = { stop: () => orchestrator.stop() };
    return lifecycle;
  };
}
