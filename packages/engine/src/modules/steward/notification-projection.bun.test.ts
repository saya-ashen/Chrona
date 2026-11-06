import { expect, test } from "bun:test";
import { notificationChannelSchema, notificationSchema, messageSchema, settingsSchema } from "@chrona/contracts/steward";
import { notificationItems } from "./notify-user";

const notice = { id: "fixture-notice", moduleId: null, sessionId: null, level: "now", channel: "third-party-room", status: "sent", title: "Title", body: "Body", link: null, attempts: 1, lastError: null, createdAt: "2026-11-05T00:00:00.000Z", sentAt: null, feedback: null } as const;

test("notification projections preserve arbitrary bounded registered channel names and safe fields", () => {
  for (const channel of ["in_app", "chrona_qqbot", "new-channel", "a".repeat(120)]) {
    const item = { ...notice, channel };
    expect(notificationSchema.parse(item)).toEqual(item);
    expect(settingsSchema.shape.chat.shape.channel.parse(channel)).toBe(channel);
    expect(notificationItems({ items: [{ ...item, format: "markdown", privateDebug: "not projected" }] })).toEqual([item]);
  }
  for (const channel of [null, "", "a".repeat(121), 42, undefined]) {
    expect(notificationChannelSchema.safeParse(channel).success).toBe(false);
    expect(settingsSchema.shape.chat.shape.channel.safeParse(channel).success).toBe(false);
    expect(notificationItems({ items: [{ ...notice, channel }, notice] })).toEqual([notice]);
  }
  expect(notificationItems({ items: [{ ...notice, status: "unrecognized-status" }, { ...notice, attempts: -1 }, notice] })).toEqual([notice]);
  expect(notificationItems(null)).toEqual([]);
  expect(messageSchema.shape.channel.safeParse("third-party-room").success).toBe(false);
});
