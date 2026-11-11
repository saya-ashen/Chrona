import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { kernelAgentInputs, kernelAgentOutputs } from "./external/coding/kernel-schema";
import { kernelContractDeclarations } from "./external/coding/build-kernel";

const coding = join(import.meta.dir, "external/coding");
const options: ts.CompilerOptions = {
  strict: true, noEmit: true, skipLibCheck: false, types: [],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
};
function diagnostics(file: string) {
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options)).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

test("Coding kernel declarations type detached consumers without workspace or Zod dependencies", async () => {
  const temp = await mkdtemp("/tmp/chrona-coding-kernel-types-");
  try {
    const declaration = kernelContractDeclarations();
    expect(declaration).toBe(await readFile(join(coding, "kernel-contract.d.ts"), "utf8"));
    expect(kernelContractDeclarations()).toBe(declaration);
    expect(declaration).not.toMatch(/(?:import|from)\s*["']|\bany\b/);
    await writeFile(join(temp, "kernel-contract.d.ts"), declaration);
    const consumer = join(temp, "consumer.ts");
    await writeFile(consumer, `import { kernelAgentInputs as inputs, kernelAgentOutputs as outputs } from "./kernel-contract.js";
const run = inputs.run.parse({ prompt: "hello" });
const defaults: [string[], "foreground" | "background", "conversation" | "completion"] = [run.content, run.lane, run.kind];
const tools: Array<string | { moduleId: string; tool: string }> = run.tools;
run.providerOptions.nested = { values: [null, true, 1, "text", { deeper: [] }] };
// @ts-expect-error JSON cannot contain functions.
run.providerOptions.invalid = () => {};
const readInput = inputs.read.parse({ runId: "r" });
const readDefaults: [number, number, "normalized" | "native"] = [readInput.limit, readInput.waitMs, readInput.view];
const read = outputs.read.parse({});
const sequences: number[] = read.items.map(item => item.sequence);
const statuses: Array<"pending" | "answered" | "cancelled" | "expired" | "interrupted"> = read.interactions.map(item => item.status);
const texts: string[] | undefined = read.transcript?.map(item => {
  if (item.kind === "tool") return item.args;
  return item.text;
});
// @ts-expect-error Transcript variants retain their distinct fields.
read.transcript?.map(item => item.args);
// @ts-expect-error Parsed sequence fields are numbers.
const wrong: string[] = read.items.map(item => item.sequence);
const payload: typeof read.items[number]["payload"] = { list: [false, null, { nested: ["value"] }] };
// @ts-expect-error JSON payloads exclude undefined.
const invalidPayload: typeof payload = { value: undefined };
const write = inputs.write.parse({});
if (write.input.kind === "answer" && write.input.answer.decision === "submit") {
  const value: string | number | boolean = write.input.answer.value;
  void value;
}
const page = outputs.providers.parse({});
const names: string[] = page.items.map(item => item.name);
const accepted: true = outputs.write.parse({}).accepted;
const stopped: boolean = outputs.stop.parse({}).stopConfirmed;
const checked = outputs.read.safeParse({});
if (checked.success) checked.data.items.map(item => item.sequence.toFixed());
else { const message: string = checked.error.message; const paths: PropertyKey[][] = checked.error.issues.map(issue => issue.path); void [message, paths]; }
// @ts-expect-error A failed parse has no data.
if (!checked.success) checked.data;
void [defaults, tools, readDefaults, sequences, statuses, texts, wrong, payload, invalidPayload, names, accepted, stopped];
`);
    expect(diagnostics(consumer)).toEqual([]);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("Every Coding kernel parsed DTO matches the source contract and runtime bundle stays identical", async () => {
  const temp = await mkdtemp("/tmp/chrona-coding-kernel-source-types-");
  try {
    await writeFile(join(temp, "kernel-contract.d.ts"), kernelContractDeclarations());
    const consumer = join(temp, "source-consumer.ts");
    const lines = [
      'import { kernelAgentInputs, kernelAgentOutputs } from "./kernel-contract.js";',
      `import type { kernelAgentInputs as sourceInputs, kernelAgentOutputs as sourceOutputs } from ${JSON.stringify(join(import.meta.dir, "../../../../contracts/src/steward/agent-provider"))};`,
      "type Assert<T extends true> = T;",
      "type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;",
    ];
    for (const [local, source, schemas] of [["kernelAgentInputs", "sourceInputs", kernelAgentInputs], ["kernelAgentOutputs", "sourceOutputs", kernelAgentOutputs]] as const) {
      for (const key of Object.keys(schemas)) lines.push(`type ${local}${key} = Assert<Same<ReturnType<typeof ${local}[${JSON.stringify(key)}]["parse"]>, ReturnType<typeof ${source}[${JSON.stringify(key)}]["parse"]>>>;`);
    }
    await writeFile(consumer, lines.join("\n"));
    expect(diagnostics(consumer)).toEqual([]);
    const result = await Bun.build({ entrypoints: [join(coding, "kernel-schema.ts")], target: "bun", minify: true });
    expect(result.success).toBe(true);
    expect("// Generated by Coding build-kernel.ts.\n" + await result.outputs[0]!.text())
      .toBe(await readFile(join(coding, "kernel-contract.js"), "utf8"));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
