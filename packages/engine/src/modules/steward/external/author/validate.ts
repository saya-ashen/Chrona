import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { relative, submitDir, type Validate } from "./contracts";
import type { MaterialFile, SourceFiles } from "./files";

export type Check = { name: string; ok: boolean; detail?: string };
type Tests = { ran: boolean; ok: boolean | null; exitCode: number | null; output: string; reason: string | null };
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const script = /^[A-Za-z0-9_-]+\.(ts|py|sh)$/;
const slug = /^[a-z][a-z0-9-]{1,40}$/;
const suite = /(?:^|\/)[^/]+(?:\.test|_test|\.spec|_spec)\.[jt]sx?$/;
const skipped = (reason: string): Tests => ({ ran: false, ok: null, exitCode: null, output: "", reason });

/** A deliberately small local contract, also used on the exact snapshot being staged.
 * Frozen install, recursive tool schemas, SDK execution and activation remain kernel checks. */
export function checkMaterial(material: MaterialFile[], expectedName?: string): { checks: Check[]; declaredTests: string[] } {
  const checks: Check[] = [], indexed = new Map(material.map(file => [file.path, file]));
  const check = (name: string, action: () => void) => {
    try { action(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, detail: message(error) }); }
  };
  function json(file: string): Record<string, unknown> {
    const item = indexed.get(file);
    if (!item) throw new Error(`Missing ${file}.`);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(item.bytes));
    if (!isObject(value)) throw new Error(`${file} must be a JSON object.`);
    return value;
  }
  let declaredTests: string[] = [];
  check("module.json", () => {
    const manifest = json("module.json");
    if (typeof manifest.name !== "string" || !slug.test(manifest.name) || ["agent", "approvals", "modules", "settings", "secrets", "activity", "timers"].includes(manifest.name)) throw new Error("Invalid or reserved module name.");
    if (expectedName !== undefined && manifest.name !== expectedName) throw new Error("Package manifest name does not match the selected target.");
    if ("run" in manifest || "pages" in manifest) throw new Error("Use entry instead of run; register pages through web.page-set in the activated handler.");
    const declared = manifest.entry;
    const entry = relative(isObject(declared) ? declared.path : declared);
    const file = indexed.get(entry);
    if (!file) throw new Error("Module entry must be a file inside the workspace.");
    if (typeof declared === "string") {
      if (!script.test(declared)) throw new Error("String entry must be a root .ts/.py/.sh script; use {path,runtime?,args?} for other entries.");
    } else if (isObject(declared)) {
      if (Object.keys(declared).some(key => !["path", "args", "runtime"].includes(key)) || entry.length > 1024) throw new Error("Invalid entry object.");
      if (declared.args !== undefined && (!Array.isArray(declared.args) || declared.args.length > 32 || declared.args.some(arg => typeof arg !== "string" || arg.length > 2048 || arg.includes("\0")))) throw new Error("Entry args must be at most 32 literal strings, each at most 2048 characters.");
      if (declared.runtime !== undefined && (typeof declared.runtime !== "string" || declared.runtime.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(declared.runtime))) throw new Error("Invalid entry runtime.");
      if (declared.runtime === undefined && !file.executable) throw new Error("Native entry must be executable; import it as an executable artifact or declare a runtime.");
    }
    if (!Array.isArray(manifest.effects) || manifest.effects.some(effect => effect !== "network") || new Set(manifest.effects).size !== manifest.effects.length) throw new Error("effects must be an array of unique supported effects (network), or [].");
    const tools = manifest.tools ?? [];
    if (!Array.isArray(tools) || tools.length > 30) throw new Error("tools must be an array of at most 30 tools.");
    if (!tools.length && manifest.keepAlive !== true) throw new Error("A module needs a tool or keepAlive: true.");
    const seen = new Set<string>();
    for (const tool of tools) {
      if (!isObject(tool) || typeof tool.name !== "string" || !slug.test(tool.name) || seen.has(tool.name)) throw new Error("Tools require unique valid names.");
      seen.add(tool.name);
      if (typeof tool.description !== "string" || !tool.description.length || tool.description.length > 500) throw new Error(`Tool ${tool.name} needs a description (1..500 characters).`);
      if (!isObject(tool.output)) throw new Error(`Tool ${tool.name} needs an output schema object.`);
      const params = tool.parameters;
      if (!isObject(params) || params.type !== "object" || Object.keys(params).some(key => !["type", "properties", "required"].includes(key)) || (params.properties !== undefined && !isObject(params.properties)) || (params.required !== undefined && (!Array.isArray(params.required) || params.required.some(key => typeof key !== "string")))) throw new Error(`Tool ${tool.name} parameters need type: object, properties and required; additionalProperties is not supported here.`);
      if (tool.visibility !== undefined && (!Array.isArray(tool.visibility) || !tool.visibility.length || new Set(tool.visibility).size !== tool.visibility.length || tool.visibility.some(value => !["provider", "owner", "modules", "kernel"].includes(value)))) throw new Error(`Tool ${tool.name} has invalid visibility.`);
    }
    // No-test material is locally valid. The kernel's current tests minimum is a separate submission prerequisite.
    if (manifest.tests !== undefined) {
      if (!Array.isArray(manifest.tests) || manifest.tests.length > 10 || manifest.tests.some(test => typeof test !== "string" || !script.test(test) || !indexed.has(test))) throw new Error("tests must name up to ten existing root .ts/.py/.sh scripts.");
      declaredTests = manifest.tests as string[];
    }
  });
  check("dependencies", () => {
    if (indexed.has("package.json")) {
      const pkg = json("package.json");
      for (const key of ["dependencies", "devDependencies"]) if (pkg[key] !== undefined && !isObject(pkg[key])) throw new Error(`${key} must be an object.`);
      if (!indexed.has("bun.lock")) throw new Error("package.json requires bun.lock in the workspace (including empty packages).");
    }
    if (indexed.has("pyproject.toml") && !indexed.has("uv.lock")) throw new Error("pyproject.toml requires uv.lock in the workspace.");
  });
  return { checks, declaredTests };
}

async function runTests(material: MaterialFile[], commands: string[][]): Promise<Tests> {
  let output = Buffer.alloc(0), started = false;
  let workspace: string | undefined;
  const append = (value: Uint8Array) => { output = Buffer.concat([output, Buffer.from(value).subarray(0, Math.max(0, 8192 - output.length))]); };
  // Decoding malformed bytes can expand them; bound the final UTF-8 result, including diagnostics.
  const text = (prefix = "") => Buffer.from(prefix + output.toString("utf8")).subarray(0, 8192).toString("utf8").replace(/\uFFFD$/, "");
  const deadline = Date.now() + 30_000;
  try {
    // Execute the checked bytes without letting test outputs rewrite source or staged provenance.
    workspace = await mkdtemp(join(tmpdir(), "author-tests-"));
    for (const file of material) {
      const target = join(workspace, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { mode: file.executable ? 0o700 : 0o600 });
    }
    for (const command of commands) {
      const child = spawn(command[0]!, command.slice(1), { cwd: workspace, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      started ||= child.pid !== undefined;
      const state = { timedOut: false };
      const stop = () => {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error(JSON.stringify({ component: "author", event: "test-stop-failed", error: message(error) }));
        }
      };
      const timer = setTimeout(() => {
        state.timedOut = true;
        stop();
        // Even a descendant that starts its own session cannot retain these pipes past the deadline.
        child.stdout.destroy(); child.stderr.destroy();
      }, Math.max(1, deadline - Date.now()));
      child.stdout.on("data", append); child.stderr.on("data", append);
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", code => resolve(code));
      });
      const drained = Promise.all([child.stdout, child.stderr].map(stream => new Promise<void>(resolve => stream.once("close", resolve))));
      try {
        const [exitCode] = await Promise.all([exited, drained]);
        if (state.timedOut || exitCode !== 0) {
          return {
            ran: started, ok: false, exitCode,
            output: text(state.timedOut ? "Test timeout after 30s.\n" : ""),
            reason: state.timedOut ? "timeout" : "failed",
          };
        }
      } finally { clearTimeout(timer); stop(); }
    }
    return { ran: true, ok: true, exitCode: 0, output: text(), reason: null };
  } catch (error) {
    append(Buffer.from(message(error)));
    return { ran: started, ok: false, exitCode: null, output: text(), reason: "runner_error" };
  } finally {
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  }
}

/** Local execution uses the host runtimes, without the kernel SDK harness or frozen installation. */
export async function validateWorkspace(files: SourceFiles, input: Validate): Promise<{ ok: boolean; path: string; checks: Check[]; tests: Tests }> {
  const path = submitDir(input.path);
  let material: MaterialFile[];
  try {
    material = await files.snapshot(path);
  } catch (error) {
    return { ok: false, path, checks: [{ name: "workspace", ok: false, detail: message(error) }], tests: skipped("checks_failed") };
  }
  const { checks, declaredTests } = checkMaterial(material);
  checks.unshift({ name: "workspace", ok: true });
  // Explicit Bun suite paths avoid discovery from unrelated or unselected workspace files.
  const suites = material.filter(file => suite.test(file.path) && !declaredTests.includes(file.path)).map(file => `./${file.path}`);
  const commands = declaredTests.map(path => path.endsWith(".ts") ? [process.execPath, "--no-install", "run", `./${path}`] : [path.endsWith(".py") ? "python3" : "sh", `./${path}`]);
  if (suites.length) commands.push([process.execPath, "--no-install", "test", ...suites]);
  const tests = input.runTests === false ? skipped("not_requested") : checks.some(check => !check.ok) ? skipped("checks_failed") : !commands.length ? skipped("no_tests") : await runTests(material, commands);
  if (tests.ok === false) checks.push({ name: "tests", ok: false, detail: "Local snapshot tests failed; see tests.output. No dependencies are installed. For dependency/SDK tests, retain external workspace or kernel evidence and use runTests:false." });
  return { ok: checks.every(check => check.ok), path, checks, tests };
}
