import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRemotePi, type RemotePiInput } from "./pi";
import { PROMPT_PROTOCOL, type ModelInput } from "./protocol";

// Explicitly opt in to a reviewed credential-free Pi binary. All completions
// below are deterministic in-process fixtures; provider network is loopback.
const command = process.env.CHRONA_TEST_PI_COMMAND;
const actualPi = test.skipIf(!command || process.platform !== "linux");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-remote-pi-")), cwd = join(root, "work"), profiles = join(root, "profiles"), helperPath = join(root, "guardian");
  mkdirSync(cwd, { mode: 0o700 }); mkdirSync(profiles, { mode: 0o700 });
  const processRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/process"))), "..");
  const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
  const built = spawnSync("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", join(processRoot, "native/guardian.c"), "-o", helperPath], { encoding: "utf8" });
  expect(built.status).toBe(0);
  writeFileSync(join(cwd, "fixture.txt"), "only loopback fake model saw this\n");
  const requests: { key: string; input: ModelInput }[] = [];
  let text = "";
  return { root, cwd, requests, chronaExtension: join(piRoot, "resources/chrona-tools.ts"), text: () => text,
    start(model: RemotePiInput["model"], budget: Partial<RemotePiInput["budget"]> = {}, options: { events?: RemotePiInput["events"]; chronaExtension?: string } = {}) {
      const timeoutMs = budget.timeoutMs ?? 25_000;
      return startRemotePi({ command: command!, expectedVersion: "1.5.0", helperPath, chronaExtension: options.chronaExtension ?? join(piRoot, "resources/chrona-tools.ts"), profileRoot: profiles, cwd, events: options.events,
        execution: { workId: "fake-work", sessionId: "fake-session", runId: "fake-run", attemptId: "fake-attempt" }, goal: "Complete the deterministic offline fixture.", deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
        budget: { timeoutMs, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400, ...budget }, onText: delta => { text += delta; },
        model: async (key, input) => { requests.push({ key, input }); return model(key, input); },
      });
    }, close() { rmSync(root, { recursive: true, force: true }); },
  };
}
const completion = (content: string | null, tool_calls: { id: string; name: string; arguments: Record<string, unknown> }[] = []) => ({ status: "completed", reservationId: "fake-reservation", result: { text: JSON.stringify({ version: 1, content, tool_calls }), inputTokens: null, outputTokens: null } });
actualPi("actual Pi RPC uses governed loopback text/tool completions and a native tool", async () => {
  const f = fixture();
  try {
    const handle = f.start(async (_key, input) => {
      const transcript = JSON.parse(input.prompt);
      expect(transcript.protocol).toBe(PROMPT_PROTOCOL);
      expect(input.maxOutputTokens).toBeLessThanOrEqual(400);
      if (f.requests.length === 1) return completion(null, [{ id: "read_fixture", name: "read", arguments: { path: "fixture.txt" } }]);
      expect(transcript.messages.some((message: { role: string; content: unknown }) => message.role === "tool" && JSON.stringify(message.content).includes("only loopback fake model saw this"))).toBe(true);
      return completion("Verified fixture: only loopback fake model saw this");
    });
    expect(await handle.done).toMatchObject({ outcome: "finished", error: null });
    expect(f.requests.length).toBe(2); expect(f.requests[0]!.key).not.toBe(f.requests[1]!.key);
    expect(f.text()).toContain("Verified fixture");
    expect(readFileSync(join(f.cwd, "fixture.txt"), "utf8")).toBe("only loopback fake model saw this\n");
  } finally { f.close(); }
}, 30_000);
actualPi("actual Pi cannot make a second completion after its model-call cap", async () => {
  const f = fixture();
  try {
    const result = await f.start(async () => completion(null, [{ id: "read_once", name: "read", arguments: { path: "fixture.txt" } }]), { maxModelCalls: 1 }).done;
    expect(result.outcome).toBe("failed"); expect(f.requests).toHaveLength(1);
  } finally { f.close(); }
}, 30_000);
actualPi("actual Pi blocks the excess native tool before its write side effect", async () => {
  const f = fixture();
  try {
    const result = await f.start(async () => f.requests.length <= 2 ? completion(null, [f.requests.length === 1
      ? { id: "allowed_write", name: "write", arguments: { path: "allowed.txt", content: "admitted" } }
      : { id: "excess_write", name: "write", arguments: { path: "forbidden.txt", content: "must never be written" } },
    ]) : completion("fixture finished"), { maxToolCalls: 1, maxModelCalls: 3 }).done;
    expect(["failed", "finished"]).toContain(result.outcome);
    expect(readFileSync(join(f.cwd, "allowed.txt"), "utf8")).toBe("admitted");
    expect(existsSync(join(f.cwd, "forbidden.txt"))).toBe(false);
    expect(f.requests.length).toBeGreaterThanOrEqual(2);
    expect(f.requests.length).toBeLessThanOrEqual(3);
  } finally { f.close(); }
}, 30_000);
actualPi("actual Pi deadline stops a model wait without another reservation", async () => {
  const f = fixture(), started = Date.now();
  try {
    const result = await f.start(async () => new Promise<never>(() => {}), { timeoutMs: 2500 }).done;
    expect(result.outcome).toBe("timed_out"); expect(f.requests).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(8000);
  } finally { f.close(); }
}, 12_000);
actualPi("actual Pi and its native tool receive no host provider, app, cloud, or proxy credentials", async () => {
  const f = fixture();
  try {
    // Test the host boundary in a separate process; changing this runner's
    // environment also changes unrelated concurrently running SDK fixtures.
    const input = { command, expectedVersion: "1.5.0", helperPath: join(f.root, "guardian"), chronaExtension: f.chronaExtension, profileRoot: join(f.root, "profiles"), cwd: f.cwd,
      execution: { workId: "env-work", sessionId: "env-session", runId: "env-run", attemptId: "env-attempt" }, goal: "Verify the offline environment.", deadlineAt: new Date(Date.now() + 25_000).toISOString(),
      budget: { timeoutMs: 25_000, maxToolCalls: 2, maxModelCalls: 2, maxOutputTokens: 400 } };
    const first = completion(null, [{ id: "environment_check", name: "bash", arguments: { command: 'test -z "$ANTHROPIC_API_KEY" && test -z "$CHRONA_AGENT_TOKEN" && test -z "$AWS_SECRET_ACCESS_KEY" && test -z "$HTTP_PROXY" && printf env-clean > env.txt' } }]);
    const script = `import {startRemotePi} from ${JSON.stringify(import.meta.resolve("./pi"))};let calls=0;const handle=startRemotePi({...${JSON.stringify(input)},onText(){},async model(){return ++calls===1?${JSON.stringify(first)}:${JSON.stringify(completion("environment verified"))};}});console.log(JSON.stringify(await handle.done));`;
    const child = Bun.spawn([process.execPath, "--eval", script], { env: { ...process.env, ANTHROPIC_API_KEY: "fixture-only-do-not-use", CHRONA_AGENT_TOKEN: "fixture-only-do-not-use", AWS_SECRET_ACCESS_KEY: "fixture-only-do-not-use", HTTP_PROXY: "fixture-only-do-not-use" }, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ outcome: "finished", error: null });
    expect(readFileSync(join(f.cwd, "env.txt"), "utf8")).toBe("env-clean");
  } finally { f.close(); }
}, 30_000);
actualPi("actual Pi question uses the optional governed ProviderEvents answer channel", async () => {
  const f = fixture(), extension = join(f.root, "question.ts");
  let questions = 0;
  writeFileSync(extension, `import base from ${JSON.stringify(f.chronaExtension)};import {writeFileSync} from 'node:fs';export default function(api){base(api);api.on('before_agent_start',async(_event,ctx)=>{if(await ctx.ui.confirm('Offline fixture','Continue?',{timeout:5000}))writeFileSync('question-confirmed.txt','confirmed');});}`);
  try {
    const result = await f.start(async () => completion("Question channel completed"), {}, { chronaExtension: extension, events: {
      async progress() {}, async usage() {}, async resources() {},
      async question(question, signal) { questions++; expect(signal.aborted).toBe(false); expect(question).toMatchObject({ method: "confirm", title: "Offline fixture", message: "Continue?" }); return { decision: "submit", value: true }; },
    } }).done;
    expect(result).toMatchObject({ outcome: "finished", error: null }); expect(questions).toBe(1);
    expect(readFileSync(join(f.cwd, "question-confirmed.txt"), "utf8")).toBe("confirmed");
  } finally { f.close(); }
}, 30_000);
