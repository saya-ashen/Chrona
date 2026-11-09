import { chrona, ModelError, on, onDisconnect } from "chrona";
import { RemoteExecutionApp } from "./app";
import { check, ProtocolError, readStored, type Delivery } from "./contracts";
import { RoutedKernelPort } from "./kernel-port";
import { Store } from "./store";

const store = new Store(chrona.paths.data);
const kernel = new RoutedKernelPort((target, args) => chrona.call(target, args), deliveryId => {
  const row = store.delivery(deliveryId); check(row, "not_found");
  return readStored<Delivery>("delivery", row.envelope).packet.target;
});
const app = new RemoteExecutionApp(store, kernel);
onDisconnect(() => store.close());
on("tool", async event => {
  try {
    check(event.caller, "forbidden");
    // The authenticated host supplies these events. Owner/module events cannot
    // cause a private carrier call by imitating a device tool in their arguments.
    if (event.caller.kind === "kernel" && event.id === "device-poll") {
      app.authorizeDevice("device-poll", event.args);
      // Reconcile the existing journal before claiming any new kernel offer.
      // Otherwise a fresh empty journal would immediately be missing that offer.
      await app.handle("forward", { input: '{"version":1}' }, event.caller);
      await app.handle("sync", { input: '{"version":1}' }, event.caller);
      await app.handle("forward", { input: '{"version":1}' }, event.caller);
    }
    return { result: await app.handle(event.id, event.args, event.caller) };
  } catch (error) {
    if (error instanceof ProtocolError) {
      const code = error.code === "unauthorized" ? "forbidden" : ["invalid", "forbidden", "conflict", "too_large", "unavailable", "unsupported_version"].includes(error.code) ? error.code : "conflict";
      throw new ModelError(code, error.message);
    }
    throw error;
  }
});
