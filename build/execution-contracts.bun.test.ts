import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildExecutionContracts } from "./execution-contracts";
import { resolveExternalRelease } from "../packages/engine/src/modules/steward/module-release";
import ts from "typescript";

test("optional packages stay absent; existing packages get repeatable local contract and derived tools included in release hash", async () => {
  const root = await mkdtemp("/tmp/chrona-contract-build-");
  try {
    expect(await buildExecutionContracts(root)).toEqual([]);
    for (const name of ["coding", "editor"]) {
      const dir = join(root, name); await mkdir(dir);
      await writeFile(join(dir, "module.json"), JSON.stringify({ name, entry: "index.ts", keepAlive: true, triggers: [], effects: [], tests: ["test.ts"] }));
      await writeFile(join(dir, "index.ts"), "// synthetic package; no product service\n");
      await writeFile(join(dir, "test.ts"), "// synthetic package\n");
    }
    expect(await buildExecutionContracts(root)).toEqual(["coding", "editor"]);
    const manifest = JSON.parse(await readFile(join(root, "coding/module.json"), "utf8"));
    expect(manifest.tools).toHaveLength(8);
    expect(manifest.tools.find((tool: { name: string }) => tool.name === "accept").visibility).toEqual(["owner"]);
    expect(manifest.tools.filter((tool: { name: string }) => tool.name !== "accept").every((tool: { visibility: string[] }) => tool.visibility.includes("provider"))).toBe(true);
    const local = await import(pathToFileURL(join(root, "coding/contract.js")).href);
    expect(local.parseCodingToolInput("get", '{"workId":"w"}')).toEqual({ workId: "w" });
    expect(local.EXECUTION_PROTOCOL).toBe("chrona.execution.v1");
    expect(local.WORK_PROTOCOL).toBe("chrona.execution.v2");
    const device = await import(pathToFileURL(join(root, "coding/executor-contract.js")).href);
    expect(device.EXECUTOR_PROTOCOL).toBe("chrona.executor.v1");
    expect(device.EXECUTOR_MODULE_CATALOG).toEqual([]);
    const declaration = await readFile(join(root, "coding/contract.d.ts"), "utf8");
    expect(declaration).not.toMatch(/from ["'](?:zod|@chrona|\.\.\/)/);
    const consumer = join(root, "coding/consumer.ts");
    await writeFile(consumer, `import { parseCodingToolInput, executionInputSchemas, editorResponseDataSchemas, editorEventsQuerySchema, type EditorCommandConsumer, type ExecutionStart, type ExecutionView, type ExecutionResult, type ExecutionCommand, type ExecutionSnapshot, type ExecutionRef, type ExecutionError, type ExecutionEventPage } from "./contract.js";
import { workRequestSchema, workResponseDataSchemas, type WorkRequest, type WorkCommandConsumer } from "./contract.js";
import { executorRequestSchemas, type ExecutorAssignment, type ExecutorFinal } from "./executor-contract.js";
const request: WorkRequest = workRequestSchema.parse({});
const consumeWork: WorkCommandConsumer["start"] = async () => workResponseDataSchemas.start.parse({});
const poll = executorRequestSchemas.poll.parse({});
const assignment: ExecutorAssignment = {} as ExecutorAssignment;
const final: ExecutorFinal = {} as ExecutorFinal;
void [request, consumeWork, poll, assignment, final];
const start: ExecutionStart = parseCodingToolInput("create", "{}");
const answer = parseCodingToolInput("answer", "{}");
if (answer.answer.decision === "submit") { const value: string | number | boolean = answer.answer.value; void value; }
const query = editorEventsQuerySchema.parse({});
const wait: number = query.waitMs;
const op: ExecutionCommand["op"] = "events";
const result: ExecutionResult = editorResponseDataSchemas.results.parse({}).results[0]!;
const view: ExecutionView = editorResponseDataSchemas.start.parse({});
const snapshot: ExecutionSnapshot = editorResponseDataSchemas.snapshot.parse({});
const page: ExecutionEventPage = editorResponseDataSchemas.events.parse({});
const ref: ExecutionRef = view;
const error: ExecutionError = { code: "unavailable", message: "retry", retryable: true };
const consume: EditorCommandConsumer["answer"] = async input => { const parsed = executionInputSchemas.answer.parse(input); void parsed; return { accepted: true }; };
// @ts-expect-error Typed answer unions must not admit object values.
const wrong: typeof answer.answer = { decision: "submit", value: {} };
void [start, wait, op, result, snapshot, page, ref, error, consume, wrong];
`);
    const program = ts.createProgram([consumer], { strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const ports = { moduleExternalResources: root };
    const first = await resolveExternalRelease(ports, "coding");
    await buildExecutionContracts(root);
    expect((await resolveExternalRelease(ports, "coding")).hash).toBe(first.hash);
    await writeFile(join(root, "coding/contract.js"), "// changed contract\n");
    expect((await resolveExternalRelease(ports, "coding")).hash).not.toBe(first.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});
