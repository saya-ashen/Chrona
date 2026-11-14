import { relative, sourceDir, type Validate } from "./contracts";
import type { SourceFiles } from "./files";

type Check = { name: string; ok: boolean; detail?: string };
type Tests = { ran: boolean; ok: boolean; exitCode: number; output: string };
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function runTests(workspace: string): Promise<Tests> {
  try {
    const child = Bun.spawn([process.execPath, "test"], { cwd: workspace, stdout: "pipe", stderr: "pipe" });
    let output = Buffer.alloc(0), timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
    // Drain both pipes even after the result limit, so noisy tests cannot block.
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const remaining = 8192 - output.length;
          if (remaining > 0) output = Buffer.concat([output, Buffer.from(value).subarray(0, remaining)]);
        }
      } finally { reader.releaseLock(); }
    };
    try {
      const [exitCode] = await Promise.all([child.exited, drain(child.stdout), drain(child.stderr)]);
      const text = output.toString("utf8");
      return { ran: true, ok: !timedOut && exitCode === 0, exitCode, output: Buffer.from(timedOut ? `Test timeout after 30s.\n${text}` : text).subarray(0, 8192).toString("utf8").replace(/\uFFFD$/, "") };
    } finally { clearTimeout(timer); }
  } catch (error) {
    return { ran: true, ok: false, exitCode: -1, output: Buffer.from(message(error)).subarray(0, 8192).toString("utf8").replace(/\uFFFD$/, "") };
  }
}

/** Local material checks only; kernel submission and product acceptance remain separate. */
export async function validateWorkspace(files: SourceFiles, input: Validate): Promise<{ ok: boolean; path: string; checks: Check[]; tests?: Tests }> {
  const path = sourceDir(input.path), checks: Check[] = [];
  const check = (name: string, action: () => void) => {
    try { action(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, detail: message(error) }); }
  };
  let workspace: string, material: Awaited<ReturnType<SourceFiles["snapshot"]>>;
  try {
    workspace = await files.workspacePath(path);
    // Snapshot traversal rejects links/special files and bounds entries, files,
    // individual sizes and total bytes before allocating or running any tests.
    material = await files.snapshot(path);
    checks.push({ name: "workspace", ok: true });
  } catch (error) {
    return { ok: false, path, checks: [{ name: "workspace", ok: false, detail: message(error) }] };
  }
  const indexed = new Map(material.map(file => [file.path, file.bytes]));
  function json(file: string): Record<string, unknown> {
    const bytes = indexed.get(file);
    if (!bytes) throw new Error(`Missing ${file}.`);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isObject(value)) throw new Error(`${file} must be a JSON object.`);
    return value;
  }
  check("module.json", () => {
    const manifest = json("module.json");
    if (typeof manifest.name !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(manifest.name)) throw new Error("Invalid module name.");
    const declared = manifest.entry ?? manifest.run;
    const entry = relative(isObject(declared) ? declared.path : declared);
    if (!indexed.has(entry)) throw new Error("Module entry/run must be a file inside the workspace.");
    for (const [key, identity] of [["tools", "name"], ["pages", "id"]] as const) {
      const rows = manifest[key];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) throw new Error(`${key} must be an array.`);
      const seen = new Set<string>();
      for (const row of rows) {
        if (!isObject(row) || typeof row[identity] !== "string" || !row[identity].trim() || seen.has(row[identity])) throw new Error(`${key} require unique ${identity}s.`);
        seen.add(row[identity]);
        if (key === "tools" && !isObject(row.parameters)) throw new Error("Tool parameters must be an object.");
        if (key === "pages" && row.layout !== undefined && !["document", "workspace"].includes(row.layout as string)) throw new Error("Page layout must be document or workspace.");
      }
    }
  });
  check("dependencies", () => {
    if (!indexed.has("package.json")) return;
    const pkg = json("package.json");
    for (const key of ["dependencies", "devDependencies"]) {
      const dependencies = pkg[key];
      if (dependencies === undefined) continue;
      if (!isObject(dependencies)) throw new Error(`${key} must be an object.`);
      if (Object.keys(dependencies).length && !indexed.has("bun.lock")) throw new Error("Dependencies require bun.lock in the workspace.");
    }
  });
  const hasTests = material.some(file => /\.test\.ts$/.test(file.path));
  let tests: Tests | undefined;
  if (input.runTests !== false && hasTests && checks.every(check => check.ok)) {
    tests = await runTests(workspace);
    checks.push({ name: "tests", ok: tests.ok, ...(!tests.ok ? { detail: "bun test failed; see tests.output." } : {}) });
  } else {
    tests = { ran: false, ok: true, exitCode: 0, output: "" };
  }
  return { ok: checks.every(check => check.ok), path, checks, tests };
}
