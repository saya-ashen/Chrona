import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CHRONA_TOOLS, type ProviderRunInput } from "@chrona/contracts/steward";
import { readPiResources, resourceCommand, resourceVersionError, type PiResources } from "./pi-resources";

export type PiProviderOptions = {
  command?: string; agentDir?: string; expectedVersion?: string; model?: string; resourcesFile?: string;
  chronaExtension: string; webExtension?: string | null; agentUrl: string; bwrap?: string | null;
  workspaceRoot?: string;
};
export type PiLaunchConfig = {
  options: PiProviderOptions; command: string; agentDir: string; version: string;
  extension: string; web: string | null; bwrap: string | null; resources: PiResources; resourceError: string | null;
};
const supportedVersions = new Set(["0.85.0", "1.3.0"]);
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
export const profileOverlaps = (profile: string, work: string) => inside(profile, work) || inside(work, profile);

/** No PATH fallback or inheritance of the interactive user's Pi resource profile. */
export function piLaunchConfig(options: PiProviderOptions): PiLaunchConfig {
  const selected = readPiResources(options.resourcesFile, options.agentDir ?? "", options.workspaceRoot);
  return { options, command: options.command ?? "", agentDir: options.agentDir ?? "", version: options.expectedVersion ?? "0.85.0", resources: selected.resources, resourceError: selected.error,
    extension: resolve(options.chronaExtension), web: options.webExtension ? resolve(options.webExtension) : null,
    bwrap: options.bwrap ? (options.bwrap.includes("/") ? resolve(options.bwrap) : options.bwrap) : null };
}
function privateProfile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isDirectory() && realpathSync(path) === path && (process.platform === "win32" || (stat.mode & 0o077) === 0);
  } catch { return false; }
}
function configurationError(config: PiLaunchConfig): string | null {
  if (!isAbsolute(config.command)) return "Configure an absolute, service-specific Pi executable";
  if (!isAbsolute(config.agentDir) || !privateProfile(config.agentDir)) return "Pi profile must be an existing private canonical directory";
  if (config.options.workspaceRoot && profileOverlaps(config.agentDir, resolve(config.options.workspaceRoot))) return "Pi profile must be separate from the affair workspace";
  if (!supportedVersions.has(config.version)) return "Unsupported Pi version pin";
  if (config.resourceError) return config.resourceError;
  const resourceError = resourceVersionError(config.resources, config.version, !!config.bwrap);
  if (resourceError) return resourceError;
  if (!existsSync(config.extension)) return "Chrona tools extension missing";
  if (config.web && !existsSync(config.web)) return "Pi web extension missing";
  return null;
}
/** Chrona/QQ/database secrets are not inherited. Pi's own model credentials remain its responsibility. */
export function piEnvironment(config: PiLaunchConfig): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"];
  return { ...Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])), PI_CODING_AGENT_DIR: config.agentDir };
}
async function probe(command: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; version: string }> {
  return new Promise(resolveProbe => {
    let output = "";
    try {
      const child = spawn(command, ["--version"], { env, stdio: ["ignore", "pipe", "ignore"], shell: false });
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-256); });
      child.once("error", () => { clearTimeout(timer); resolveProbe({ ok: false, version: "" }); });
      child.once("close", code => { clearTimeout(timer); resolveProbe({ ok: code === 0, version: output.trim() }); });
    } catch { resolveProbe({ ok: false, version: "" }); }
  });
}
export async function inspectPiLaunch(config: PiLaunchConfig): Promise<string | null> {
  const invalid = configurationError(config);
  if (invalid) return invalid;
  const env = piEnvironment(config), pi = await probe(config.command, env);
  if (!pi.ok) return "Pi binary unavailable";
  if (pi.version !== config.version) return "Pi version does not match the configured pin";
  if (config.bwrap && !(await probe(config.bwrap, env)).ok) return "bubblewrap binary unavailable";
  return null;
}
function workspaceMounts(config: PiLaunchConfig, input: ProviderRunInput, cwd: string) {
  const rootRun = config.options.workspaceRoot !== undefined && cwd === resolve(config.options.workspaceRoot);
  const mounts = [rootRun ? "--ro-bind" : "--bind", cwd, cwd];
  if (!config.bwrap || !rootRun) return mounts;
  if (realpathSync(cwd) !== cwd) throw new Error("Unsafe workspace root");
  const sessions = join(cwd, ".chrona", "sessions");
  if (resolve(input.sessionDir) !== sessions || realpathSync(sessions) !== sessions) throw new Error("Unsafe root session directory");
  mounts.push("--bind", sessions, sessions);
  for (const entry of readdirSync(cwd, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const directory = join(cwd, entry.name);
    if (realpathSync(directory) !== directory) throw new Error("Unsafe affair directory");
    mounts.push("--bind", directory, directory);
  }
  return mounts;
}
export function piArguments(config: PiLaunchConfig, input: ProviderRunInput, prompt: string) {
  const args = ["--mode", "rpc", "--session-dir", resolve(input.sessionDir), "--session-id", input.sessionId ?? randomUUID(),
    "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "-e", config.extension];
  if (config.web) args.push("-e", config.web);
  for (const extension of config.resources.extensions) args.push("-e", extension);
  for (const skill of config.resources.skills) args.push("--skill", skill);
  args.push("--tools", [...new Set(["read", "edit", "write", "grep", "find", "ls", ...(config.bwrap ? ["bash"] : []), ...CHRONA_TOOLS, ...(config.web ? ["web_search", "fetch_content"] : []), ...config.resources.tools])].join(","), "--append-system-prompt", `${prompt}\nThis is a ${input.lane} run.`);
  if (config.options.model) args.push("--model", config.options.model);
  if (!config.bwrap) return args;
  const cwd = resolve(input.cwd);
  return ["--die-with-parent", "--ro-bind", "/", "/", "--tmpfs", "/tmp", "--dev", "/dev", "--proc", "/proc", ...workspaceMounts(config, input, cwd),
    "--bind", config.agentDir, config.agentDir, "--chdir", cwd, "--", config.command, ...args];
}
/** Detect command resources appended by a wrapper. Not a proof that arbitrary executable code is safe. */
export function expectedPiCommands(config: PiLaunchConfig, commands: unknown): boolean {
  if (!Array.isArray(commands)) return false;
  const base = [config.extension, config.web].filter((path): path is string => path !== null);
  return commands.every(command => command && typeof command === "object" && resourceCommand(config.resources, command.source, command.sourceInfo?.path ?? command.path, base));
}
