import type { TaskOrchestrator } from "@chrona/engine";

type RuntimeBootstrapPort = {
  startTaskOrchestrator: () => TaskOrchestrator | void;
};

export function createServerRuntimeBootstrap(runtime: RuntimeBootstrapPort) {
  let orchestratorStarted = false;

  return function bootstrapServerRuntime() {
    if (orchestratorStarted) {
      return;
    }

    runtime.startTaskOrchestrator();
    orchestratorStarted = true;
  };
}
