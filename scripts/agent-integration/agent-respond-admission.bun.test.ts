import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderInteraction } from "@chrona/contracts/steward";
import { liveRuns } from "../../packages/engine/src/modules/steward/runs";
import { registeredRunFixture, eventually } from "./registered-run.fixtures";

async function fixture() {
  let question: ProviderInteraction | undefined, answers = 0;
  const f = await registeredRunFixture("acceptance-question", async request => {
    if (request.status === "pending") question = request;
    if (request.status === "answered") answers++;
  });
  try {
    const { run } = await f.launch();
    const request = await eventually(async () => question, value => !!value);
    if (!request) throw new Error("Fake Pi did not publish its actual RPC question");
    const input = { runId: run.id, input: { kind: "answer", questionId: request.id, answer: { decision: "submit", value: true } } };
    const commands = async () => (await readFile(join(run.cwd, "commands.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    return { ...f, run, request, input, answers: () => answers, commands,
      respond: () => f.call("write", input, "answer"),
      receipts: () => f.ports.db.agentCommand.count({ where: { operation: "respond" } }),
      expire: () => { f.ports.now = () => new Date(Date.parse(request.expiresAt) + 1); } };
  } catch (error) { await f.close(); throw error; }
}

test("expired actual Pi question rejects before admission without consuming its key", async () => {
  const f = await fixture();
  try {
    f.expire();
    await expect(f.respond()).rejects.toMatchObject({ code: "conflict" });
    expect(await f.receipts()).toBe(0);
    expect(f.answers()).toBe(0);
    expect((await f.commands()).some(command => command.type === "extension_ui_response")).toBe(false);
  } finally { await f.close(); }
}, 30000);

test("lost accepted response replays after expiry without answering the fake process twice", async () => {
  const f = await fixture();
  try {
    // Discard the first reply as a transport client would after losing its response.
    await f.respond();
    await eventually(f.commands, commands => commands.some(command => command.type === "extension_ui_response"));
    expect(f.answers()).toBe(1);
    f.expire();
    await f.ports.db.run.update({ where: { id: f.run.id }, data: { status: "timed_out" } });
    liveRuns.delete(f.run.id);
    expect(await f.respond()).toEqual({ accepted: true });
    expect(await f.receipts()).toBe(1);
    expect((await f.commands()).filter(command => command.type === "extension_ui_response")).toEqual([expect.objectContaining({ id: "backend-question", confirmed: true })]);
    expect(f.answers()).toBe(1);
  } finally { await f.close(); }
}, 30000);

test("answer delivery failure preserves an unsettled receipt and never replays the side effect", async () => {
  const f = await fixture();
  try {
    await f.ports.db.$executeRawUnsafe("CREATE TRIGGER fail_answer_delivery BEFORE UPDATE OF status ON RunInteraction WHEN NEW.status != 'pending' BEGIN SELECT RAISE(ABORT, 'Synthetic delivery failure'); END");
    await expect(f.respond()).rejects.toThrow();
    expect(await f.receipts()).toBe(1);
    expect(await f.ports.db.agentCommand.findFirst({ where: { operation: "respond" } })).toMatchObject({ settled: false });
    f.expire();
    await expect(f.respond()).rejects.toMatchObject({ code: "unknown" });
    expect(f.answers()).toBe(0);
  } finally {
    await f.ports.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_answer_delivery");
    await f.close();
  }
}, 30000);

test("stop after durable answer admission remains unknown on replay", async () => {
  const f = await fixture();
  try {
    await f.ports.db.$executeRawUnsafe("CREATE TRIGGER stop_after_admission AFTER INSERT ON AgentCommand WHEN NEW.operation = 'respond' BEGIN UPDATE Run SET status = 'failed' WHERE id = '" + f.run.id.replaceAll("'", "''") + "'; END");
    await expect(f.respond()).rejects.toMatchObject({ code: "conflict" });
    expect(await f.receipts()).toBe(1);
    await expect(f.respond()).rejects.toMatchObject({ code: "unknown" });
    expect(f.answers()).toBe(0);
  } finally {
    await f.ports.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS stop_after_admission");
    await f.close();
  }
}, 30000);

test("admission storage failure rolls back the answer key and leaves the question answerable", async () => {
  const f = await fixture();
  try {
    await f.ports.db.$executeRawUnsafe("CREATE TRIGGER fail_answer_admission BEFORE INSERT ON AgentCommand WHEN NEW.operation = 'respond' BEGIN SELECT RAISE(ABORT, 'Synthetic admission storage failure'); END");
    await expect(f.respond()).rejects.toThrow();
    expect(await f.receipts()).toBe(0);
    expect(f.answers()).toBe(0);
    await f.ports.db.$executeRawUnsafe("DROP TRIGGER fail_answer_admission");
    expect(await f.respond()).toEqual({ accepted: true });
    expect(f.answers()).toBe(1);
  } finally {
    await f.ports.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_answer_admission");
    await f.close();
  }
}, 30000);

test("invalid typed answer is rejected before consuming the command", async () => {
  const f = await fixture();
  try {
    await expect(f.call("write", { ...f.input, input: { ...f.input.input, answer: { decision: "submit", value: "invalid confirm" } } }, "answer")).rejects.toMatchObject({ code: "invalid" });
    expect(await f.receipts()).toBe(0);
    expect(f.answers()).toBe(0);
  } finally { await f.close(); }
}, 30000);
