import { expect, test } from "bun:test";
import { Hono } from "hono";
import { apiKeyAuth } from "../../../../../../../apps/server/src/middleware/auth";
import { resetEnvCacheForTests } from "../../../../../../../apps/server/src/config/env";
test("the existing API authentication rejects anonymous image requests before forwarding", async () => {
  const previous = process.env.API_KEY;
  try {
    process.env.API_KEY = "image-auth-fixture";
    resetEnvCacheForTests();
    const app = new Hono();
    let forwarded = false;
    app.use("/api/*", apiKeyAuth());
    app.get("/api/web/pages/files/images/content", c => { forwarded = true; return c.text("forwarded"); });
    const path = "/api/web/pages/files/images/content?ref=files%2Fa.png";
    expect((await app.request(path)).status).toBe(401);
    expect(forwarded).toBe(false);
    expect((await app.request(path, { headers: { authorization: "Bearer image-auth-fixture" } })).status).toBe(200);
    expect(forwarded).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.API_KEY; else process.env.API_KEY = previous;
    resetEnvCacheForTests();
  }
});
