import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectPiLaunch, piEnvironment, piLaunchConfig, type PiProviderOptions } from "./pi-launch";

type Input = { model: string; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number };
type Result = { text: string; inputTokens: number | null; outputTokens: number | null };
const failure = (code: "provider_error" | "timeout") => Object.assign(new Error(`Module model call: ${code}`), { code });
const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
/** Credential/model adapter only. No Provider tools, extensions, sessions, or model fallback. */
export function createPiModelGateway(options: PiProviderOptions) {
  const config = piLaunchConfig(options);
  return { async complete(input: Input): Promise<Result> {
    let child: ChildProcess | undefined, expired = false, timer: ReturnType<typeof setTimeout> | undefined, dir: string | undefined, work: Promise<Result> | undefined;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; child?.kill("SIGKILL"); reject(failure("timeout")); }, input.timeoutMs); }),
        work = (async () => {
          if (await inspectPiLaunch(config)) throw failure("provider_error");
          if (expired) throw failure("timeout");
          dir = await mkdtemp(join(tmpdir(), "chrona-model-"));
          const args = ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "--mode", "json", "--model", input.model];
          // Pi also accepts file paths here: our own file preserves literal system text,
          // even if that text happens to name a host file. Prompt stdin is documented by Pi CLI.
          if (input.system !== undefined) {
            const path = join(dir, "system.txt");
            await writeFile(path, input.system, { mode: 0o600 });
            args.push("--system-prompt", path);
          }
          if (expired) throw failure("timeout");
          return await new Promise<Result>((resolve, reject) => {
            const process = spawn(config.command, args, { cwd: dir, env: piEnvironment(config), stdio: ["pipe", "pipe", "ignore"], shell: false });
            child = process;
            let buffer = "", bytes = 0, result: Result | undefined, invalid = false;
            const fail = () => { invalid = true; process.kill("SIGKILL"); reject(failure("provider_error")); };
            function line(text: string) {
              if (!text.trim()) return;
              try {
                const event = JSON.parse(text);
                if (event.type === "tool_execution_start" || event.type === "auto_retry_start") { fail(); return; }
                if (event.type !== "message_end" || event.message?.role !== "assistant") return;
                const message = event.message;
                const exact = message.provider ? `${message.provider}/${message.model}` : message.model;
                if ((exact !== input.model && message.model !== input.model) || !["stop", "length"].includes(message.stopReason) || !Array.isArray(message.content) || message.content.some((part: { type: string }) => part.type === "toolCall")) { fail(); return; }
                // shortcut: approximate the output token cap with four characters per token.
                result = { text: message.content.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("").slice(0, input.maxOutputTokens * 4), inputTokens: tokens(message.usage?.input), outputTokens: tokens(message.usage?.output) };
              } catch { fail(); }
            }
            process.stdout.setEncoding("utf8");
            process.stdout.on("data", (chunk: string) => {
              bytes += Buffer.byteLength(chunk);
              if (bytes > 8 * 1024 * 1024) { fail(); return; }
              buffer += chunk;
              let end: number;
              while ((end = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
            });
            process.stdin.on("error", fail);
            process.once("error", fail);
            process.once("close", code => {
              if (buffer) line(buffer);
              if (expired) reject(failure("timeout"));
              else if (invalid || code !== 0 || !result) reject(failure("provider_error"));
              else resolve(result);
            });
            process.stdin.end(input.prompt);
          });
        })(),
      ]);
    } catch (error) {
      throw expired || error && typeof error === "object" && "code" in error && error.code === "timeout" ? failure("timeout") : failure("provider_error");
    } finally {
      if (timer) clearTimeout(timer);
      await work?.catch(() => {});
      if (child?.pid && child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => child!.once("close", () => resolve()));
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  } };
}
