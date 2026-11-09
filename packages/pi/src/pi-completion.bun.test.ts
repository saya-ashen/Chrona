import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createPiCompletion } from "./pi-completion";
import { launchPiProcess } from "./pi-process";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const fullText = "你好\u2028👩🏽‍🚀 café e\u0301".repeat(150) + "\ncomplete ending  ";
const providerPayloads = [
  { api: "openai-completions", payload: { max_completion_tokens: 65536 }, field: "max_completion_tokens" },
  { api: "openai-completions", payload: { max_tokens: 65536 }, field: "max_tokens" },
  { api: "openai-responses", payload: { max_output_tokens: 65536 }, field: "max_output_tokens" },
  { api: "anthropic-messages", payload: { max_tokens: 65536 }, field: "max_tokens" },
  { api: "google-generative-ai", payload: { config: { maxOutputTokens: 65536, temperature: 0.4 } }, field: "maxOutputTokens" },
];
async function fixture(mode = "ok", options: { version?: string; pin?: string; api?: string; payload?: object } = {}) {
  const dir = await mkdtemp("/tmp/chrona-model-test-");
  const agentDir = await mkdtemp("/tmp/chrona-model-profile-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }), () => rm(agentDir, { recursive: true, force: true }));
  const command = join(dir, "pi"), launch = join(dir, "launch.json"), pid = join(dir, "pid"), sent = join(dir, "sent");
  await writeFile(join(dir, "extension.ts"), "");
  await writeFile(command, `#!${process.execPath}
import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (process.argv.includes('--version')) { console.log(${JSON.stringify(options.version ?? "1.5.0")}); process.exit(0); }
writeFileSync(${JSON.stringify(pid)}, String(process.pid));
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk.toString();
const extension = args[args.indexOf('-e') + 1];
const record = { args, prompt, cwd: process.cwd(), extensionMode: statSync(extension).mode & 0o777, system: args.includes('--system-prompt') ? readFileSync(args[args.indexOf('--system-prompt')+1], 'utf8') : null, envKeys: Object.keys(process.env), agentDir: process.env.PI_CODING_AGENT_DIR };
const save = () => writeFileSync(${JSON.stringify(launch)}, JSON.stringify(record));
save();
const mode = ${JSON.stringify(mode)};
const hooks = new Map();
if (mode !== 'skip-extension') {
 const adapter = await import(pathToFileURL(extension).href);
 adapter.default({ on: (name, handler) => hooks.set(name, handler) });
 const payload = ${JSON.stringify(options.payload ?? { max_completion_tokens: 65536 })};
 const ctx = { model: { id: mode === 'wrong-request-model' ? 'other' : 'exact', provider: 'fake', api: ${JSON.stringify(options.api ?? "openai-completions")} } };
 if (mode === 'compaction') hooks.get('session_before_compact')({});
 const bounded = hooks.get('before_provider_request')({ payload }, ctx);
 record.payload = bounded;
 save();
 writeFileSync(${JSON.stringify(sent)}, 'bounded provider request');
 if (mode === 'second-request') hooks.get('before_provider_request')({ payload }, ctx);
}
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'exit') { process.stderr.write('private error with prompt ' + prompt); process.exit(7); }
else if (mode === 'malformed') { console.log('broken'); setInterval(() => {}, 1000); }
else if (mode === 'overflow') { process.stdout.write(' '.repeat(8 * 1024 * 1024 + 1)); setInterval(() => {}, 1000); }
else if (mode === 'retry' || mode === 'tool-execution') { console.log(JSON.stringify({type: mode === 'retry' ? 'auto_retry_start' : 'tool_execution_start'})); setInterval(() => {}, 1000); }
else {
 const message = { role: 'assistant', model: mode === 'wrong-model' ? 'other' : 'exact', provider: 'fake', stopReason: mode === 'error' ? 'error' : mode === 'length' ? 'length' : 'stop', content: [{type:'thinking',thinking:'hidden'}, {type:'text',text:${JSON.stringify(fullText)}}], usage:{input:12,output:mode === 'over-budget' ? 129 : mode === 'length' ? 128 : 8} };
 if (mode === 'tool-call') message.content.push({type:'toolCall',name:'bash'});
 if (mode === 'missing-usage') delete message.usage;
 console.log(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'ignore'}}));
 const data = Buffer.from(JSON.stringify({type:'message_end', message})+'\\r\\n');
 const split = data.indexOf(Buffer.from('你')) + 1;
 process.stdout.write(data.subarray(0,split)); setTimeout(() => process.stdout.write(data.subarray(split)), 5);
}
`, { mode: 0o755 });
  const providerOptions = { command, agentDir, expectedVersion: options.pin ?? "1.5.0", chronaExtension: join(dir, "extension.ts"), agentUrl: "" };
  const complete = createPiCompletion(providerOptions);
  return { complete, providerOptions, launch, pid, sent, agentDir, input: { model: "fake/exact", system: "Translate literally", prompt: "@not-a-file\n你好" + "x".repeat(140_000), maxOutputTokens: 128, timeoutMs: 2000 } };
}
async function expectStoppedAndCleaned(f: Awaited<ReturnType<typeof fixture>>) {
  const pid = Number(await readFile(f.pid, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  const launch = JSON.parse(await readFile(f.launch, "utf8"));
  expect(await stat(launch.cwd).catch(() => null)).toBeNull();
}
test("Pi one-shot preserves complete multibyte text and uses isolated stdin, model, args, env and private adapter", async () => {
  const f = await fixture();
  const result = await f.complete(f.input);
  expect(result).toEqual({ text: fullText, inputTokens: 12, outputTokens: 8 });
  expect(fullText.length).toBeGreaterThan(f.input.maxOutputTokens * 4);
  const launch = JSON.parse(await readFile(f.launch, "utf8"));
  for (const flag of ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve"]) expect(launch.args).toContain(flag);
  expect(launch.args.filter((arg: string) => arg === "-e")).toHaveLength(1);
  expect(launch.args.slice(launch.args.indexOf("--model"), launch.args.indexOf("--model") + 2)).toEqual(["--model", "fake/exact"]);
  expect(launch.args).not.toContain(f.input.prompt);
  expect(launch.prompt).toBe(f.input.prompt);
  expect(launch.system).toBe(f.input.system);
  expect(launch.agentDir).toBe(f.agentDir);
  expect(launch.extensionMode).toBe(0o600);
  expect(launch.envKeys).not.toContain("DATABASE_URL");
  expect(launch.envKeys).not.toContain("CHRONA_AGENT_TOKEN");
  expect(launch.args).not.toContain("--thinking");
  await expectStoppedAndCleaned(f);
  // The tier's thinking level goes to Pi as its own flag; the model id stays exact.
  await f.complete({ ...f.input, thinking: "max" });
  const thinking = JSON.parse(await readFile(f.launch, "utf8"));
  expect(thinking.args.slice(thinking.args.indexOf("--thinking"), thinking.args.indexOf("--thinking") + 2)).toEqual(["--thinking", "max"]);
  expect(thinking.payload.max_completion_tokens).toBe(f.input.maxOutputTokens);
});
for (const { api, payload, field } of providerPayloads) test(`trusted adapter bounds ${api} ${field} on the final provider payload`, async () => {
  const f = await fixture("ok", { api, payload });
  await f.complete(f.input);
  const launch = JSON.parse(await readFile(f.launch, "utf8"));
  const expected = structuredClone(payload);
  const target = expected.config ?? expected;
  Object.assign(target, { [field]: f.input.maxOutputTokens });
  expect(launch.payload).toEqual(expected);
});
test("Anthropic thinking budget fits inside the cap and Pi's answer reserve", async () => {
  const f = await fixture("ok", { api: "anthropic-messages", payload: { max_tokens: 65536, thinking: { type: "enabled", budget_tokens: 8192 } } });
  await f.complete({ ...f.input, maxOutputTokens: 4096, thinking: "medium" });
  expect(JSON.parse(await readFile(f.launch, "utf8")).payload).toEqual({ max_tokens: 4096, thinking: { type: "enabled", budget_tokens: 3072 } });
});
test("Anthropic adaptive thinking remains adaptive under the cap", async () => {
  const f = await fixture("ok", { api: "anthropic-messages", payload: { max_tokens: 65536, thinking: { type: "adaptive" } } });
  await f.complete(f.input);
  expect(JSON.parse(await readFile(f.launch, "utf8")).payload).toEqual({ max_tokens: 128, thinking: { type: "adaptive" } });
});
test("adapter preserves a stricter native provider cap", async () => {
  const f = await fixture("ok", { payload: { max_completion_tokens: 16 } });
  await f.complete(f.input);
  expect(JSON.parse(await readFile(f.launch, "utf8")).payload.max_completion_tokens).toBe(16);
});
for (const mode of ["length", "missing-usage"]) test(`Pi ${mode} returns the complete result`, async () => {
  const f = await fixture(mode);
  const result = await f.complete(f.input);
  expect(result).toEqual({ text: fullText, inputTokens: mode === "missing-usage" ? null : 12, outputTokens: mode === "missing-usage" ? null : 128 });
});
for (const mode of ["exit", "malformed", "error", "wrong-model", "wrong-request-model", "over-budget", "tool-call", "tool-execution", "retry", "compaction", "second-request", "skip-extension", "overflow"]) test(`Pi ${mode} fails with sanitized provider_error after stop and cleanup`, async () => {
  const f = await fixture(mode);
  await expect(f.complete(f.input)).rejects.toMatchObject({ code: "provider_error", message: "Module model call: provider_error" });
  await expectStoppedAndCleaned(f);
  if (mode === "compaction" || mode === "wrong-request-model") expect(await readFile(f.sent, "utf8").catch(() => null)).toBeNull();
});
for (const options of [
  { api: "openai-codex-responses", payload: { max_output_tokens: 65536 } },
  { api: "unknown-api" },
  { api: "openai-responses", payload: {} },
  { api: "google-generative-ai", payload: {} },
  { api: "anthropic-messages", payload: { max_tokens: 65536, thinking: { type: "enabled", budget_tokens: 8192 } } },
  { api: "openai-responses", payload: { max_output_tokens: 15 } },
  { payload: { max_completion_tokens: 0 } },
  { payload: { max_completion_tokens: "65536" } },
  { payload: { max_completion_tokens: 65536, max_tokens: 65536 } },
]) test(`unsupported native request ${JSON.stringify(options)} exits before provider dispatch`, async () => {
  const f = await fixture("ok", options);
  await expect(f.complete(f.input)).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.sent, "utf8").catch(() => null)).toBeNull();
  await expectStoppedAndCleaned(f);
});
test("version mismatch refuses model launch", async () => {
  const f = await fixture("ok", { version: "wrong" });
  await expect(f.complete(f.input)).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.pid, "utf8").catch(() => null)).toBeNull();
});
for (const version of ["0.85.0", "1.3.0", "1.5.1"]) test(`unverified Pi ${version} refuses model launch`, async () => {
  const f = await fixture("ok", { version, pin: version });
  await expect(f.complete(f.input)).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.pid, "utf8").catch(() => null)).toBeNull();
});
for (const maxOutputTokens of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid token cap ${maxOutputTokens} refuses launch`, async () => {
  const f = await fixture();
  await expect(f.complete({ ...f.input, maxOutputTokens })).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.pid, "utf8").catch(() => null)).toBeNull();
});
for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) test(`invalid timeout ${timeoutMs} refuses launch`, async () => {
  const f = await fixture();
  await expect(f.complete({ ...f.input, timeoutMs })).rejects.toMatchObject({ code: "provider_error" });
  expect(await readFile(f.pid, "utf8").catch(() => null)).toBeNull();
});
test("timeout returns only after Pi is SIGKILLed and its files removed", async () => {
  const f = await fixture("hang");
  await expect(f.complete({ ...f.input, timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout", message: "Module model call: timeout" });
  await expectStoppedAndCleaned(f);
});

test("unknown completion closure rejects and retains private files instead of publishing a result", async () => {
  const f = await fixture(), uncertainty = new Error("Completion descendants could not be verified");
  const complete = createPiCompletion({ ...f.providerOptions, launch(input) {
    const child = launchPiProcess(input);
    if (input.args.includes("--version")) return child;
    return { ...child, closed: child.closed.then(() => { throw uncertainty; }) };
  } });
  await expect(complete(f.input)).rejects.toBe(uncertainty);
  const launch = JSON.parse(await readFile(f.launch, "utf8"));
  cleanups.push(() => rm(launch.cwd, { recursive: true, force: true }));
  expect((await stat(launch.cwd)).isDirectory()).toBe(true);
  expect(await readFile(join(launch.cwd, "token-limit.applied"), "utf8")).toBe(String(f.input.maxOutputTokens));
});
