import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectPiLaunch, piEnvironment, piLaunchConfig, type PiProviderOptions } from "./pi-launch";

type Input = { model: string; thinking?: string; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number };
type Result = { text: string; inputTokens: number | null; outputTokens: number | null };
type PiMessage = { provider?: string; model: string; stopReason?: string; content?: { type: string; text?: string }[]; usage?: { input?: unknown; output?: unknown } };
type CompletionState = { child?: ChildProcess; dir?: string; expired: boolean };
const failure = (code: "provider_error" | "timeout") => Object.assign(new Error(`Module model call: ${code}`), { code });
const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const timedOut = (state: CompletionState) => state.expired;
const childOf = (state: CompletionState) => state.child;

function validMessage(message: PiMessage, input: Input) {
  const exact = message.provider ? `${message.provider}/${message.model}` : message.model;
  return (exact === input.model || message.model === input.model) && (message.stopReason === "stop" || message.stopReason === "length") && Array.isArray(message.content) && !message.content.some((part: { type: string }) => part.type === "toolCall");
}
function messageResult(message: PiMessage, input: Input): Result {
  const content = message.content ?? [];
  return { text: content.filter(part => part.type === "text").map(part => part.text ?? "").join("").slice(0, input.maxOutputTokens * 4), inputTokens: tokens(message.usage?.input), outputTokens: tokens(message.usage?.output) };
}
function parseLine(text: string, input: Input, fail: () => void, setResult: (result: Result) => void) {
  if (!text.trim()) return;
  try {
    const event = JSON.parse(text);
    if (event.type === "tool_execution_start" || event.type === "auto_retry_start") { fail(); return; }
    if (event.type !== "message_end" || event.message?.role !== "assistant") return;
    if (!validMessage(event.message, input)) { fail(); return; }
    setResult(messageResult(event.message, input));
  } catch { fail(); }
}
function runPiProcess(config: ReturnType<typeof piLaunchConfig>, input: Input, dir: string, state: CompletionState, isExpired: () => boolean): Promise<Result> {
  const args = ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "--mode", "json", "--model", input.model, ...(input.thinking ? ["--thinking", input.thinking] : [])];
  // Pi also accepts file paths here: our own file preserves literal system text,
  // even if that text happens to name a host file. Prompt stdin is documented by Pi CLI.
  if (input.system !== undefined) args.push("--system-prompt", join(dir, "system.txt"));
  return new Promise<Result>((resolve, reject) => {
    const process = spawn(config.command, args, { cwd: dir, env: piEnvironment(config), stdio: ["pipe", "pipe", "ignore"], shell: false });
    state.child = process;
    let buffer = "", bytes = 0, result: Result | undefined, invalid = false;
    const fail = () => { invalid = true; process.kill("SIGKILL"); reject(failure("provider_error")); };
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { fail(); return; }
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) { parseLine(buffer.slice(0, end), input, fail, value => { result = value; }); buffer = buffer.slice(end + 1); }
    });
    process.stdin.on("error", fail);
    process.once("error", fail);
    process.once("close", code => {
      if (buffer) parseLine(buffer, input, fail, value => { result = value; });
      if (isExpired()) reject(failure("timeout"));
      else if (invalid || code !== 0 || !result) reject(failure("provider_error"));
      else resolve(result);
    });
    process.stdin.end(input.prompt);
  });
}
async function work(config: ReturnType<typeof piLaunchConfig>, input: Input, state: CompletionState, isExpired: () => boolean): Promise<Result> {
  if (await inspectPiLaunch(config)) throw failure("provider_error");
  if (isExpired()) throw failure("timeout");
  state.dir = await mkdtemp(join(tmpdir(), "chrona-model-"));
  if (input.system !== undefined) await writeFile(join(state.dir, "system.txt"), input.system, { mode: 0o600 });
  if (isExpired()) throw failure("timeout");
  return runPiProcess(config, input, state.dir, state, isExpired);
}
function timeoutError(error: unknown, isExpired: () => boolean) {
  return isExpired() || error && typeof error === "object" && "code" in error && error.code === "timeout";
}
async function cleanup(state: CompletionState, timer: ReturnType<typeof setTimeout> | undefined, workPromise: Promise<Result> | undefined) {
  if (timer) clearTimeout(timer);
  await workPromise?.catch(() => {});
  const process = childOf(state);
  if (process?.pid && process.exitCode === null && process.signalCode === null) await new Promise<void>(resolve => process.once("close", () => resolve()));
  if (state.dir) await rm(state.dir, { recursive: true, force: true });
}

/** Credential/model adapter only. No Provider tools, extensions, sessions, or model fallback. */
export function createPiModelGateway(options: PiProviderOptions) {
  const config = piLaunchConfig(options);
  return { async complete(input: Input): Promise<Result> {
    const state: CompletionState = { expired: false };
    let timer: ReturnType<typeof setTimeout> | undefined, workPromise: Promise<Result> | undefined;
    const isExpired = () => timedOut(state);
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => { timer = setTimeout(() => { state.expired = true; childOf(state)?.kill("SIGKILL"); reject(failure("timeout")); }, input.timeoutMs); }),
        workPromise = work(config, input, state, isExpired),
      ]);
    } catch (error) {
      throw timeoutError(error, isExpired) ? failure("timeout") : failure("provider_error");
    } finally {
      await cleanup(state, timer, workPromise);
    }
  } };
}
