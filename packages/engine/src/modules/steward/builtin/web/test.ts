import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule } from "chrona/testing";

const module = await startModule("index.ts");
async function get(path: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(`http://module${path}`, { unix: module.httpSocket }); }
    catch (error) { if (attempt > 50) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
try {
  for (const path of ["/", "/today", "/apps/a1?path=README.md", "/sessions/s1"]) {
    const page = await get(path);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await page.text(), /<script src="\/app.js" type="module">/);
    assert.match(page.headers.get("content-security-policy")!, /default-src 'self'/);
  }
  const script = await get("/app.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await script.text(), /\/api\/steward/);
  assert.equal((await get("/style.css")).headers.get("content-type"), "text/css; charset=utf-8");
  // The page never calls Chrona itself.
  assert.equal(module.calls.length, 0);
} finally { await module.stop(); }
