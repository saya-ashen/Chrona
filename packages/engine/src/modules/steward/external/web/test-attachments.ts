import { strict as assert } from "node:assert";

type Get = (path: string, init?: RequestInit) => Promise<Response>;
export async function checkAttachments(get: Get, post: (path: string, body: unknown) => Promise<Response>, calls: [string, Record<string, unknown>][]) {
  // Web owns upload -> send -> persisted journal -> download. Client metadata cannot forge ownership.
  const uploaded = await post("/api/web/attachments", { name: "附件.txt", mime: "text/plain", base64: Buffer.from("private web attachment").toString("base64") });
  assert.equal(uploaded.status, 200);
  const attachment = await uploaded.json();
  assert.match(attachment.ref, /^web\/attachments\//);
  const sent = await post("/api/web/chat", { text: "查看附件", requestKey: "attachment-send", attachments: [{ ref: attachment.ref, name: "forged", size: 0 }] });
  assert.equal(sent.status, 200);
  const receipt = await sent.json();
  const journal = await (await get(`/api/web/sessions/${encodeURIComponent(receipt.sessionId)}/messages`)).json();
  assert.deepEqual(journal.find((item: { id: string }) => item.id === receipt.messageId).attachments, [attachment]);
  const fileUrl = `/api/web/file?message=${encodeURIComponent(receipt.messageId)}&ref=`;
  const file = await get(fileUrl + encodeURIComponent(attachment.ref));
  assert.equal(file.status, 200); assert.equal(await file.text(), "private web attachment");
  assert.equal(file.headers.get("content-disposition"), "attachment");
  assert.match(file.headers.get("content-security-policy")!, /sandbox/);
  assert.equal((await get(`/api/web/file?message=foreign&ref=${encodeURIComponent(attachment.ref)}`)).status, 404);
  for (const ref of ["qq/attachments/private", "chat/old.txt", "web/attachments/../../private", "web/attachments/missing"]) {
    assert.equal((await post("/api/web/chat", { text: "bad", attachments: [{ ref }] })).status, 400);
    assert.equal((await get(fileUrl + encodeURIComponent(ref))).status, 404);
  }
  assert.equal((await post("/api/web/chat", { text: "bad", attachments: Array(11).fill(attachment) })).status, 400);
  assert.equal((await post("/api/web/attachments", { name: "bad", mime: "text/plain", base64: "!!!" })).status, 400);
  assert.equal(calls.some(([target]) => target === "content.read" || target === "history.file"), false);
}
