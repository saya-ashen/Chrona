import { expect, test } from "bun:test";
import { createInAppDelivery } from "./index";

test("in-app acceptance is a stable local receipt, including across restarts", async () => {
  const adapter = createInAppDelivery();
  expect(adapter.channel).toBe("in_app");
  expect(adapter.idempotent).toBe(true);
  const message = { idempotencyKey: "notification-1", title: "Change", body: "Review inside Chrona", link: null, recipient: null, replyRef: null, whyItMatters: "", nextStep: "", appPath: null };
  const expected = { outcome: "accepted", receiptRef: "in_app:notification-1" } as const;
  expect(await adapter.send(message)).toEqual(expected);
  expect(await adapter.send(message)).toEqual(expected);
  expect(await createInAppDelivery().send(message)).toEqual(expected);
  expect(await adapter.send({ ...message, idempotencyKey: "notification-2" })).toEqual({ outcome: "accepted", receiptRef: "in_app:notification-2" });
});
