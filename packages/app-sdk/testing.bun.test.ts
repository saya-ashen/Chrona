import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startModule } from "./testing";
import type { CallState } from "./sdk";

test("testing preserves the original async receipt by key and ID, including delivered unknown results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chrona-testing-receipts-"));
  const previousModule = process.env.CHRONA_MODULE;
  let module: Awaited<ReturnType<typeof startModule>> | undefined;
  try {
    await mkdir(join(directory, "node_modules"));
    await cp(import.meta.dirname, join(directory, "node_modules", "chrona"), { recursive: true });
    await writeFile(join(directory, "module.json"), JSON.stringify({ name: "consumer", entry: "index.ts", effects: [], uses: ["fixture.echo"] }));
    await writeFile(join(directory, "index.ts"), `import { chrona, on } from "chrona";
on("tool", async event => ({ result: event.args.action === "status"
  ? await chrona.callStatus(event.args.selector)
  : await chrona.call("fixture.echo", {}, { mode: "async", key: event.args.key }) }));
`);
    process.env.CHRONA_MODULE = directory;
    module = await startModule(join(directory, "index.ts"));
    const send = async (args: Record<string, unknown>) => module!.send({ trigger: { kind: "tool", id: "exercise", firedAt: new Date().toISOString(), args }, now: new Date().toISOString(), params: {} });
    const first = (await send({ key: "original" })).result!.result as CallState;
    expect({ ...first }).toMatchObject({ callId: expect.any(String), status: "queued", duplicate: false });
    expect((await send({ key: "original" })).result!.result).toEqual({ ...first, duplicate: true });
    for (const selector of [first.callId, { callId: first.callId }, { target: { moduleId: "fixture", tool: "echo" }, key: "original" }]) {
      const response = await send({ action: "status", selector });
      expect(response.error).toBeUndefined();
      expect(response.result!.result).toEqual({ callId: first.callId, status: "queued" });
    }
    const other = (await send({ key: "other" })).result!.result as CallState;
    expect(other.callId).not.toBe(first.callId);
    for (const status of ["succeeded", "failed", "unknown"] as const) {
      await module.send({ trigger: { kind: "call_result", id: "call", firedAt: new Date().toISOString(), callId: first.callId, target: { moduleId: "fixture", tool: "echo" }, key: "original", status, ...(status === "succeeded" ? { output: { saved: true } } : { error: "fixture outcome" }) }, now: new Date().toISOString(), params: {} });
      const receipt = (await send({ action: "status", selector: { target: "fixture.echo", key: "original" } })).result!.result;
      expect(receipt).toEqual({ callId: first.callId, status, ...(status === "succeeded" ? { output: { saved: true } } : { error: "fixture outcome" }) });
      expect((await send({ key: "original" })).result!.result).toEqual({ ...receipt as CallState, duplicate: true });
    }
    expect(await send({ action: "status", selector: "missing" })).toMatchObject({ errorCode: "not_found" });
    expect((await send({ action: "status", selector: other.callId })).result!.result).toEqual({ callId: other.callId, status: "queued" });
  } finally {
    try { await module?.stop(); }
    finally {
      if (previousModule === undefined) delete process.env.CHRONA_MODULE;
      else process.env.CHRONA_MODULE = previousModule;
      await rm(directory, { recursive: true, force: true });
    }
  }
});
