import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createPiModelGateway } from "./pi-model-gateway";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(mode = "ok", version = "1.3.0") {
  const dir = await mkdtemp("/tmp/chrona-model-test-");
  const agentDir = await mkdtemp("/tmp/chrona-model-profile-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }), () => rm(agentDir, { recursive: true, force: true }));
  const command = join(dir, "pi"), launch = join(dir, "launch.json"), pid = join(dir, "pid");
  await writeFile(join(dir, "extension.ts"), "");
  await writeFile(command, `#!${process.execPath}
import { writeFileSync, readFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }
writeFileSync(${JSON.stringify(pid)}, String(process.pid));
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk.toString();
writeFileSync(${JSON.stringify(launch)}, JSON.stringify({ args, prompt, system: args.includes('--system-prompt') ? readFileSync(args[args.indexOf('--system-prompt')+1], 'utf8') : null, envKeys: Object.keys(process.env), agentDir: process.env.PI_CODING_AGENT_DIR }));
const mode = ${JSON.stringify(mode)};
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'exit') { process.stderr.write('private error with prompt ' + prompt); process.exit(7); }
else if (mode === 'malformed') { console.log('broken'); }
else {
 const message = { role: 'assistant', model: mode === 'wrong-model' ? 'other' : 'exact', provider: 'fake', stopReason: mode === 'error' ? 'error' : 'stop', content: [{type:'thinking',thinking:'hidden'}, {type:'text',text:'你好\\u2028world with extra text'}], usage:{input:12,output:8} };
 console.log(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'ignore'}}));
 const data = Buffer.from(JSON.stringify({type:'message_end', message})+'\\r\\n');
 process.stdout.write(data.subarray(0,117)); setTimeout(() => process.stdout.write(data.subarray(117)), 5);
}
`, { mode: 0o755 });
  const gateway = createPiModelGateway({ command, agentDir, expectedVersion: "1.3.0", chronaExtension: join(dir, "extension.ts"), agentUrl: "" });
  return { gateway, launch, pid, agentDir, input: { model: "fake/exact", system: "Translate literally", prompt: "@not-a-file\n你好" + "x".repeat(140_000), maxOutputTokens: 3, timeoutMs: 2000 } };
}
test("Pi one-shot uses stdin, exact model, isolated args/env and final JSON text/usage", async () => {
  const f = await fixture();
  const result = await f.gateway.complete(f.input);
  expect(result).toEqual({ text: "你好\u2028world with extra text".slice(0, 12), inputTokens: 12, outputTokens: 8 });
  const launch = JSON.parse(await readFile(f.launch, "utf8"));
  for (const flag of ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes"]) expect(launch.args).toContain(flag);
  expect(launch.args.slice(launch.args.indexOf("--model"), launch.args.indexOf("--model") + 2)).toEqual(["--model", "fake/exact"]);
  expect(launch.args).not.toContain(f.input.prompt);
  expect(launch.prompt).toBe(f.input.prompt);
  expect(launch.system).toBe(f.input.system);
  expect(launch.agentDir).toBe(f.agentDir);
  expect(launch.envKeys).not.toContain("DATABASE_URL");
  expect(launch.envKeys).not.toContain("CHRONA_AGENT_TOKEN");
});
for (const mode of ["exit", "malformed", "error", "wrong-model"]) test(`Pi ${mode} maps to provider_error without private output`, async () => {
  const f = await fixture(mode);
  await expect(f.gateway.complete(f.input)).rejects.toMatchObject({ code: "provider_error", message: "Module model call: provider_error" });
});
test("version mismatch refuses launch", async () => {
  const f = await fixture("ok", "wrong");
  await expect(f.gateway.complete(f.input)).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.pid, "utf8").catch(() => null)).toBeNull();
});
test("timeout SIGKILLs Pi", async () => {
  const f = await fixture("hang");
  await expect(f.gateway.complete({ ...f.input, timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout" });
  const pid = Number(await readFile(f.pid, "utf8"));
  let alive = true;
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { alive = false; break; } await Bun.sleep(5); }
  expect(alive).toBe(false);
});
