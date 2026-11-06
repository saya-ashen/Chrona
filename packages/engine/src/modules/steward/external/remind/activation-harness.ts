// Fail the first page call before it reaches the fake kernel, then allow re-registration.
import { chrona } from "chrona";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
let first = true;
chrona.call = new Proxy(chrona.call, {
  apply(target, receiver, args) {
    if (args[0] === "web.page-set" && first) { first = false; return Promise.reject(new Error("Web unavailable")); }
    return Reflect.apply(target, receiver, args);
  },
});
await import("./index");
await writeFile(join(chrona.paths.data, "activation-ready"), "ready");
