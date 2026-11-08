import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachmentBody, createAttachments, decodeBase64, MAX_ATTACHMENT_BYTES } from "./attachments";

test("Web attachment storage accepts only bounded local uploads and rejects symlinks and special paths", async () => {
  const root = await mkdtemp("/tmp/chrona-web-attachments-");
  try {
    const files = createAttachments(root);
    const file = await files.upload({ name: "附件.txt", mime: "text/plain", base64: "aGVsbG8=" });
    expect(await files.accept([{ ref: file.ref, name: "forged" }])).toEqual([file]);
    expect((await files.read(file.ref)).toString()).toBe("hello");
    for (const ref of ["other/attachments/private", "web/attachments/../../private", "web/attachments/missing"]) {
      await expect(files.accept([{ ref }])).rejects.toThrow();
      await expect(files.read(ref)).rejects.toThrow();
    }
    await expect(files.accept(Array(11).fill(file))).rejects.toThrow("10");
    const path = join(root, file.ref.slice(4));
    await rename(path, `${path}.saved`); await symlink(`${path}.saved`, path);
    await expect(files.read(file.ref)).rejects.toThrow();
    await unlink(path); await mkdir(path);
    await expect(files.read(file.ref)).rejects.toThrow("普通文件");
    await rm(path, { recursive: true });
    await writeFile(path, ""); await truncate(path, MAX_ATTACHMENT_BYTES + 1);
    await expect(files.read(file.ref)).rejects.toThrow("普通文件");
    await unlink(path); await rename(`${path}.saved`, path);
    await rename(`${path}.json`, `${path}.json.saved`); await symlink(`${path}.json.saved`, `${path}.json`);
    await expect(files.accept([file])).rejects.toThrow();
    await unlink(`${path}.json`); await rename(`${path}.json.saved`, `${path}.json`);
    await rename(join(root, "attachments"), join(root, "saved"));
    await symlink(join(root, "saved"), join(root, "attachments"));
    await expect(files.read(file.ref)).rejects.toThrow("目录");
    await expect(files.upload({ name: "x", mime: "text/plain", base64: "" })).rejects.toThrow("目录");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("attachment JSON and base64 are bounded before storage", async () => {
  for (const value of [null, "???", "YQ=", "YR==", "A".repeat(12)]) expect(() => decodeBase64(value, 4)).toThrow();
  expect(decodeBase64("YQ==", 4).toString()).toBe("a");
  const largest = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64");
  expect(decodeBase64(largest).length).toBe(MAX_ATTACHMENT_BYTES);
  expect(() => decodeBase64(largest, MAX_ATTACHMENT_BYTES - 1)).toThrow();
  await expect(attachmentBody(new Request("http://module/api/web/attachments", { method: "POST", body: "bad json" }))).rejects.toThrow("JSON");
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4097)); controller.close(); } });
  await expect(attachmentBody(new Request("http://module/api/web/attachments", { method: "POST", body }))).rejects.toThrow("过大");
});
