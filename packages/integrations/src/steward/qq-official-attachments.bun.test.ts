import { expect, test } from "bun:test";
import { downloadQqAttachment, parseC2cEvent, sendQqC2c, uploadQqImage } from "./qq-official";

const attachment = { url: "https://multimedia.nt.qq.com/file", name: "a.png", mime: "image/png" };
test("event retains attachments and reference id, including attachment-only events", () => {
  const event = parseC2cEvent({ id: "m", author: { user_openid: "owner" }, message_reference: { message_id: "sent" }, attachments: [{ url: attachment.url, filename: "a.png", content_type: "image/png", size: 3 }] });
  expect(event?.quotedId).toBe("sent");
  expect(event?.content).toBe("");
  expect(event?.attachments).toEqual([{ ...attachment, size: 3 }]);
});
for (const url of ["http://multimedia.nt.qq.com/a", "https://localhost/a", "https://multimedia.nt.qq.com.evil.test/a", "https://user@multimedia.nt.qq.com/a", "https://multimedia.nt.qq.com:444/a"]) test(`reject unsafe attachment URL ${url}`, async () => {
  await expect(downloadQqAttachment({ ...attachment, url }, async () => { throw new Error("must not fetch"); })).rejects.toThrow("Invalid QQ attachment URL");
});
test("download checks MIME, status, declared and streaming byte limits", async () => {
  await expect(downloadQqAttachment(attachment, async () => new Response("bad", { headers: { "content-type": "text/html" } }))).rejects.toThrow("content type");
  await expect(downloadQqAttachment(attachment, async () => new Response("", { status: 302 }))).rejects.toThrow();
  await expect(downloadQqAttachment({ ...attachment, size: 20 * 1024 * 1024 + 1 }, async () => { throw new Error("must not fetch"); })).rejects.toThrow("size limit");
  await expect(downloadQqAttachment(attachment, async () => new Response("", { headers: { "content-type": "image/png", "content-length": String(20 * 1024 * 1024 + 1) } }))).rejects.toThrow("size limit");
  await expect(downloadQqAttachment(attachment, async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }))).rejects.toThrow("size limit");
});
test("rich media upload uses bytes and does not send proactively; unsupported upload falls back", async () => {
  const tokens = { get: async () => "fake", invalidate() {}, status: () => ({ hasToken: true, expiresAt: null }) };
  const file = await uploadQqImage({ tokens, openid: "owner", bytes: new Uint8Array([1]), fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ file_type: 1, file_data: "AQ==", srv_send_msg: false });
    return Response.json({ file_info: "uploaded" });
  } });
  expect(file).toBe("uploaded");
  await sendQqC2c({ tokens, openid: "owner", content: "image", replyTo: "in", mediaFileInfo: file!, fetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({ msg_type: 7, msg_id: "in", media: { file_info: "uploaded" } });
    return Response.json({ id: "sent" });
  } });
  expect(await uploadQqImage({ tokens, openid: "owner", bytes: new Uint8Array([1]), fetch: async () => new Response("unsupported", { status: 400 }) })).toBeNull();
});
