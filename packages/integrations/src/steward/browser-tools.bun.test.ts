import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import browserTools from "../../../../external-plugins/pi-steward-agent/browser-tools";

type Tool = Parameters<Parameters<typeof browserTools>[0]["registerTool"]>[0];
const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Registers the extension with CHRONA_BROWSER set, in a fresh working directory. */
async function withBrowser(browser: string | undefined) {
  const cwd = await mkdtemp(join(tmpdir(), "chrona-browser-tool-")), previous = { cwd: process.cwd(), browser: process.env.CHRONA_BROWSER };
  if (browser === undefined) delete process.env.CHRONA_BROWSER; else process.env.CHRONA_BROWSER = browser;
  process.chdir(cwd);
  cleanups.push(async () => {
    process.chdir(previous.cwd);
    if (previous.browser === undefined) delete process.env.CHRONA_BROWSER; else process.env.CHRONA_BROWSER = previous.browser;
    await rm(cwd, { recursive: true, force: true });
  });
  const tools: Tool[] = [];
  browserTools({ registerTool: tool => { tools.push(tool); } });
  return { cwd, tools };
}
type Content = Awaited<ReturnType<Tool["execute"]>>["content"];
const image = (content: Content) => content.find(part => part.type === "image") as { data: string; mimeType: string } | undefined;

test("without a browser the tool does not exist", async () => {
  expect((await withBrowser(undefined)).tools).toEqual([]);
});

test("screenshots pages on this machine at the asked viewport, returns the image and keeps the file; other hosts are refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrona-fake-browser-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  // A fake browser: records its arguments and writes a PNG where --screenshot asks.
  const browser = join(dir, "browser");
  await writeFile(browser, `#!/bin/sh
printf '%s\\n' "$@" > ${join(dir, "args")}
for arg in "$@"; do case "$arg" in --screenshot=*) printf 'PNG' > "\${arg#--screenshot=}";; esac; done
`, { mode: 0o755 });
  const { cwd, tools } = await withBrowser(realpathSync(browser));
  expect(tools.map(tool => tool.name)).toEqual(["browser_screenshot"]);
  const result = await tools[0]!.execute("1", { url: "http://127.0.0.1:4321/today", width: 390, height: 844 });
  expect(result.content[0]).toEqual({ type: "text", text: "Saved screenshots/001-390x844.png (390x844) of http://127.0.0.1:4321/today" });
  expect(image(result.content)).toEqual({ type: "image", data: Buffer.from("PNG").toString("base64"), mimeType: "image/png" } as never);
  expect(await readFile(join(cwd, "screenshots", "001-390x844.png"), "utf8")).toBe("PNG");
  const args = (await readFile(join(dir, "args"), "utf8")).trim().split("\n");
  expect(args).toContain("--headless=new");
  expect(args).toContain("--window-size=390,844");
  expect(args.at(-1)).toBe("http://127.0.0.1:4321/today");
  // Defaults, and the next file name.
  expect((await tools[0]!.execute("2", { url: "http://localhost:4321/" })).content[0]).toMatchObject({ text: expect.stringContaining("screenshots/002-1440x900.png") });
  for (const url of ["https://example.com/", "http://127.0.0.1.evil.example/", "file:///etc/passwd", "http://10.0.0.1/"]) {
    await expect(tools[0]!.execute("3", { url })).rejects.toThrow("Only pages on this machine");
  }
});

const realBrowser = ["chromium", "google-chrome-stable", "google-chrome"].map(name => Bun.which(name)).find(Boolean);
test.skipIf(!realBrowser)("a real browser captures a served page (runs when Chromium or Chrome is installed)", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<meta charset="utf-8"><body style="background:#6257c7">今天</body>', { headers: { "content-type": "text/html; charset=utf-8" } }) });
  cleanups.push(() => server.stop(true));
  const { tools } = await withBrowser(realpathSync(realBrowser!));
  const result = await tools[0]!.execute("1", { url: `http://127.0.0.1:${server.port}/`, width: 400, height: 300 });
  const png = Buffer.from(image(result.content)!.data, "base64");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  // IHDR: width and height of the captured viewport.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([400, 300]);
}, 90_000);
