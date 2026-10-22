import { expect, test } from "bun:test";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { KeyProbe, ModuleContext } from "./module-context";
import { keyProbePreview, probeKeys, smokeRun } from "./module-probe";

const schedule = { id: "daily", schedule: { kind: "daily" as const, time: "09:00" } };
const manifest = (triggers: ModuleManifest["triggers"]): ModuleManifest => ({ name: "reminder", entry: "index.ts", triggers, tools: [], keepAlive: false, effects: ["notify_user"], tests: ["test.ts"], params: {}, data: { schema: 1 } });
const notify = (key: string) => ({ type: "notify_user", key, level: "now", title: "t", body: "b" });
function context(keyFor: (firedAt: string) => string[] | null, inputs: unknown[] = []) {
  return { ports: { now: () => new Date("2026-10-21T01:00:00Z"), sandbox: { available: true, async runModule(input: { input: { trigger: { firedAt: string } } }) {
    inputs.push(input);
    const keys = keyFor(input.input.trigger.firedAt);
    return keys ? { status: "succeeded", exitCode: 0, error: null, output: JSON.stringify({ effects: keys.map(notify) }) } : { status: "failed", exitCode: 1, error: "boom", output: "" };
  } } } } as unknown as ModuleContext;
}
test.each<[string, (at: string) => string[] | null, KeyProbe]>([
  ["constant key", () => ["sent"], { status: "repeated", keys: ["notify_user:sent"] }],
  ["date key", (at: string) => [`sent:${at.slice(0, 10)}`], { status: "passed" }],
  ["no effects", () => [], { status: "skipped", reason: "no effects on both fires" }],
  ["entry failure", () => null, { status: "skipped", reason: "entry failed or invalid output" }],
])("schedule probe: %s", async (_name, keyFor, expected) => {
  const inputs: unknown[] = [];
  expect(await probeKeys(context(keyFor, inputs), "/staging", manifest([schedule]))).toEqual(expected);
  if (expected.status !== "skipped" || keyFor("") !== null) expect(inputs).toMatchObject([{ network: false, input: { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-21T01:00:00.000Z" } } }, { input: { trigger: { firedAt: "2026-10-22T01:00:00.000Z" } } }]);
});
test("modules without schedule triggers are not probed", async () => {
  const inputs: unknown[] = [];
  expect(await probeKeys(context(() => ["x"], inputs), "/staging", manifest([{ id: "mail", inbound: { connector: "c", match: {} } }]))).toEqual({ status: "skipped", reason: "no schedule trigger" });
  expect(inputs).toEqual([]);
});
test("review card warns about repeated keys and stays quiet without a verdict", () => {
  expect(keyProbePreview({ status: "repeated", keys: ["notify_user:sent"] })).toContain("⚠ 幂等键检查");
  expect(keyProbePreview({ status: "passed" })).toBe("幂等键检查：passed\n");
  expect(keyProbePreview(undefined)).toBe("");
});
function smokeContext(result: { status: string; exitCode: number; output: string; error: string | null }, inputs: unknown[]) {
  return { ports: { now: () => new Date("2026-10-21T01:00:00Z"), sandbox: { available: true, async runModule(input: unknown) { inputs.push(input); return result; } } } } as unknown as ModuleContext;
}
const inbound = { id: "mail", inbound: { connector: "c", match: {} } };
test.each([
  ["valid output", { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null }, []],
  ["crash", { status: "failed", exitCode: 1, output: "", error: "Traceback: boom" }, ["smoke schedule daily: exit 1: Traceback: boom", "smoke inbound mail: exit 1: Traceback: boom"]],
  ["invalid output", { status: "succeeded", exitCode: 0, output: "ok", error: null }, ["smoke schedule daily: stdout is not valid module output: ok", "smoke inbound mail: stdout is not valid module output: ok"]],
] as const)("smoke run of schedule and inbound entries: %s", async (_name, result, errors) => {
  const inputs: unknown[] = [];
  expect(await smokeRun(smokeContext(result, inputs), "/staging", manifest([schedule, inbound]))).toEqual([...errors]);
  expect(inputs).toMatchObject([
    { network: false, input: { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-21T01:00:00.000Z" } } },
    { network: false, input: { trigger: { id: "mail", kind: "inbound", item: { externalId: "smoke", from: "smoke@chrona.invalid" } } } },
  ]);
});
