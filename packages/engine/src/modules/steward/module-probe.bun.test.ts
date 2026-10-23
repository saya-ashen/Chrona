import { expect, test } from "bun:test";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { KeyProbe, ModuleContext } from "./module-context";
import { keyProbePreview, probeKeys, smokeRun } from "./module-probe";
import { testModuleProcess } from "./module-test-process";

const schedule = { id: "daily", schedule: { kind: "daily" as const, time: "09:00" } };
const manifest = (triggers: ModuleManifest["triggers"]): ModuleManifest => ({ name: "reminder", entry: "index.ts", triggers, tools: [], keepAlive: false, effects: ["notify_user"], tests: ["test.ts"], params: {}, data: { schema: 1 } });
function context(keyFor: (firedAt: string) => string[] | null, inputs: unknown[] = []) {
  const peer = testModuleProcess(async (event, call) => {
    inputs.push(event);
    const keys = keyFor(event.trigger.firedAt);
    if (!keys) throw new Error("boom");
    for (const key of keys) await call("notify", { key, level: "now", title: "t", body: "b" });
    return {};
  });
  return { ports: { now: () => new Date("2026-10-21T01:00:00Z"), sandbox: { available: true, startModule: peer.startModule } } } as unknown as ModuleContext;
}
test.each<[string, (at: string) => string[] | null, KeyProbe]>([
  ["constant key", () => ["sent"], { status: "repeated", keys: ["notify_user:sent"] }],
  ["date key", at => [`sent:${at.slice(0, 10)}`], { status: "passed" }],
  ["no effects", () => [], { status: "skipped", reason: "no effects on both fires" }],
  ["entry failure", () => null, { status: "skipped", reason: "entry failed or invalid output" }],
])("schedule probe: %s", async (_name, keyFor, expected) => {
  const inputs: unknown[] = [];
  expect(await probeKeys(context(keyFor, inputs), "/staging", manifest([schedule]))).toEqual(expected);
  if (expected.status !== "skipped" || keyFor("") !== null) expect(inputs).toMatchObject([
    { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-21T01:00:00.000Z" } },
    { trigger: { firedAt: "2026-10-22T01:00:00.000Z" } },
  ]);
});
test("modules without schedule triggers are not probed", async () => {
  expect(await probeKeys(context(() => ["x"]), "/staging", manifest([]))).toEqual({ status: "skipped", reason: "no schedule trigger" });
});
test("review card keeps the key-probe shape", () => {
  expect(keyProbePreview({ status: "repeated", keys: ["notify_user:sent"] })).toContain("⚠ 幂等键检查");
  expect(keyProbePreview({ status: "passed" })).toBe("幂等键检查：passed\n");
  expect(keyProbePreview(undefined)).toBe("");
});
test.each([false, true])("smoke sends every trigger and tool; failure=%s", async failed => {
  const inputs: unknown[] = [], m = manifest([schedule, { ...schedule, id: "second" }, { id: "mail", inbound: { connector: "c", match: {} } }]);
  m.tools = [{ name: "lookup", description: "Lookup", parameters: { type: "object", properties: {}, required: [] } }];
  const errors = await smokeRun(context(() => failed ? null : [], inputs), "/staging", m);
  expect(errors).toHaveLength(failed ? 4 : 0);
  expect(inputs).toMatchObject([
    { trigger: { kind: "schedule", id: "daily" } }, { trigger: { kind: "schedule", id: "second" } },
    { trigger: { kind: "inbound", id: "mail" } }, { trigger: { kind: "tool", id: "lookup", args: {} } },
  ]);
});
