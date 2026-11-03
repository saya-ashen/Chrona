import { expect, test } from "bun:test";
import { Hono } from "hono";
import { apiKeyAuth } from "../../../../../../../apps/server/src/middleware/auth";
import { resetEnvCacheForTests } from "../../../../../../../apps/server/src/config/env";
import { catalog } from "./catalog";
import { pageErrors } from "./pages";

test.each([
  ["files/a.png", true],
  ["planning/a.png", false],
  ["files-other/a.png", false],
  [{ $state: "/image/ref" }, true],
  [{ $template: "files/${name}.png" }, true],
])("Image ref %j is checked against its registering app", (ref, valid) => {
  const spec = { root: "image", elements: { image: { type: "Image", props: { ref, alt: "图片", width: null, height: 480 }, children: [] } } };
  expect(catalog.validate(spec).success).toBe(true);
  expect(pageErrors({ spec }, new Map(), "files").length === 0).toBe(valid);
});

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
