import { on, chrona } from "chrona";

on("schedule", async event => {
  // The key names this firing: a redelivered event returns the same call instead of reminding twice.
  const key = `${event.scheduleId}:${event.firedAt}`;
  await chrona.call("notify.send", { key, level: "now", title: "提醒", body: String(event.payload?.text ?? "") }, { mode: "async", key });
});
