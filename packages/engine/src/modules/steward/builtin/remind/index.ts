// @ts-expect-error Chrona supplies the SDK at this at run time.
import { on, chrona } from "chrona";

on("schedule", async (event: { scheduleId: string; firedAt: string; payload: { text: string } }) => {
  await chrona.notify({ key: `${event.scheduleId}:${event.firedAt}`, level: "now", title: "提醒", body: event.payload.text });
});
