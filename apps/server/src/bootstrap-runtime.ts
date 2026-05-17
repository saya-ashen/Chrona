import { createChronaEngine } from "@chrona/engine";

let orchestratorStarted = false;
const engine = createChronaEngine();

export function bootstrapServerRuntime() {
  if (orchestratorStarted) {
    return;
  }

  engine.runtime.startTaskOrchestrator();
  orchestratorStarted = true;
}
