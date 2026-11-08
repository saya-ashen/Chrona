import { strict as assert } from "node:assert";

export async function checkRasterContent(get: (path: string) => Promise<Response>, png: Buffer) {
  const imageUrl = "/api/web/pages/files/images/content?ref=";
  assert.equal((await get(imageUrl + "files%2Fno.svg")).status, 403);
  assert.equal((await get(imageUrl + "files%2Fpretend.png")).status, 403);
  assert.equal((await get(imageUrl + "files%2Fbad.png")).status, 502);
  assert.equal((await get(imageUrl + "files%2Flarge.png")).status, 502);
  const missing = await get(imageUrl + "files%2Fmissing.png");
  assert.equal(missing.status, 404); assert.doesNotMatch(await missing.text(), /private internal/);
  assert.equal((await get("/api/web/pages/files/absent/content?ref=files%2Fa.png")).status, 404);
  const image = await get(imageUrl + "files%2Fpicture.png");
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(image.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(image.headers.get("cache-control"), "private, no-cache");
}
