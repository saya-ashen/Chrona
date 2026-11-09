import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildExecutionContracts } from "./execution-contracts";
import { resolveExternalRelease } from "../packages/engine/src/modules/steward/module-release";
import { seedTestModuleRelease } from "../packages/engine/src/modules/steward/module-release-test-fixture";
import ts from "typescript";

test("Coding gets repeatable private contracts in its release hash without changing its command manifest", async () => {
  const temp = await mkdtemp("/tmp/chrona-contract-build-"), root = join(temp, "external");
  try {
    await mkdir(root);
    expect(await buildExecutionContracts(root)).toEqual([]);
    const dir = join(root, "coding"); await mkdir(dir);
    const manifestBytes = JSON.stringify({
      name: "coding", entry: "index.ts", keepAlive: true, effects: [], tests: ["test.ts"],
      tools: [{ name: "command", description: "Shared Coding protocol", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }, visibility: ["owner"], idempotent: true }],
    }, null, 4) + "\n";
    await writeFile(join(dir, "module.json"), manifestBytes);
    await writeFile(join(dir, "index.ts"), "// synthetic package; no product service\n");
    await writeFile(join(dir, "test.ts"), "// synthetic package\n");
    expect(await buildExecutionContracts(root)).toEqual(["coding"]);
    expect(await readFile(join(dir, "module.json"), "utf8")).toBe(manifestBytes);
    const local = await import(pathToFileURL(join(root, "coding/contract.js")).href);
    expect(local.parseCodingToolInput("get", '{"workId":"w"}')).toEqual({ workId: "w" });
    expect(local.EXECUTION_PROTOCOL).toBe("chrona.execution.v1");
    expect(local.WORK_PROTOCOL).toBe("chrona.execution.v2");
    const device = await import(pathToFileURL(join(root, "coding/executor-contract.js")).href);
    expect(device.EXECUTOR_PROTOCOL).toBe("chrona.executor.v1");
    expect(device.EXECUTOR_MODULE_CATALOG).toEqual([]);
    const declaration = await readFile(join(root, "coding/contract.d.ts"), "utf8");
    expect(declaration).not.toMatch(/from ["'](?:zod|@chrona|\.\.\/)/);
    expect(declaration).not.toMatch(/EDITOR_HTTP|editor(?:Request|Response|EventsQuery)Schema|type Editor(?:Request|Response|EventsQuery)\b/);
    const consumer = join(root, "coding/consumer.ts");
    await writeFile(consumer, `import { parseCodingToolInput, executionInputSchemas, executionResponseDataSchemas, type ExecutionCommandConsumer, type ExecutionStart, type ExecutionView, type ExecutionResult, type ExecutionCommand, type ExecutionSnapshot, type ExecutionRef, type ExecutionError, type ExecutionEventPage } from "./contract.js";
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
const query = executionInputSchemas.events.parse({});
const wait: number = query.waitMs;
const op: ExecutionCommand["op"] = "events";
const result: ExecutionResult = executionResponseDataSchemas.results.parse({}).results[0]!;
const view: ExecutionView = executionResponseDataSchemas.start.parse({});
const snapshot: ExecutionSnapshot = executionResponseDataSchemas.snapshot.parse({});
const page: ExecutionEventPage = executionResponseDataSchemas.events.parse({});
const ref: ExecutionRef = view;
const error: ExecutionError = { code: "unavailable", message: "retry", retryable: true };
const consume: ExecutionCommandConsumer["answer"] = async input => { const parsed = executionInputSchemas.answer.parse(input); void parsed; return { accepted: true }; };
// @ts-expect-error Typed answer unions must not admit object values.
const wrong: typeof answer.answer = { decision: "submit", value: {} };
void [start, wait, op, result, snapshot, page, ref, error, consume, wrong];
`);
    const program = ts.createProgram([consumer], { strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const ports = { moduleExternalResources: root };
    await seedTestModuleRelease(root, "coding");
    const first = await resolveExternalRelease(ports, "coding");
    const artifacts = ["contract.js", "contract.d.ts", "executor-contract.js", "executor-contract.d.ts"];
    const firstBytes = await Promise.all(artifacts.map(file => readFile(join(dir, file))));
    expect(await buildExecutionContracts(root)).toEqual(["coding"]);
    expect(await Promise.all(artifacts.map(file => readFile(join(dir, file))))).toEqual(firstBytes);
    expect(await readFile(join(dir, "module.json"), "utf8")).toBe(manifestBytes);
    expect((await resolveExternalRelease(ports, "coding")).hash).toBe(first.hash);
    await writeFile(join(root, "coding/contract.js"), "// changed contract\n");
    await expect(resolveExternalRelease(ports, "coding")).rejects.toMatchObject({ reason: "release_drift" });
    await seedTestModuleRelease(root, "coding");
    expect((await resolveExternalRelease(ports, "coding")).hash).not.toBe(first.hash);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
