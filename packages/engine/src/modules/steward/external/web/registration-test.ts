import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { compileModuleOutput, moduleManifestSchema, moduleRuntimeParams } from "@chrona/contracts/steward";
import { normalizedToolInputSchema, validateToolArgs } from "../../module-tool-contract";
import { createPages, type PageTool } from "./pages";
import webManifest from "./module.json";

type Call = { target: string; args: Record<string, unknown>; result?: unknown; error?: unknown };
type Activated = (event: { kind: "activated"; id: "activated"; firedAt: string; now: string; params: Record<string, string | number | boolean> }) => unknown;
class ModelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ModelError"; }
}

/**
 * Run an app entry's real activated handler against real Web registration and manifest validators.
 * Only the SDK boundary is mocked: no IPC, network, kernel, models or application tool execution.
 * Bundling a private SDK shim avoids Bun mock.module's process-wide import cache. Caller identity
 * and own-tool contracts come from the app manifest, never from registration arguments.
 * Build the portable .mjs in a Chrona checkout with:
 * bun build.ts --registration-test-only /absolute/support-directory
 * Copy that single file beside an ordinary app test and import createRegistrationTest from it.
 * Supported SDK surface: on('activated'), chrona.paths, synchronous chrona.call to web.*, ModelError.
 * This is trusted in-process app code, not a sandbox or proof of kernel activation/browser behavior.
 */
export async function createRegistrationTest(entry: string, options: { manifest?: string; moduleId?: string; hash?: string } = {}) {
  entry = resolve(entry);
  const manifestPath = resolve(options.manifest ?? join(dirname(entry), "module.json"));
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const web = moduleManifestSchema.parse(webManifest);
  const root = await mkdtemp(join(tmpdir(), "chrona-web-registration-"));
  const key = `chrona-registration-test-${randomUUID()}`;
  const caller = { kind: "module", module: manifest.name, moduleId: options.moduleId ?? `${manifest.name}-id`, hash: options.hash ?? "approved-test-version" };
  // Web requests modules.describe with audience:user, excluding module-only callbacks.
  const tools = new Map<string, PageTool>(manifest.tools.filter(tool => tool.visibility.some(audience => audience === "owner" || audience === "provider")).map(tool => [tool.name, { inputSchema: normalizedToolInputSchema(tool), moduleId: caller.moduleId }]));
  const pages = createPages({ dataDir: join(root, "web"), modules: async () => [{ id: caller.moduleId, name: caller.module, activeHash: caller.hash, status: "active" }], tools: async module => module === caller.module ? tools : new Map() });
  const calls: Call[] = [];
  let activated: Activated | undefined;
  const sdk = {
    ModelError,
    on(kind: string, handler: Activated) { if (kind === "activated") activated = handler; },
    chrona: {
      dependencies: { web: "web" },
      paths: { module: dirname(manifestPath), data: join(root, "app"), content: join(root, "content") },
      async call(address: string | { moduleId: string; tool: string }, args: Record<string, unknown> = {}, options?: { mode?: string }) {
        const target = typeof address === "string" ? address : `${address.moduleId}.${address.tool}`;
        const call: Call = { target, args: structuredClone(args) }; calls.push(call);
        try {
          if (options?.mode && options.mode !== "sync") throw new Error("Registration tests support synchronous SDK calls only");
          const tool = target.startsWith("web.") ? web.tools.find(tool => target === `web.${tool.name}`) : undefined;
          if (!tool) throw new Error(`Unmocked registration SDK call: ${target}`);
          let validated: Record<string, unknown>;
          try { validated = validateToolArgs(tool, args); }
          catch (error) { throw new ModelError("invalid", (error as Error).message); }
          let parsed: unknown;
          try {
            const result = await pages.tool(tool.name, validated, caller);
            parsed = compileModuleOutput(tool.output).parse(result);
          } catch (error) {
            // Web's handler currently lets plain registration Errors escape. The SDK sends
            // errorCode only for ModelError, so routed callers receive failed, not invalid.
            throw new ModelError("failed", (error instanceof Error ? error.message : String(error)).slice(0, 2000));
          }
          call.result = structuredClone(parsed);
          return parsed;
        } catch (error) { call.error = error; throw error; }
      },
    },
  };
  async function close() { Reflect.deleteProperty(globalThis, key); await rm(root, { recursive: true, force: true }); }
  try {
    Reflect.set(globalThis, key, sdk);
    await mkdir(sdk.chrona.paths.data, { recursive: true });
    await mkdir(sdk.chrona.paths.content, { recursive: true });
    const build = await Bun.build({ entrypoints: [entry], target: "bun", format: "esm", packages: "bundle", plugins: [{ name: "registration-sdk", setup(build) {
      build.onResolve({ filter: /^chrona$/ }, () => ({ path: "sdk", namespace: "registration-sdk" }));
      build.onLoad({ filter: /.*/, namespace: "registration-sdk" }, () => ({ loader: "js", contents: `
        const sdk = globalThis[${JSON.stringify(key)}];
        export const chrona = sdk.chrona, on = sdk.on, ModelError = sdk.ModelError;
      ` }));
    } }] });
    if (!build.success) throw new AggregateError(build.logs, "Cannot build registration test app");
    const bundled = join(root, "entry.mjs");
    await writeFile(bundled, await build.outputs[0]!.text());
    await import(pathToFileURL(bundled).href);
    if (!manifest.activated || !activated) throw new Error("App must declare and register an activated handler");
    return {
      pages, calls, caller, manifest,
      async activate() {
        const now = new Date().toISOString();
        await activated!({ kind: "activated", id: "activated", firedAt: now, now, params: moduleRuntimeParams(manifest) });
      },
      close,
    };
  } catch (error) { await close(); throw error; }
}
