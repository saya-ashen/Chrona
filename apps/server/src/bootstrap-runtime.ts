import { createChronaEngine } from "@chrona/engine";
import { createServerRuntimeBootstrap } from "./runtime-bootstrap";

const engine = createChronaEngine();

export const bootstrapServerRuntime = createServerRuntimeBootstrap(engine.runtime);
