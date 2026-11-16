import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiProviderOptions } from "@chrona/pi";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { createPiApplication, publicError, REGISTRATION } from "./application";
import { manifest } from "./build";
import { toolSchemas } from "./schema";
import { moduleManifestSchema } from "@chrona/contracts/steward";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const data = await mkdtemp("/tmp/chrona-pi-application-"); directories.push(data);
  const profile = join(data, "profile"); await mkdir(profile, { mode: 0o700 });
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "profile", defaultModel: "model", defaultThinkingLevel: "low" }));
  const calls: { target: string; args: Record<string, unknown> }[] = [], snapshots: PiProviderOptions[] = [], inputs: ProviderRunInput[] = [];
  const finishers: ((value: { outcome: "finished"; sessionId: null; error: null }) => void)[] = [];
  const completeInputs: Parameters<NonNullable<ProviderAdapter["complete"]>>[0][] = [];
  let native = 0, starts = 0, failCompletion = false;
  const application = createPiApplication({ data, options: { agentDir: profile, model: "host/model", chronaExtension: "/host/bridge", agentUrl: "http://host/runtime" },
    createProvider(options) { snapshots.push(options); return { name: "pi", supportsRunModel: true,
      async health() { return { available: true, sandboxed: true, error: null }; },
      async complete(input) { completeInputs.push(input); if (failCompletion) throw new Error("private account detail"); return { text: "answer", inputTokens: 5, outputTokens: 3 }; },
      async transcript() { return [{ kind: "text", at: "2026-11-11T00:00:00.000Z", text: "same session" }]; },
      start(input) { inputs.push(input); starts++; return { done: new Promise(resolve => { finishers.push(resolve); }), async inject() {}, async abort() {}, async native(request) { native++; return { request, handle: starts }; } }; },
    }; }, async call(target, args) { calls.push({ target, args }); return target === "runtime-callback.event" && (args.event as { kind: string }).kind === "question" ? { decision: "submit", value: true } : {}; },
  });
  await application.activate();
  const revision = (calls[0]!.args.configuration as { revision: string }).revision;
  calls.splice(0);
  const request = { configurationRevision: revision, operationId: "one", runId: "run-one", token: "kernel-token", callbacks: "00000000-0000-4000-8000-000000000001", lane: "foreground", cwd: data, sessionDir: data, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "configured", deadline: null };
  return { application, data, profile, calls, snapshots, inputs, request, completeInputs, failCompletion: () => { failCompletion = true; }, counts: () => ({ starts, native }), finish: (index = 0) => finishers[index]!({ outcome: "finished", sessionId: null, error: null }) };
}
const kernel = { kind: "kernel" }, owner = { kind: "owner" };
test("manifest is an ordinary pi app with structural kernel tools and owner settings", async () => {
  const parsed = moduleManifestSchema.parse(manifest());
  expect(parsed.name).toBe("pi"); expect(parsed.activated).toBe(true);
  expect(parsed.uses).toEqual(["agent.register", "runtime-callback.event", "web.page-set"]);
  for (const tool of parsed.tools) {
    expect(tool.visibility).toEqual([tool.name === "configure" || tool.name === "models" ? "owner" : "kernel"]);
    expect(tool.parameters.properties).not.toHaveProperty("input");
  }
  const start = parsed.tools.find(tool => tool.name === "start")!;
  expect(start.parameters.properties).toHaveProperty("operationId"); expect(start.parameters.required).toContain("callbacks");
  expect(start.parameters.properties.sessionId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  const f = await setup(); await f.application.activate();
  expect(f.calls[0]).toEqual({ target: "agent.register", args: { ...REGISTRATION, configuration: { ...REGISTRATION.configuration, revision: f.request.configurationRevision } } });
  expect(f.calls[1]!.target).toBe("web.page-set");
});
test("an optional unconfigured Pi application registers and reports unavailable health without leaking factory errors", async () => {
  const f = await setup(), calls: string[] = [];
  const app = createPiApplication({ data: f.data, options: { chronaExtension: "", agentUrl: "" },
    createProvider() { throw new Error("private host configuration"); }, async call(target) { calls.push(target); return {}; },
  });
  await app.activate();
  expect(calls).toEqual(["agent.register", "web.page-set"]);
  expect(await app.handle("health", {}, kernel)).toMatchObject({ name: "pi", available: false, complete: false, error: "Pi configuration or host bridge is unavailable" });
});
test("execution is kernel-only and settings require a routed owner call", async () => {
  const f = await setup();
  for (const name of Object.keys(REGISTRATION.endpoints)) {
    await expect(f.application.handle(name, {}, { kind: "module" }, "call-module")).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.application.handle(name, {}, owner, "call-owner")).rejects.toMatchObject({ code: "forbidden" });
  }
  for (const kind of ["kernel", "provider"]) await expect(f.application.handle("configure", { view: true }, { kind }, "call")).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.application.handle("configure", {}, owner)).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.application.handle("configure", { view: true }, owner, "owner-call")).resolves.toMatchObject({ effective: { profile: f.profile } });
  expect(f.snapshots).toHaveLength(0); expect(f.calls).toHaveLength(0);
});
test("launch snapshots model/thinking/profile; callbacks bind raw, questions and details to the supplied identity", async () => {
  const f = await setup();
  await f.application.handle("configure", { config: { model: "configured/model", thinking: "high" } }, owner, "owner-call");
  await f.application.handle("start", { ...f.request, providerOptions: { model: "run/model", thinking: "minimal" } }, kernel);
  expect(f.snapshots[0]).toMatchObject({ model: "run/model", thinking: "minimal", agentDir: f.profile });
  expect(f.inputs[0]).toMatchObject({ runId: "run-one", token: "kernel-token", deadline: null, providerOptions: { thinking: "minimal", model: "run/model" } });
  expect(f.calls.find(call => (call.args.event as { value?: { type?: string } })?.value?.type === "chrona_configuration")?.args).toMatchObject({ callbackId: f.request.callbacks, event: { value: { effective: { model: "run/model", modelSource: "run", thinking: "minimal", thinkingSource: "run" } } } });
  await f.inputs[0]!.events!.raw!({ type: "future_event", nested: { "original-key": null } });
  const controller = new AbortController();
  expect(await f.inputs[0]!.events!.question({ method: "confirm", title: "Proceed?", message: "", options: [], timeoutMs: 1000 }, controller.signal)).toEqual({ decision: "submit", value: true });
  expect(f.calls).toContainEqual({ target: "runtime-callback.event", args: { callbackId: f.request.callbacks, event: { kind: "raw", value: { type: "future_event", nested: { "original-key": null } } } } });
  const updated = await f.application.handle("configure", { config: { model: "changed/model", thinking: "low" } }, owner, "owner-change") as { revision: string };
  expect(await f.application.handle("native", { operationId: "one", request: { type: "future_native" } }, kernel)).toEqual({ response: { request: { type: "future_native" }, handle: 1 } });
  expect(f.counts()).toEqual({ starts: 1, native: 1 }); expect(f.snapshots).toHaveLength(1);
  await f.application.handle("start", { ...f.request, configurationRevision: updated.revision, operationId: "two", runId: "run-two" }, kernel);
  expect(f.snapshots[1]).toMatchObject({ model: "changed/model", thinking: "low" });
  expect(f.inputs[1]!.providerOptions!.thinking).toBe("low");
  await expect(f.application.handle("start", { ...f.request, operationId: "three", model: "pinned/model", providerOptions: { model: "other/model" } }, kernel)).rejects.toMatchObject({ code: "conflict" });
  f.finish(); f.finish(1); await f.application.stop();
  expect(f.calls.some(call => (call.args.event as { kind?: string })?.kind === "settled")).toBe(true);
});
test("completion resolves configured model, respects explicit limits and never replays a failed process", async () => {
  const f = await setup();
  const args = { configurationRevision: f.request.configurationRevision, commandKey: "completion-one", prompt: "summarize", maxOutputTokens: 10, timeoutMs: 5000 };
  const result = await Promise.all([f.application.handle("complete", args, kernel), f.application.handle("complete", args, kernel)]);
  expect(result).toEqual([{ operationId: args.commandKey }, { operationId: args.commandKey }]);
  async function settled(id: string) {
    for (let count = 0; count < 200; count++) {
      const status = toolSchemas.status[1].parse(await f.application.handle("status", { operationId: id }, kernel));
      if (status.outcome || status.failure) return status;
      await Bun.sleep(5);
    }
    throw new Error("Completion did not settle");
  }
  expect(await settled(args.commandKey)).toMatchObject({ outcome: { outcome: "finished" }, completion: { text: "answer", inputTokens: 5, outputTokens: 3 } }); expect(f.completeInputs).toHaveLength(1);
  expect(f.completeInputs[0]).toMatchObject({ model: "host/model", thinking: "low", timeoutMs: 5000, maxOutputTokens: 10 });
  await expect(f.application.handle("complete", { ...args, prompt: "changed" }, kernel)).rejects.toMatchObject({ code: "conflict" });
  f.failCompletion();
  expect(await f.application.handle("complete", { ...args, commandKey: "failed" }, kernel)).toEqual({ operationId: "failed" });
  expect(await settled("failed")).toMatchObject({ failure: true, outcome: null });
  await expect(f.application.handle("complete", { ...args, commandKey: "failed" }, kernel)).rejects.toMatchObject({ code: "unknown" });
  expect(f.completeInputs).toHaveLength(2);
  const journals = await Promise.all((await readdir(join(f.data, "operations"))).map(name => readFile(join(f.data, "operations", name), "utf8")));
  expect(journals.join()).not.toContain("summarize"); expect(journals.join()).not.toContain("account detail");
  expect(publicError(new Error("secret=private-value"))).toEqual({ code: "unknown", message: "Pi operation remains unconfirmed" });
  for (const code of ["unsupported", "too_large", "unavailable", "invalid"]) {
    const error = publicError(Object.assign(new Error("secret=private-value"), { code }));
    expect(error.code).toBe(code); expect(error.message).not.toContain("private-value");
  }
});
test("queued launches and completions keep their admitted revision while new registrations advance", async () => {
  const f = await setup();
  const updated = await f.application.handle("configure", { config: { model: "updated/model", thinking: "max" } }, owner, "save") as { revision: string };
  expect(f.calls.at(-1)).toMatchObject({ target: "agent.register", args: { configuration: { revision: updated.revision } } });
  // The kernel admitted this request before configure; its first dispatch occurs afterwards.
  await f.application.handle("start", f.request, kernel);
  expect(f.snapshots[0]).toMatchObject({ model: "host/model", thinking: "low", agentDir: f.profile });
  await f.application.handle("complete", { commandKey: "queued", configurationRevision: f.request.configurationRevision, prompt: "summarize", maxOutputTokens: 10 }, kernel);
  expect(f.completeInputs[0]).toMatchObject({ model: "host/model", thinking: "low" });
  await f.application.handle("start", { ...f.request, configurationRevision: updated.revision, operationId: "new-context", runId: "new-run" }, kernel);
  expect(f.snapshots[2]).toMatchObject({ model: "updated/model", thinking: "max" });
  const count = f.snapshots.length;
  await expect(f.application.handle("start", { ...f.request, operationId: "missing", configurationRevision: undefined }, kernel)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.application.handle("start", { ...f.request, operationId: "unknown", configurationRevision: "f".repeat(64) }, kernel)).rejects.toMatchObject({ code: "unavailable" });
  await expect(f.application.handle("complete", { commandKey: "unknown", configurationRevision: "f".repeat(64), prompt: "summary", maxOutputTokens: 10 }, kernel)).rejects.toMatchObject({ code: "unavailable" });
  expect(f.snapshots).toHaveLength(count);
  const cleared = await f.application.handle("configure", { clear: true }, owner, "clear") as { revision: string };
  expect(cleared.revision).toBe(f.request.configurationRevision);
  expect(f.calls.at(-1)).toMatchObject({ target: "agent.register", args: { configuration: { revision: cleared.revision } } });
  f.finish(); f.finish(1); await f.application.stop();
});
test("failed configuration registration retries its archived revision before advertising it", async () => {
  const f = await setup(); let failing = true;
  const registrations: Record<string, unknown>[] = [];
  const app = createPiApplication({ data: f.data, options: { agentDir: f.profile, chronaExtension: "/host/bridge", agentUrl: "http://host/runtime" },
    createProvider() { throw new Error("must not launch"); }, async call(target, args) {
      if (target === "agent.register") { registrations.push(args); if (failing) return { error: "not available" }; }
      return {};
    },
  });
  await expect(app.handle("configure", { config: { model: "retry/model" } }, owner, "save")).rejects.toMatchObject({ code: "unavailable" });
  const revision = (registrations[0]!.configuration as { revision: string }).revision;
  expect(await readFile(join(f.data, "configuration-revisions", `${revision}.json`), "utf8")).toContain("retry/model");
  failing = false; await app.refreshSettings();
  expect(registrations).toHaveLength(2); expect(registrations[1]).toEqual(registrations[0]);
});
test("a valid native request whose full reply exceeds the shared envelope fails explicitly without a second process", async () => {
  const f = await setup(); await f.application.handle("start", f.request, kernel);
  const request = { type: "future_native", value: "x".repeat(65500) };
  let error: unknown;
  try { await f.application.handle("native", { operationId: "one", request }, kernel); }
  catch (caught) { error = caught; }
  expect(publicError(error)).toMatchObject({ code: "too_large" });
  expect(f.counts()).toEqual({ starts: 1, native: 1 });
  f.finish(); await f.application.stop();
});

test("Pi application health reuses its version observation across adapters and completion availability", async () => {
  const data = await mkdtemp("/tmp/chrona-pi-health-probe-"); directories.push(data);
  const profile = join(data, "profile"), command = join(data, "pi"), extension = join(data, "extension.ts"), counter = join(data, "probes");
  await mkdir(profile); await writeFile(extension, "");
  await writeFile(command, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nif(!process.argv.includes('--version'))throw Error('Health must not start a model');\nappendFileSync(${JSON.stringify(counter)},'probe\\n');console.log('1.5.2');\n`, {mode:0o755});
  const { createPiProvider } = await import("@chrona/pi");
  const app = createPiApplication({ data, options: { command, agentDir: profile, expectedVersion: "1.5.2", model: "fake/model", chronaExtension: extension, agentUrl: "http://127.0.0.1:3101/api/steward-agent" }, createProvider: createPiProvider, call: async () => ({}) });
  try {
    await app.activate();
    expect(await app.handle("health", {}, kernel)).toMatchObject({available:true,complete:true});
    expect(await readFile(counter,"utf8")).toBe("probe\n");
    expect(await app.handle("health", {}, kernel)).toMatchObject({available:true,complete:true});
    expect(await readFile(counter,"utf8")).toBe("probe\n");
  } finally { await app.stop(); }
});
