import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectPiLaunch, piEnvironment, piLaunchConfig, type PiProviderOptions } from "./pi-launch";
import { launchPiProcess, type PiProcess } from "./pi-process";

export type PiCompletionInput = { model: string; thinking?: string; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number; signal?: AbortSignal };
export type PiCompletionResult = { text: string; inputTokens: number | null; outputTokens: number | null };
type PiMessage = { provider?: string; model: string; stopReason?: string; content?: { type: string; text?: string }[]; usage?: { input?: unknown; output?: unknown } };
type CompletionState = { child?: PiProcess; closed?: Promise<void>; dir?: string; expired: boolean };
type OutputState = { result?: PiCompletionResult };
const failure = (code: "provider_error" | "timeout" | "cancelled") => Object.assign(new Error(`Module model call: ${code}`), { code });
const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const timedOut = (state: CompletionState) => state.expired;
const childOf = (state: CompletionState) => state.child;

// Each entry verified against that @earendil-works/pi-coding-agent CLI and its
// bundled provider source (1.5.2, 2026-11-14: real run, hook fired and wrote the
// cap; a proxy that ignores the cap is still refused by validMessage). There is
// no CLI max-token flag. Explicit -e still loads with --no-extensions; extension
// load errors abort print mode. Add a version only after the same check.
export const TOKEN_LIMIT_PI_VERSIONS = ["1.5.0", "1.5.2"];

/** Why completion cannot run with this launch config, or null. */
export async function piCompletionUnavailable(config: ReturnType<typeof piLaunchConfig>): Promise<string | null> {
  if (!TOKEN_LIMIT_PI_VERSIONS.includes(config.version)) return `Pi completion requires CHRONA_STEWARD_PI_VERSION in ${TOKEN_LIMIT_PI_VERSIONS.join(", ")} (configured ${config.version})`;
  return inspectPiLaunch(config);
}
function tokenLimitExtension(input: PiCompletionInput, dir: string): string {
  return `import { writeFileSync } from "node:fs";
export default function (pi) {
  const limit = ${input.maxOutputTokens};
  const expectedModel = ${JSON.stringify(input.model)};
  let requested = false;
  // Pi catches hook exceptions and sends the original payload, so a thrown
  // error would fail open. Exit synchronously before handing a request back.
  const refuse = () => process.exit(1);
  pi.on("session_before_compact", refuse);
  pi.on("before_provider_request", (event, ctx) => {
    try {
      const model = ctx.model;
      if (!model || (model.provider + "/" + model.id !== expectedModel && model.id !== expectedModel) || requested) return refuse();
      const payload = event.payload;
      let target = payload, field;
      switch (model.api) {
        case "anthropic-messages": field = "max_tokens"; break;
        case "openai-completions":
          if (Object.hasOwn(payload, "max_tokens") === Object.hasOwn(payload, "max_completion_tokens")) return refuse();
          field = Object.hasOwn(payload, "max_tokens") ? "max_tokens" : "max_completion_tokens";
          break;
        case "openai-responses": field = "max_output_tokens"; break;
        case "google-generative-ai": target = payload.config; field = "maxOutputTokens"; break;
        // In particular, Pi's Codex request builder has no output-token cap.
        default: return refuse();
      }
      // Require Pi's provider to have emitted its supported native cap. Some
      // Responses compatibility modes deliberately omit it: do not invent one.
      if (!target || !Object.hasOwn(target, field) || !Number.isSafeInteger(target[field]) || target[field] <= 0) return refuse();
      target[field] = Math.min(target[field], limit);
      if (model.api === "openai-responses" && target[field] < 16) return refuse();
      if (model.api === "anthropic-messages" && payload.thinking?.type === "enabled") {
        // Match Pi's 1024-token answer reserve without increasing the cap.
        // Anthropic also needs at least 1024 thinking tokens when enabled.
        const budget = payload.thinking.budget_tokens;
        if (!Number.isSafeInteger(budget) || budget < 1024 || target[field] < 2048) return refuse();
        payload.thinking.budget_tokens = Math.min(budget, target[field] - 1024);
      }
      requested = true;
      // Pi redirects extension stdout to stderr in JSON mode. Record only the
      // applied limit in our private directory, before the provider can send.
      writeFileSync(${JSON.stringify(join(dir, "token-limit.applied"))}, String(limit), { mode: 0o600, flag: "wx" });
      return payload;
    } catch { return refuse(); }
  });
}
`;
}
function validMessage(message: PiMessage, input: PiCompletionInput) {
  const exact = message.provider ? `${message.provider}/${message.model}` : message.model;
  const output = tokens(message.usage?.output);
  return (exact === input.model || message.model === input.model) && (message.stopReason === "stop" || message.stopReason === "length") && Array.isArray(message.content) && !message.content.some(part => part.type === "toolCall" || part.type === "text" && typeof part.text !== "string") && (output === null || output <= input.maxOutputTokens);
}
function messageResult(message: PiMessage): PiCompletionResult {
  const content = message.content ?? [];
  return { text: content.filter(part => part.type === "text").map(part => part.text ?? "").join(""), inputTokens: tokens(message.usage?.input), outputTokens: tokens(message.usage?.output) };
}
function parseLine(text: string, input: PiCompletionInput, output: OutputState, fail: () => void) {
  if (!text.trim()) return;
  try {
    const event = JSON.parse(text);
    if (event.type === "tool_execution_start" || event.type === "auto_retry_start" || event.type === "auto_compaction_start") { fail(); return; }
    if (event.type !== "message_end" || event.message?.role !== "assistant") return;
    if (output.result || !validMessage(event.message, input)) { fail(); return; }
    output.result = messageResult(event.message);
  } catch { fail(); }
}
function runPiProcess(config: ReturnType<typeof piLaunchConfig>, input: PiCompletionInput, dir: string, state: CompletionState, isExpired: () => boolean): Promise<PiCompletionResult> {
  const args = ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "-e", join(dir, "token-limit.mjs"), "--mode", "json", "--model", input.model, ...(input.thinking ? ["--thinking", input.thinking] : [])];
  // Pi also accepts file paths here: our own file preserves literal system text,
  // even if that text happens to name a host file. Prompt stdin is documented by Pi CLI.
  if (input.system !== undefined) args.push("--system-prompt", join(dir, "system.txt"));
  return new Promise<PiCompletionResult>((resolve, reject) => {
    const process = (config.options.launch ?? launchPiProcess)({ file: config.command, args, cwd: dir, env: piEnvironment(config), helperPath: config.options.processHelper });
    state.child = process;
    state.closed = process.closed.then(() => {});
    void state.closed.catch(() => {});
    process.stderr.resume();
    let buffer = "", bytes = 0, invalid = false;
    const output: OutputState = {};
    const fail = () => { invalid = true; process.kill("SIGKILL"); };
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      if (invalid) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { fail(); return; }
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) { parseLine(buffer.slice(0, end), input, output, fail); buffer = buffer.slice(end + 1); }
    });
    process.stdin.on("error", fail);
    void process.closed.then(({ code }) => {
      if (!invalid && buffer) parseLine(buffer, input, output, fail);
      if (isExpired()) reject(failure("timeout"));
      else if (invalid) reject(Object.assign(failure("provider_error"), { reason: "pi output was invalid or empty" }));
      else if (code !== 0) reject(Object.assign(failure("provider_error"), { reason: `pi exited with code ${code}` }));
      else if (!output.result) reject(Object.assign(failure("provider_error"), { reason: "pi output was invalid or empty" }));
      else resolve(output.result);
    }, reject);
    process.stdin.end(input.prompt);
  });
}
async function work(
  config: ReturnType<typeof piLaunchConfig>, input: PiCompletionInput, state: CompletionState, isExpired: () => boolean,
): Promise<PiCompletionResult> {
  const unavailable = await piCompletionUnavailable(config);
  if (unavailable) throw Object.assign(failure("provider_error"), { reason: unavailable });
  if (isExpired()) throw failure("timeout");
  state.dir = await mkdtemp(join(tmpdir(), "chrona-model-"));
  await writeFile(join(state.dir, "token-limit.mjs"), tokenLimitExtension(input, state.dir), { mode: 0o600 });
  if (input.system !== undefined) await writeFile(join(state.dir, "system.txt"), input.system, { mode: 0o600 });
  if (isExpired()) throw failure("timeout");
  const result = await runPiProcess(config, input, state.dir, state, isExpired);
  if (await readFile(join(state.dir, "token-limit.applied"), "utf8") !== String(input.maxOutputTokens)) {
    throw Object.assign(failure("provider_error"), { reason: "token limit extension did not apply" });
  }
  return result;
}
function timeoutError(error: unknown, isExpired: () => boolean) {
  return isExpired() || error && typeof error === "object" && "code" in error && error.code === "timeout";
}
async function cleanup(state: CompletionState, timer: ReturnType<typeof setTimeout> | undefined, workPromise: Promise<PiCompletionResult> | undefined) {
  if (timer) clearTimeout(timer);
  await workPromise?.catch(() => {});
  await state.closed;
  if (state.dir) await rm(state.dir, { recursive: true, force: true });
}

/** One completion executor with a trusted token-cap extension; no tools, user extensions, sessions, or fallback. */
export function createPiCompletion(options: PiProviderOptions) {
  const config = piLaunchConfig(options);
  return async (input: PiCompletionInput): Promise<PiCompletionResult> => {
    if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0 || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 2_147_483_647) throw failure("provider_error");
    const state: CompletionState = { expired: false };
    let timer: ReturnType<typeof setTimeout> | undefined, workPromise: Promise<PiCompletionResult> | undefined;
    const isExpired = () => timedOut(state) || !!input.signal?.aborted;
    let cancel: (() => void) | undefined;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => {
          cancel = () => { childOf(state)?.kill("SIGKILL"); reject(failure("cancelled")); };
          input.signal?.addEventListener("abort", cancel, { once: true });
          if (input.signal?.aborted) cancel();
          timer = setTimeout(() => { state.expired = true; childOf(state)?.kill("SIGKILL"); reject(failure("timeout")); }, input.timeoutMs);
        }),
        workPromise = work(config, input, state, isExpired),
      ]);
    } catch (error) {
      const reason = (error as { reason?: unknown }).reason;
      console.error(JSON.stringify({ component: "pi-completion", event: "completion_failed", error: String(reason ?? error).slice(0, 500) }));
      // This evidence reaches the caller only if finally confirms tree closure.
      // A rejected closed promise overrides it and leaves the operation unknown.
      throw Object.assign(failure(input.signal?.aborted ? "cancelled" : timeoutError(error, isExpired) ? "timeout" : "provider_error"), { stopped: true });
    } finally {
      if (cancel) input.signal?.removeEventListener("abort", cancel);
      await cleanup(state, timer, workPromise);
    }
  };
}
