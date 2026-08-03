import type { TaskOrchestrator } from "@chrona/engine";

type RuntimeBootstrapPort = {
  startTaskOrchestrator: () => TaskOrchestrator;
  startAiFeatureRecoveryWorker: () => { stop(): Promise<void> };
};

export type ServerRuntimeLifecycle = {
  stop: () => Promise<void>;
};

export function createServerRuntimeBootstrap(runtime: RuntimeBootstrapPort) {
  let lifecycle: ServerRuntimeLifecycle | null = null;

  return function bootstrapServerRuntime(): ServerRuntimeLifecycle {
    if (lifecycle) return lifecycle;

    const orchestrator = runtime.startTaskOrchestrator();
    const featureRecovery = runtime.startAiFeatureRecoveryWorker();
    lifecycle = {
      async stop() {
        await Promise.all([orchestrator.stop(), featureRecovery.stop()]);
      },
    };
    return lifecycle;
  };
}
