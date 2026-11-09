import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createModelPolicy } from "./model-policy";
const config = { tiers: { fast: { model: "fake/fast", thinking: "high" as const }, "deep-work": { model: "fake/deep" } }, preferredTimeoutMs: 1200 };
const limits = { maxCallsPerEvent: 2, maxOutputTokens: 20, eventTimeoutMs: 5000 };
test("Agent policy requires live owner authorization, persists atomically and bounds provider requests", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-policy-");
  let allowed = false, backend = true;
  const authorize = async (id: string) => { if (!allowed || id !== "live-owner") throw new Error("forbidden: owner required"); return { authorized: true }; };
  try {
    const policy = createModelPolicy(data, authorize, async () => backend);
    expect(await policy.ready()).toBe(false);
    await expect(policy.configure({ config }, "spoofed")).rejects.toThrow("forbidden");
    allowed = true;
    expect(await policy.configure({ config }, "live-owner")).toEqual({ config, ready: true });
    expect(JSON.parse(await readFile(join(data, "model-policy.json"), "utf8"))).toEqual(config);
    expect((await stat(join(data, "model-policy.json"))).mode & 0o777).toBe(0o600);
    const restarted = createModelPolicy(data, authorize, async () => backend);
    expect(await restarted.select("fast", limits, 25)).toEqual({ model: "fake/fast", thinking: "high" as const, maxOutputTokens: 20, timeoutMs: 1200 });
    expect(await restarted.select("deep-work", { ...limits, eventTimeoutMs: 500 }, 10)).toEqual({ model: "fake/deep", maxOutputTokens: 10, timeoutMs: 500 });
    await expect(restarted.select("missing", limits, 10)).rejects.toThrow("unconfigured");
    backend = false;
    expect(await restarted.ready()).toBe(false);
    await expect(restarted.select("fast", limits, 10)).rejects.toThrow("unconfigured");
    await policy.configure({ clear: true }, "live-owner");
    expect(await restarted.configure({}, "live-owner")).toEqual({ config: null, ready: false });
  } finally { await rm(data, { recursive: true, force: true }); }
});
test("concurrent Agent configuration remains complete and tier keys survive kebab arguments", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-policy-");
  try {
    const policy = createModelPolicy(data, async () => ({ authorized: true }), async () => true);
    await Promise.all([policy.configure({ config }, "one"), policy.configure({ config: { tiers: config.tiers, "preferred-timeout-ms": 2000 } }, "two")]);
    expect((await policy.configure({}, "read")).config).toEqual({ ...config, preferredTimeoutMs: 2000 });
  } finally { await rm(data, { recursive: true, force: true }); }
});
