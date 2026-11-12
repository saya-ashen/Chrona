import { expect, test } from "bun:test";
import { join } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

// Exercise the real shell and dynamic import over loopback. Only the renderer's
// public mount contract is replaced; no generated assets, service, DB or models.
const directory = import.meta.dir;
const renderer = `
  export function registeredDeps() {
    window.fixture.events.push("dependencies");
    return {};
  }
  export function mount(element, page) {
    window.fixture.events.push("registered");
    element.textContent = page.title;
    return () => window.fixture.events.push("unmount");
  }
  export function mountSystem(element, params) {
    window.fixture.events.push(params.name);
    element.textContent = params.name + (params.message ? ": " + params.message : "");
    return () => {};
  }
`;
type Fixture = { events: string[]; consumed: boolean };
declare global { interface Window { fixture: Fixture } }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function navigate(page: Page, path: string) {
  await page.evaluate(href => {
    const anchor = document.createElement("a");
    anchor.href = href; document.body.append(anchor); anchor.click(); anchor.remove();
  }, path);
}
async function visible(page: Page, value: string) {
  await page.waitForFunction(expected => document.querySelector("main")?.textContent === expected, {}, value);
}

test("registered page overlaps renderer loading and preserves manifest, navigation and auth gates", async () => {
  const [app, index] = await Promise.all([
    Bun.file(join(directory, "app.js")).text(), Bun.file(join(directory, "index.html")).text(),
  ]);
  const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
  if (!chrome) throw new Error("Set CHRONA_TEST_CHROME to a Chrome/Chromium executable");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      for (const scenario of ["renderer-first", "manifest-first", "stale-manifest", "stale-renderer", "unauthorized", "manifest-error"] as const) {
        const manifest = deferred<Response>(), module = deferred<Response>();
        const requested = new Set<string>(), errors: string[] = [];
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
          fetch(request) {
            const path = new URL(request.url).pathname;
            requested.add(path);
            if (path === "/app.js") return new Response(app, { headers: { "content-type": "text/javascript" } });
            if (path === "/pages.js") return module.promise;
            if (path === "/style.css") return new Response("");
            if (path === "/api/auth/status") return Response.json({ passwordSet: true, authenticated: true, canSetup: false });
            if (path === "/api/web/pages") return Response.json([]);
            if (path === "/api/web/pages/fixture/main") return manifest.promise;
            if (path === "/api/web/events") return new Response(new ReadableStream({ start(controller) {
              controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            } }), { headers: { "content-type": "text/event-stream" } });
            if (path.startsWith("/api/")) return new Response("Unexpected request", { status: 500 });
            return new Response(index, { headers: { "content-type": "text/html", "content-security-policy": "default-src 'self'" } });
          },
        });
        const context = await browser.createBrowserContext(), page = await context.newPage();
        try {
          await page.setViewport(viewport);
          page.setDefaultTimeout(3000);
          page.on("pageerror", error => errors.push(String(error)));
          await page.evaluateOnNewDocument(() => {
            window.fixture = { events: [], consumed: false };
            // A completion barrier for stale responses: when polling sees this
            // flag, the shell's promise continuations have drained as well.
            window.fetch = new Proxy(window.fetch, {
              async apply(fetch, receiver, args: Parameters<typeof window.fetch>) {
                const response = await fetch.apply(receiver, args);
                if (String(args[0]).endsWith("/api/web/pages/fixture/main")) {
                  const json = response.json.bind(response);
                  response.json = async () => {
                    const value: unknown = await json();
                    window.fixture.consumed = true;
                    return value;
                  };
                }
                return response;
              },
            });
          });
          const rendererRequested = page.waitForRequest(request => new URL(request.url()).pathname === "/pages.js");
          await page.goto(new URL("/p/fixture/main", server.url).href);
          await page.waitForSelector('main [role="status"]');
          // The manifest is still blocked. The serial implementation fails here.
          await rendererRequested;
          expect(requested.has("/api/web/pages/fixture/main")).toBe(true);
          expect(await page.evaluate(() => window.fixture.events)).toEqual([]);
          const releaseRenderer = () => module.resolve(new Response(renderer, { headers: { "content-type": "text/javascript" } }));
          const releaseManifest = () => manifest.resolve(Response.json({ title: "Validated application", layout: "workspace" }));
          if (scenario === "renderer-first" || scenario === "stale-manifest") {
            releaseRenderer();
            await page.evaluate(path => import(path), "/pages.js");
            expect(await page.evaluate(() => window.fixture.events)).toEqual([]);
          } else if (scenario === "manifest-first" || scenario === "stale-renderer") {
            releaseManifest();
            await page.waitForFunction(() => window.fixture.consumed);
            expect(await page.evaluate(() => window.fixture.events)).toEqual([]);
          }
          if (scenario === "stale-manifest" || scenario === "stale-renderer") {
            await navigate(page, "/today");
            if (scenario === "stale-renderer") releaseRenderer();
            await visible(page, "today");
            if (scenario === "stale-manifest") releaseManifest();
            await page.waitForFunction(() => window.fixture.consumed);
            expect(await page.evaluate(() => window.fixture.events)).toEqual(["today"]);
            expect(await page.$eval("body", body => body.classList.contains("web-shell-workspace"))).toBe(false);
          } else if (scenario === "unauthorized" || scenario === "manifest-error") {
            manifest.resolve(Response.json({ message: "Manifest rejected" }, { status: scenario === "unauthorized" ? 401 : 500 }));
            await page.waitForFunction(() => window.fixture.consumed || document.body.classList.contains("web-shell-login"));
            releaseRenderer();
            if (scenario === "unauthorized") {
              await page.waitForFunction(() => window.fixture.events.includes("login"));
              expect(await page.evaluate(() => window.fixture.events)).toEqual(["login"]);
              expect(await page.$eval("body", body => body.classList.contains("web-shell-login"))).toBe(true);
            } else {
              await visible(page, "error: Manifest rejected");
              expect(await page.evaluate(() => window.fixture.events)).toEqual(["error"]);
            }
          } else {
            releaseRenderer(); releaseManifest();
            await visible(page, "Validated application");
            expect(await page.evaluate(() => window.fixture.events)).toEqual(["dependencies", "registered"]);
            expect(await page.$eval("body", body => body.classList.contains("web-shell-workspace"))).toBe(true);
          }
          expect(errors).toEqual([]);
        } catch (error) {
          throw new Error(`${scenario} at ${viewport.width}x${viewport.height}`, { cause: error });
        } finally {
          manifest.resolve(new Response(null, { status: 503 }));
          module.resolve(new Response(null, { status: 503 }));
          await context.close(); server.stop(true);
        }
      }
    }
  } finally { await browser.close(); }
}, 60_000);
