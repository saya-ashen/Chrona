import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

// Run the shell's real read wrapper, with a controlled transport to distinguish
// overlapping reads, later observations, and login boundaries.
async function fixture() {
  const source = await Bun.file(new URL("./app.js", import.meta.url)).text();
  const start = source.indexOf("let pagesRead = null;");
  const end = source.indexOf("// A module tool", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const calls: { url: string; options: unknown; resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const request = (url: string, options: unknown) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  const api = runInNewContext(`let session = 1; ${source.slice(start, end)}; ({ web, login: () => session++ })`, { request }) as {
    web(path: string, options?: { method?: string }): Promise<unknown>; login(): void;
  };
  return { ...api, calls };
}

test("only overlapping inventory GETs share a read; later reads and other routes remain fresh", async () => {
  const f = await fixture();
  const navigation = f.web("/pages"), settings = f.web("/pages");
  expect(settings).toBe(navigation);
  expect(f.calls).toHaveLength(1);
  f.calls[0]!.resolve([{ id: "old" }]);
  expect(await settings).toEqual([{ id: "old" }]);
  const fresh = f.web("/pages");
  expect(f.calls).toHaveLength(2);
  f.calls[1]!.resolve([{ id: "current" }]);
  expect(await fresh).toEqual([{ id: "current" }]);
  const page = f.web("/pages/app/main"), mutation = f.web("/pages", { method: "POST" });
  expect(f.calls.map(call => call.url)).toEqual(["/api/web/pages", "/api/web/pages", "/api/web/pages/app/main", "/api/web/pages"]);
  f.calls[2]!.resolve({}); f.calls[3]!.resolve({});
  await Promise.all([page, mutation]);
});

test("a rejected shared read is retried by the next observation", async () => {
  const f = await fixture();
  const first = f.web("/pages"), second = f.web("/pages");
  const result = Promise.allSettled([first, second]);
  f.calls[0]!.reject(new Error("directory unavailable"));
  expect((await result).map(item => item.status)).toEqual(["rejected", "rejected"]);
  const next = f.web("/pages");
  expect(f.calls).toHaveLength(2);
  f.calls[1]!.resolve([]);
  expect(await next).toEqual([]);
});

test("a prior login read cannot replace or clear the new login's overlapping read", async () => {
  const f = await fixture();
  const old = f.web("/pages");
  f.login();
  const current = f.web("/pages");
  expect(f.calls).toHaveLength(2);
  f.calls[0]!.resolve(["old login"]);
  await old;
  expect(f.web("/pages")).toBe(current);
  expect(f.calls).toHaveLength(2);
  f.calls[1]!.resolve(["new login"]);
  expect(await current).toEqual(["new login"]);
});
