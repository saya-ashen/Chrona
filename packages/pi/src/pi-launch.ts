import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CHRONA_TOOLS, type ProviderRunInput } from "@chrona/contracts/steward";
import { modernPi, readPiResources, resourceCommand, resourceVersionError, type PiResources } from "./pi-resources";
import { launchPiProcess, type PiProcess, type PiProcessInput } from "./pi-process";

export type PiProviderOptions = {
  command?: string; agentDir?: string; expectedVersion?: string; model?: string; resourcesFile?: string; executionMode?: "trusted-local" | "required-isolation";
  chronaExtension: string; webExtension?: string | null; agentUrl: string;
  /** The browser tool (v2-12): its extension, and where runs get a browser from; without either runs have no browser tool. */
  browserExtension?: string | null; browsers?: { ensure(): string | null };
  workspaceRoot?: string;
  /** Opt-in: end a run whose Pi RPC stream is silent this long outside tool runs and user questions. No default. */
  idleTimeoutMs?: number;
  /** Trusted launcher; closed must reject if its owned process tree cannot be proven stopped. */
  launch?: (input: PiProcessInput) => PiProcess;
  /** Absolute guardian resource path supplied by the trusted host. */
  processHelper?: string;
};
export type PiLaunchConfig = {
  options: PiProviderOptions; command: string; agentDir: string; version: string;
  extension: string; web: string | null; browserExtension: string | null; resources: PiResources; resourceError: string | null;
};
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
export const profileOverlaps = (profile: string, work: string) => inside(profile, work) || inside(work, profile);

/** No PATH fallback or inheritance of the interactive user's Pi resource profile. */
export function piLaunchConfig(options: PiProviderOptions): PiLaunchConfig {
  const selected = readPiResources(options.resourcesFile, options.agentDir ?? "", options.workspaceRoot);
  return { options, command: options.command ?? "", agentDir: options.agentDir ?? "", version: options.expectedVersion ?? "0.85.0", resources: selected.resources, resourceError: selected.error,
    extension: resolve(options.chronaExtension), web: options.webExtension ? resolve(options.webExtension) : null,
    browserExtension: options.browserExtension ? resolve(options.browserExtension) : null };
}
function privateProfile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isDirectory() && realpathSync(path) === path && (process.platform === "win32" || (stat.mode & 0o077) === 0);
  } catch { return false; }
}
const isolationError = "Pi required-isolation is no longer supported; configure trusted-local execution";
function configurationError(config: PiLaunchConfig): string | null {
  if (!isAbsolute(config.command)) return "Configure an absolute, service-specific Pi executable";
  if (!isAbsolute(config.agentDir) || !privateProfile(config.agentDir)) return "Pi profile must be an existing private canonical directory";
  if (config.options.workspaceRoot && profileOverlaps(config.agentDir, resolve(config.options.workspaceRoot))) return "Pi profile must be separate from the session workspace";
  if (config.version !== "0.85.0" && !modernPi(config.version)) return "Unsupported Pi version pin";
  if (config.resourceError) return config.resourceError;
  const resourceError = resourceVersionError(config.resources, config.version);
  if (resourceError) return resourceError;
  const extensions = [[config.extension, "Chrona tools extension missing"], [config.web, "Pi web extension missing"], [config.browserExtension, "Pi browser extension missing"]] as const;
  return extensions.find(([path]) => path && !existsSync(path))?.[1] ?? null;
}
export const PI_MODEL_ENVIRONMENT_KEYS = ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"] as const;
/** Chrona/QQ/database secrets are not inherited. Pi's own model credentials remain its responsibility. */
export function piEnvironment(config: PiLaunchConfig): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", ...PI_MODEL_ENVIRONMENT_KEYS];
  return { ...Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])), PI_CODING_AGENT_DIR: config.agentDir };
}
async function probe(config: PiLaunchConfig): Promise<{ ok: boolean; version: string; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = (config.options.launch ?? launchPiProcess)({ file: config.command, args: ["--version"], cwd: config.agentDir, env: piEnvironment(config), timeoutMs: 3000, helperPath: config.options.processHelper });
    let output = "";
    const deadline = Date.now() + 3000;
    timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-256); });
    child.stderr.resume();
    child.stdin.on("error", () => child.kill("SIGKILL"));
    child.stdin.end();
    const { code, signal } = await child.closed;
    return { ok: Date.now() < deadline && code === 0 && signal === null, version: output.trim() };
  } catch (error) { return { ok: false, version: "", error: error instanceof Error ? error.message : "Pi process supervision unavailable" }; }
  finally { clearTimeout(timer); }
}
export async function inspectPiLaunch(config: PiLaunchConfig): Promise<string | null> {
  if (config.options.executionMode === "required-isolation") return isolationError;
  const invalid = configurationError(config);
  if (invalid) return invalid;
  const pi = await probe(config);
  if (!pi.ok) return pi.error ?? "Pi binary unavailable or version probe timed out";
  if (pi.version !== config.version) return "Pi version does not match the configured pin";
  return null;
}
function contentAreas(input: ProviderRunInput) {
  return (input.content ?? []).map(area => {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(area.name) || !isAbsolute(area.dir) || realpathSync(area.dir) !== area.dir) throw new Error("Unsafe content directory");
    return area;
  });
}
/** Content areas appear at <cwd>/content/<name> as host links; writability follows the service user's OS permissions. */
export function prepareContent(input: ProviderRunInput) {
  const root = join(resolve(input.cwd), "content"), areas = contentAreas(input);
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isSymbolicLink()) unlinkSync(join(root, entry.name));
  for (const area of areas) if (!existsSync(join(root, area.name))) symlinkSync(area.dir, join(root, area.name), process.platform === "win32" ? "junction" : "dir");
}
/** Explicit Pi extensions beside Chrona's, with the tools each adds. */
function optionalExtensions(config: PiLaunchConfig, browser: string | null) {
  return [
    ...(config.web ? [{ extension: config.web, tools: ["web_search", "fetch_content"] }] : []),
    ...(browser && config.browserExtension ? [{ extension: config.browserExtension, tools: ["browser_screenshot"] }] : []),
  ];
}
function piTools(config: PiLaunchConfig, input: ProviderRunInput, optional: ReturnType<typeof optionalExtensions>) {
  return [...new Set(["read", "edit", "write", "grep", "find", "ls", "bash", ...(input.resources === "configured" ? CHRONA_TOOLS : []), ...optional.flatMap(extension => extension.tools), ...(input.resources === "configured" ? config.resources.tools : []), ...(input.extraTools ?? []).filter(name => /^m_[a-z0-9_]{1,62}$/.test(name)),
    // An exact name declares a tool up front; only the pattern keeps deferred module tools behind tool_search (Pi 1.3).
    ...(input.searchTools ? ["tool_search", "m_*"] : [])])].join(",");
}
/** `browser`: the executable this run's browser tool uses (v2-12), or null for no browser tool. */
export function piArguments(config: PiLaunchConfig, input: ProviderRunInput, prompt: string, browser: string | null = null) {
  if (config.options.executionMode === "required-isolation") throw new Error(isolationError);
  const optional = input.resources === "configured" ? optionalExtensions(config, browser) : [];
  const args = ["--mode", "rpc", "--session-dir", resolve(input.sessionDir), "--session-id", input.sessionId ?? randomUUID(),
    "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "-e", config.extension];
  for (const { extension } of optional) args.push("-e", extension);
  // --no-extensions also drops Pi's built-in tool search; deferred module tools need it.
  if (input.searchTools) args.push("-e", "builtin:tool-search");
  if (input.resources === "configured") {
    for (const extension of config.resources.extensions) args.push("-e", extension);
    for (const skill of config.resources.skills) args.push("--skill", skill);
  }
  args.push("--tools", piTools(config, input, optional), "--append-system-prompt", prompt);
  const model = input.model ?? config.options.model;
  if (model) args.push("--model", model);
  return args;
}
/** Detect command resources appended by a wrapper. Not a proof that arbitrary executable code is safe. */
export function expectedPiCommands(config: PiLaunchConfig, commands: unknown): boolean {
  if (!Array.isArray(commands)) return false;
  const base = [config.extension, config.web].filter((path): path is string => path !== null);
  return commands.every(command => command && typeof command === "object" && resourceCommand(config.resources, command.source, command.sourceInfo?.path ?? command.path, base));
}
