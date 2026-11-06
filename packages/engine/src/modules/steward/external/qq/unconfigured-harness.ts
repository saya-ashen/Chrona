// A missing credential must never contact QQ, including a gateway connection.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chrona } from "chrona";
const denied = () => {
  appendFileSync(join(chrona.paths.data, "network-attempts"), "attempt\n");
  throw new Error("Network forbidden in unconfigured QQ test");
};
globalThis.fetch = Object.assign(denied, { preconnect: denied });
globalThis.WebSocket = new Proxy(globalThis.WebSocket, { construct: denied });
await import("./index");
writeFileSync(join(chrona.paths.data, "unconfigured-ready"), "ready");
