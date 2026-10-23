// @ts-expect-error Chrona supplies the SDK at this sandbox-only path.
import { on, chrona } from "/chrona/sdk.ts";

on("schedule", async (event: { scheduleId: string; firedAt: string; payload: { text: string } }) => {
  await chrona.notify({ key: `${event.scheduleId}:${event.firedAt}`, level: "now", title: "提醒", body: event.payload.text });
});
