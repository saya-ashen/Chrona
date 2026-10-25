import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A build directory like Chrona's: the SDK under node_modules/chrona and a module that serves a page and a data call. */
async function buildDir() {
  const root = await mkdtemp(join(tmpdir(), "chrona-preview-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules"), { recursive: true });
  await cp(join(import.meta.dirname, "module-sdk"), join(root, "node_modules", "chrona"), { recursive: true });
  await mkdir(join(root, "page"));
  await writeFile(join(root, "page", "module.json"), JSON.stringify({ name: "page", entry: "index.ts", tests: [], triggers: [], effects: [], keepAlive: true, listen: ["/"], uses: ["chat.today", "chat.send"] }));
  await writeFile(join(root, "page", "index.ts"), `import { chrona } from "chrona";
chrona.serve(async request => {
  const url = new URL(request.url);
  if (url.pathname === "/api/today") return Response.json(await chrona.call("chat.today", {}));
  if (url.pathname === "/api/send") return Response.json({ sent: await chrona.call("chat.send", await request.json()), method: request.method });
  return new Response("<h1>预览</h1>", { headers: { "content-type": "text/html; charset=utf-8" } });
});
`);
  return root;
}
/** Starts the preview the way a build run does and answers with the URL it prints. */
async function preview(root: string, args: string[]) {
  const child = spawn(process.execPath, ["--no-install", "node_modules/chrona/preview.ts", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  cleanups.push(async () => { child.kill("SIGTERM"); await exited; });
  let output = "";
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No preview URL: ${output}`)), 20_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const url = /Preview: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
      if (url) { clearTimeout(timer); resolve(url); }
    };
    child.stdout.on("data", read); child.stderr.on("data", read);
  });
}

test("preview serves the module's pages on 127.0.0.1 and answers its routed calls from fixtures, else with null", async () => {
  const root = await buildDir();
  await writeFile(join(root, "fixtures.json"), JSON.stringify({ "chat.today": { approvals: [{ id: "a1" }] } }));
  const url = await preview(root, ["page", "fixtures.json"]);
  expect(await (await fetch(url)).text()).toBe("<h1>预览</h1>");
  expect(await (await fetch(`${url}api/today`)).json()).toEqual({ approvals: [{ id: "a1" }] });
  // Request bodies reach the module; calls without a fixture answer null and do nothing real.
  expect(await (await fetch(`${url}api/send`, { method: "POST", body: JSON.stringify({ text: "hi" }) })).json()).toEqual({ sent: null, method: "POST" });
}, 30_000);

test("without fixtures every routed call answers null; a missing module directory is a usage error", async () => {
  const root = await buildDir();
  const url = await preview(root, ["page"]);
  expect(await (await fetch(`${url}api/today`)).json()).toBeNull();
  const usage = spawn(process.execPath, ["--no-install", "node_modules/chrona/preview.ts"], { cwd: root, stdio: "ignore" });
  expect(await new Promise<number | null>(resolve => usage.once("close", code => resolve(code)))).toBe(2);
}, 30_000);
