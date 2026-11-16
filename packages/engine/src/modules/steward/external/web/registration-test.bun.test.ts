import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRegistrationTest } from "./registration-test";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(body: string, visibility = ["owner"]) {
  const root = await mkdtemp("/tmp/chrona-registration-"); cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "module.json"), JSON.stringify({ name: "music", entry: "index.ts", activated: true, effects: [], uses: ["web.page-set"], tests: ["test.ts"], tools: [{ name: "play", description: "play", visibility, idempotent: true, parameters: { type: "object", properties: {}, required: [] }, output: { type: "object", properties: {}, additionalProperties: false } }] }));
  await writeFile(join(root, "index.ts"), `import {chrona,on} from 'chrona'; on('activated',async()=>{${body}});`);
  const harness = await createRegistrationTest(join(root, "index.ts")); cleanups.push(harness.close); return harness;
}
const input = { id: "player", title: "播放器", tools: ["play"], javascript: "export default function mount(element) { element.textContent = '播放器'; return () => element.replaceChildren(); }" };
test("actual activated handler registers a page with caller, active version and own tool pins", async () => {
  const harness = await fixture(`await chrona.call('web.page-set',${JSON.stringify(input)});`);
  await harness.activate();
  expect(await harness.pages.get("music", "player")).toMatchObject({ ...input, moduleId: harness.caller.moduleId, hash: harness.caller.hash });
  expect(harness.calls[0]!.result).toMatchObject({ id: "player", revision: expect.any(String) });
  await harness.activate(); expect(await harness.pages.list()).toHaveLength(1);
});
test("registration harness rejects invisible tools, extra arguments and unmocked calls", async () => {
  const invisible = await fixture(`await chrona.call('web.page-set',${JSON.stringify(input)});`, ["modules"]);
  await expect(invisible.activate()).rejects.toThrow("play");
  const extra = await fixture(`await chrona.call('web.page-set',${JSON.stringify({ ...input, module: "other" })});`);
  await expect(extra.activate()).rejects.toMatchObject({ code: "invalid" });
  const unmocked = await fixture("await chrona.call('music.play',{});");
  await expect(unmocked.activate()).rejects.toThrow("Unmocked");
});
