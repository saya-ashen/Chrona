import { chrona, ModelError, on } from "chrona";
import { randomUUID } from "node:crypto";
import { authorize, createClient } from "./client";
import { PAGE } from "./page";
const client = createClient((target, args) => chrona.call(target, args));
on("activated", async () => { await chrona.call("web.page-set", PAGE); });
on("tool", async event => {
  try {
    authorize(event.caller);
    switch (event.id) {
      case "ui-request":
        if (Object.keys(event.args).length) throw new ModelError("invalid", "此工具不接受参数。");
        return { result: { nextRequestKey: randomUUID() } };
      case "ui-catalog": return { result: await client.catalog(event.args) };
      case "ui-work": return { result: await client.work(event.args) };
      case "ui-result": return { result: await client.result(event.args) };
      case "ui-command": return { result: await client.command(event.args) };
      case "ui-receipt": return { result: await client.receipt(event.args) };
      default: throw new ModelError("not_found", "没有这个工作台工具。");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") throw new ModelError(error.code, error.message);
    throw error;
  }
});
// Detaching or removing this client owns no Agent resource and never sends stop.
