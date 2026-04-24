export * from "./server";

import { startBridgeServer } from "./server";

if (import.meta.main) {
  startBridgeServer();
}
