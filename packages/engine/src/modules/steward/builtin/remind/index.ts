// @ts-expect-error Chrona supplies the SDK at this at run time.
import { on, chrona } from "chrona";

on("schedule", async (event: { scheduleId: string; firedAt: string; payload: { text: string } }) => {
  // The key names this firing: a redelivered event returns the same call instead of reminding twice.
  const key = `${event.scheduleId}:${event.firedAt}`;
  await chrona.call("notify.send", { key, level: "now", title: "提醒", body: event.payload.text }, { mode: "async", key });
});
