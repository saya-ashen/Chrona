import { on, onDisconnect, chrona, ModelError } from "chrona";
import { PAGE } from "./page";
import { Reminders } from "./reminders";

const reminders = new Reminders(chrona.paths.data, args => chrona.call("notify.send", args));
on("activated", async () => { await chrona.call("web.page-set", PAGE); return {}; });
on("tool", async event => {
  if (!event.caller) throw new ModelError("forbidden", "Missing actual caller");
  if (event.id === "create") return { result: reminders.create(event.args, new Date(event.now)) };
  if (event.id === "list") return { result: reminders.list() };
  if (event.id === "cancel") return { result: reminders.cancel(event.args) };
  throw new ModelError("invalid", `Unknown tool ${event.id}`);
});
const timer = setInterval(() => { void reminders.tick(new Date()).catch(() => console.error("Remind delivery failed; inspect private receipt")); }, 1000);
onDisconnect(async () => { clearInterval(timer); await reminders.close(); });
