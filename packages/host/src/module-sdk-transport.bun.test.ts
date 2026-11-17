import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startModule } from "../../app-sdk/testing";

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-sdk-transport-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules"));
  await cp(join(import.meta.dirname, "../../app-sdk"), join(root, "node_modules", "chrona"), { recursive: true });
  await writeFile(join(root, "module.json"), JSON.stringify({ entry: "index.ts", effects: [], uses: ["fixture.echo"] }));
  await writeFile(join(root, "index.ts"), `import { chrona, on } from "chrona";
on("tool", async event => ({ result: await chrona.call("fixture.echo", event.args) }));
chrona.serve(async request => {
  if (new URL(request.url).pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/private" } });
  return Response.json({ headers: Object.fromEntries(request.headers), method: request.method, body: await request.text() }, { headers: { "set-cookie": "owner=untrusted; Path=/", "x-chrona-module-token": "response-must-be-stripped" } });
});
`);
  return root;
}

test("distributed SDK/testing use authenticated IPC and HTTP, with no Unix socket aliases", async () => {
  const root = await fixture();
  const before = process.env.CHRONA_MODULE;
  process.env.CHRONA_MODULE = root;
  cleanups.push(() => { if (before === undefined) delete process.env.CHRONA_MODULE; else process.env.CHRONA_MODULE = before; });
  const module = await startModule(join(root, "index.ts"), { stubs: { "fixture.echo": args => args } });
  cleanups.push(() => module.stop());
  const { endpoint, token } = await module.httpReady;
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect("httpSocket" in module).toBe(false);
  expect((await fetch(endpoint)).status).toBe(401);
  expect((await fetch(endpoint, { headers: { "x-chrona-module-token": "bad" } })).status).toBe(401);
  expect((await fetch(endpoint, { headers: { "x-chrona-module-token": "f".repeat(64) } })).status).toBe(401);
  const response = await module.fetch("/echo", { method: "POST", headers: { "x-chrona-module-token": "caller-cannot-override", "content-type": "text/plain" }, body: "你好" });
  expect(response.status).toBe(200);
  const body = await response.json() as { headers: Record<string, string>; method: string; body: string };
  expect(body.method).toBe("POST"); expect(body.body).toBe("你好");
  expect(body.headers["x-chrona-module-token"]).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(token);
  const event = await module.send({ trigger: { kind: "tool", id: "echo", firedAt: new Date().toISOString(), args: { value: "roundtrip" } }, now: new Date().toISOString(), params: {} });
  expect(event.result).toEqual({ result: { value: "roundtrip" } });
  expect(module.calls[0]?.params.target).toBe("fixture.echo");
  expect((await module.fetch("/redirect", { redirect: "follow" })).status).toBe(302);
  await expect(module.fetch("http://localhost:1/")).rejects.toThrow("local path");
  await expect(module.fetch("//localhost:1/")).rejects.toThrow("local path");
});

test("preview forwards application credentials and cookies while stripping private transport headers", async () => {
  const root = await fixture();
  const child = spawn(process.execPath, ["--no-install", join(root, "node_modules/chrona/preview.ts"), root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  cleanups.push(async () => { child.kill("SIGTERM"); await exited; });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Preview did not start")), 5000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const url = /Preview: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
      if (url) { clearTimeout(timer); resolve(url); }
    };
    child.stdout!.on("data", read); child.stderr!.on("data", read);
  });
  const response = await fetch(endpoint, { headers: { authorization: "Bearer owner-secret", cookie: "owner=secret", "x-chrona-module-token": "fake-token" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBe("owner=untrusted; Path=/");
  expect(response.headers.get("x-chrona-module-token")).toBeNull();
  const body = await response.json() as { headers: Record<string, string> };
  expect(body.headers.authorization).toBe("Bearer owner-secret");
  expect(body.headers.cookie).toBe("owner=secret");
  expect(body.headers["x-chrona-module-token"]).toBeUndefined();
});
