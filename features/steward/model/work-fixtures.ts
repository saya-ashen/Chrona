import { workSchema, type WorkStatus } from "@chrona/contracts";
export const workTime = "2026-10-14T00:00:00.000Z";
export function workFixture(status: WorkStatus = "received") {
  return workSchema.parse({ id: "w1", affairId: "a1", delegationId: "d1", replyRef: null, request: "Research <b>plain text</b>", status, revision: 1, question: null, authorization: null, inputs: [], progress: [], handling: null, resultHref: null, resultVersion: null, attempts: [], failures: 0, nextRunAt: null, lastError: null, createdAt: workTime, updatedAt: workTime });
}
