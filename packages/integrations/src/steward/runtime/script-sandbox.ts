import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, cpSync, existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, parse, resolve } from "node:path";
import { processCapability, requireDescendantStop, spawnSupervised, type ProcessStopEvidence } from "@chrona/process";
export { ProcessStopUnknownError } from "@chrona/process";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { redactSensitiveText } from "@chrona/logging/redaction";
import runtimeTable from "../runtimes.json";
import { moduleEntrySchema, type ModuleEntry } from "@chrona/contracts/steward";
import { explicitModuleCommand, moduleEntryFile } from "../module-sdk/module-entry";

type Runtime = { extensions: string[]; programs: { default: string[]; win32?: string[] }; argv: string[]; sdk?: boolean; preload?: string; venv?: { default: string; win32?: string } };
export type ScriptSandboxResult = { status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number; stopEvidence?: ProcessStopEvidence };
function confirmedExit(exit: Awaited<ReturnType<typeof spawnSupervised>["exited"]>) {
  const { code, signal } = requireDescendantStop(exit);
  return { code, signal };
}
type ModuleTransport = { ipcEndpoint: string; ipcToken: string };
type ModuleDirs = { codeDir: string; dataDir: string; contentDir?: string; env?: Record<string, string> } & Partial<ModuleTransport>;
function executable(path: string | null | undefined): string | null {
  try { if (!path) return null; accessSync(path, constants.X_OK); return resolve(path); } catch { return null; }
}
function limits(...values: number[]) {
  for (const value of values) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid sandbox limit");
}
function directory(path: string) {
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory() || resolved === parse(resolved).root) throw new Error("Invalid module directory");
  return resolved;
}
function runtime(entry: string): Runtime {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(entry)) throw new Error("Invalid module entry");
  const declaration = runtimeTable.runtimes.find(item => item.extensions.includes(extname(entry)));
  if (!declaration) throw new Error("Unsupported module entry runtime");
  return declaration;
}
function installLocalSdk(dataDir: string | undefined, moduleSdk: string) {
  if (!dataDir) return;
  const target = join(resolve(dataDir), "platform", "node_modules", "chrona");
  if (existsSync(target)) chmodSync(target, 0o700);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(moduleSdk, target, { recursive: true });
}
function assertExecutionMode(mode: string) {
  if (mode !== "trusted-local") throw new Error("隔离执行模式已移除；请移除旧配置并明确选择 trusted-local（应用拥有运行账号的宿主权限）");
}
function runtimeInterpreter(declared: Runtime, code: string) {
  const platform = process.platform === "win32";
  const venv = declared.venv && join(code, platform ? declared.venv.win32 ?? declared.venv.default : declared.venv.default);
  const programs = platform ? declared.programs.win32 ?? declared.programs.default : declared.programs.default;
  const interpreter = venv && existsSync(venv) ? executable(venv) : programs.map(program => executable(Bun.which(program))).find(Boolean);
  if (!interpreter) throw new Error(`模块运行环境不可用：需要 ${programs.join(" / ")}`);
  return interpreter;
}
function moduleCommand(code: string, entry: ModuleEntry, typecheck: string): { program: string; argv: string[]; sdk?: boolean } {
  if (typeof entry !== "string") return explicitModuleCommand(code, entry);
  const declared = runtime(entry);
  return { program: runtimeInterpreter(declared, code), sdk: declared.sdk,
    argv: [...declared.argv, ...(declared.preload ? ["--preload", join(typecheck, declared.preload)] : []), moduleEntryFile(code, entry)] };
}
function moduleEnvironment(dirs: ModuleDirs, sdkEnabled: boolean, interpreter: string, sdk: string, helper: string): Record<string, string> {
  const excluded = new Set(["CHRONA_SOCKET", "CHRONA_HTTP_SOCKET", "CHRONA_IPC_ENDPOINT", "CHRONA_IPC_TOKEN", "CHRONA_HOST_GENERATION"]);
  const extra = Object.fromEntries(Object.entries(dirs.env ?? {}).filter(([key]) => /^CHRONA_[A-Z_]+$/.test(key) && !excluded.has(key)));
  // Desktop connection paths come only from the host session, never module extras.
  const hostKeys = ["HOME", ...(process.platform === "win32" ? ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "PATHEXT"]
    : process.platform === "linux" ? ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"] : [])];
  const host = Object.fromEntries(hostKeys.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  return { ...extra, ...host, PATH: [dirname(interpreter), process.env.PATH ?? ""].join(delimiter), LANG: "C.UTF-8",
    CHRONA_PROCESS_HELPER: helper, CHRONA_MODULE: dirs.codeDir, CHRONA_DATA: dirs.dataDir,
    ...(dirs.contentDir ? { CHRONA_CONTENT: dirs.contentDir } : {}),
    ...(dirs.ipcEndpoint ? { CHRONA_IPC_ENDPOINT: dirs.ipcEndpoint, CHRONA_IPC_TOKEN: dirs.ipcToken! } : {}),
    ...(sdkEnabled ? { CHRONA_SDK: sdk } : {}) };
}
/** Bind a trusted Provider module generation to the outer guardian. */
function providerHostReceipt(dirs: ModuleDirs, data: string, env: Record<string, string>) {
  if (process.platform !== "linux" || !dirs.env?.CHRONA_PROVIDER_CONFIGURATION) return undefined;
  const generation = randomBytes(32).toString("hex");
  const receipts = join(data, ".host-stops");
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  env.CHRONA_HOST_GENERATION = generation;
  return { path: join(receipts, generation + ".json"), generation };
}
/** Trusted local processes retain OS permissions; routed declarations govern only Chrona calls. */
export function createScriptSandbox({ executionMode = "trusted-local", dataDir, timeoutMs = 60_000, maxOutputBytes = 64 * 1024, moduleSdk = fileURLToPath(new URL("../module-sdk", import.meta.url)), moduleTypecheck = fileURLToPath(new URL("../module-typecheck", import.meta.url)), processHelper }: {
  executionMode?: "trusted-local"; dataDir?: string; timeoutMs?: number; maxOutputBytes?: number;
  moduleSdk?: string; moduleTypecheck?: string; processHelper?: string;
} = {}) {
  assertExecutionMode(executionMode);
  limits(timeoutMs, maxOutputBytes);
  installLocalSdk(dataDir, moduleSdk);
  function spawnModule(dirs: ModuleDirs, entry: ModuleEntry) {
    const validated = moduleEntrySchema.parse(entry);
    const code = directory(dirs.codeDir), data = directory(dirs.dataDir);
    const content = dirs.contentDir ? directory(dirs.contentDir) : undefined;
    const command = moduleCommand(code, validated, moduleTypecheck);
    const interpreter = command.program;
    const sdk = dataDir ? join(resolve(dataDir), "platform/node_modules/chrona") : resolve(moduleSdk);
    const helper = processHelper ?? process.env.CHRONA_PROCESS_HELPER ?? fileURLToPath(new URL(`../../../../process/bin/${process.platform}-${process.arch}/chrona-process-guardian${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
    const env = moduleEnvironment({ ...dirs, codeDir: code, dataDir: data, contentDir: content }, command.sdk === true, interpreter, sdk, helper);
    if (command.sdk) env.CHRONA_SDK_LOADER = join(moduleTypecheck, "chrona-sdk-loader.ts");
    const supervision = processCapability({ helperPath: processHelper });
    if (!supervision.available || supervision.scope !== "descendants") throw new Error(supervision.reason ?? "Full descendant supervision is not verified for this platform");
    const stopReceipt = providerHostReceipt(dirs, data, env);
    return spawnSupervised(interpreter, command.argv, { cwd: code, env, helperPath: processHelper, stopReceipt });
  }
  const supervision = processCapability({ helperPath: processHelper });
  return {
    health: { available: supervision.available && supervision.scope === "descendants", isolated: false },
    supervision,
    startModule({ codeDir, dataDir: moduleData, contentDir, env, entry, ipcEndpoint, ipcToken }: { codeDir: string; dataDir: string; contentDir?: string; env?: Record<string, string>; entry: ModuleEntry; network?: boolean } & ModuleTransport) {
      const endpoint = /^tcp:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(ipcEndpoint);
      if (!endpoint || Number(endpoint[1]) > 65535 || !/^[0-9a-f]{64}$/.test(ipcToken)) throw new Error("Invalid module transport credentials");
      const task = spawnModule({ codeDir, dataDir: moduleData, contentDir, ipcEndpoint, ipcToken, env }, entry), child = task.process;
      child.stdin!.end();
      child.stdout!.resume();
      let errors = Buffer.alloc(0), line = "", dropping = false;
      const decoder = new StringDecoder("utf8");
      const credentials = [ipcToken, ...Object.entries(process.env).filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 8).map(([, value]) => value!)];
      const scrub = (text: string) => redactSensitiveText(credentials.reduce((safe, value) => safe.replaceAll(value, "[Redacted]"), text), 16 * 1024);
      // Frame before redaction: neither chunk boundaries nor the tail cap may expose a credential fragment.
      const logLine = (text: string) => {
        const safe = scrub(text);
        errors = Buffer.concat([errors, Buffer.from(safe)]).subarray(-16 * 1024);
        process.stderr.write(JSON.stringify({ component: "module", moduleId: basename(moduleData), hash: basename(codeDir), pid: child.pid, stderr: redactSensitiveText(safe, 4000) }) + "\n");
      };
      child.stderr!.on("data", (chunk: Buffer) => {
        for (const part of decoder.write(chunk).split(/(?<=\n)/)) {
          if (!dropping) line += part;
          if (line.length > 16 * 1024) { line = ""; dropping = true; }
          if (part.endsWith("\n")) { if (!dropping) logLine(line); else logLine("[oversized stderr line omitted]"); line = ""; dropping = false; }
        }
      });
      child.stderr!.once("end", () => { line += decoder.end(); if (line && !dropping) logLine(line); line = ""; });
      const exited = task.exited.then(confirmedExit);
      const stopEvidence = task.exited.then(exit => exit.stop);
      void stopEvidence.catch(() => {});
      return { pid: child.pid!, ready: task.ready, exited, stopEvidence, stderr: () => errors.toString("utf8") + (dropping ? "[oversized stderr line omitted]" : line ? "[incomplete stderr line omitted]" : ""), kill: task.stop };
    },
    /** One-shot run with JSON on stdin: author tests and data migrations. */
    async runModule({ codeDir, dataDir: moduleData, contentDir, entry, input, timeoutMs: runTimeout = timeoutMs, maxOutputBytes: outputLimit = maxOutputBytes }: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<ScriptSandboxResult> {
      limits(runTimeout, outputLimit);
      runtime(entry);
      let task: ReturnType<typeof spawnSupervised>;
      try { task = spawnModule({ codeDir, dataDir: moduleData, contentDir }, entry); }
      catch (error) { return { status: "unavailable", output: "", error: error instanceof Error ? error.message : "模块运行环境不可用" }; }
      const child = task.process;
      return new Promise((resolve, reject) => {
        let output = Buffer.alloc(0), errors = Buffer.alloc(0), timedOut = false;
        const timer = setTimeout(() => { timedOut = true; task.stop(); }, runTimeout);
        const cap = (previous: Buffer, next: Buffer) => Buffer.concat([previous, next.subarray(0, Math.max(0, outputLimit - previous.length))]);
        child.stdout!.on("data", (chunk: Buffer) => { output = cap(output, chunk); });
        child.stderr!.on("data", (chunk: Buffer) => { errors = cap(errors, chunk); });
        child.stdin!.on("error", () => { /* Early exit closes stdin. */ });
        void task.exited.then(exit => {
          clearTimeout(timer);
          const { code } = confirmedExit(exit);
          resolve({ exitCode: code ?? 1, status: timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed", output: new TextDecoder().decode(output, { stream: true }), error: timedOut ? "脚本运行超时" : errors.length ? new TextDecoder().decode(errors, { stream: true }) : code === 0 ? null : `脚本退出：${code}`, stopEvidence: exit.stop });
        }).catch(error => { clearTimeout(timer); reject(error); });
        child.stdin!.end(JSON.stringify(input));
      });
    },
  };
}
