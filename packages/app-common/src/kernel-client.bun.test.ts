import { expect, test } from "bun:test";
import { readItems } from "./pagination";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("explicit directory traversal follows pages without changing ordinary page semantics", async () => {
  const calls: Record<string, unknown>[] = [];
  const items = await readItems<number>(async (_target, args) => {
    calls.push(args);
    return args.cursor ? { items: [2], nextCursor: null } : { items: [1], nextCursor: "next" };
  }, "modules.list", { limit: 1 });
  expect(items).toEqual([1, 2]);
  expect(calls).toEqual([{ limit: 1 }, { limit: 1, cursor: "next" }]);
  await expect(readItems(async () => ({ items: [], nextCursor: "same" }), "modules.list")).rejects.toThrow("cursor did not advance");
});

test("application adapter preserves one page, explicit keys and discovered tool identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chrona-call-adapter-"));
  try {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, "kernel-client.ts")], outdir: directory, target: "bun",
      plugins: [{ name: "offline-sdk", setup(builder) {
        builder.onResolve({ filter: /^chrona$/ }, () => ({ path: "chrona", namespace: "offline-sdk" }));
        builder.onLoad({ filter: /.*/, namespace: "offline-sdk" }, () => ({ loader: "js", contents: `
          export class ModelError extends Error {
            constructor(code, message) { super(message); this.code = code; }
          }
          export const chrona = {
            dependencies: { example: "old-id" },
            async call(target, args, options) {
              return { target, args, options, items: [1], nextCursor: "more" };
            }
          };
        ` }));
      } }],
    });
    if (!result.success) throw new AggregateError(result.logs, "Adapter test build failed");
    const { applicationCall } = await import(result.outputs[0]!.path) as typeof import("./kernel-client");
    const page = await applicationCall<{ items: number[]; nextCursor: string }>("modules.list", { limit: 1 });
    expect(page.items).toEqual([1]);
    expect(page.nextCursor).toBe("more");
    const target = { moduleId: "discovered-id", tool: "read" };
    expect(await applicationCall(target, { requestKey: "business-key" }, { key: "explicit-key" })).toMatchObject({
      target, args: { requestKey: "business-key" }, options: { key: "explicit-key" },
    });
    expect(await applicationCall("modules.submit", { admissionId: "admission" }, { key: "submission-key" })).toMatchObject({
      target: "modules.submit", args: { admissionId: "admission" }, options: { key: "submission-key" },
    });
    for (const alias of ["requestKey", "request-key", "commandKey", "command-key"]) {
      await expect(applicationCall("modules.submit", { [alias]: "conflict" }, { key: "explicit" })).rejects.toMatchObject({ code: "invalid" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
