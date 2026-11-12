import { expect, test } from "bun:test";
import { todayView } from "./today";

type Health = { module: string; moduleId: string; open: boolean; incident: { status: string; lastAt: string } | null;
  contractFailureCount: number; nextAction: string | null; truncated: boolean };
function health(module: string, changes: Partial<Health> = {}): Health {
  return { module, moduleId: `${module}-id`, open: true, incident: { status: "unresolved", lastAt: "2026-11-07" },
    contractFailureCount: 0, nextAction: "检查", truncated: false, ...changes };
}
async function view(facts: Health[]) {
  const calls: string[] = [];
  const result = await todayView(async target => {
    calls.push(target);
    switch (target) {
      case "activity.runtime": return { at: "2026-11-08" };
      case "approvals.list": return { items: [] };
      case "notify.list": return { items: [] };
      case "notify.counts": return { queued: 0, failed: 0 };
      case "modules.list": return { items: facts.map(item => ({ id: item.moduleId, name: item.module, health: item })) };
      default: throw new Error(`Unexpected call ${target}`);
    }
  }, async () => []);
  expect(calls.filter(target => target.startsWith("modules."))).toEqual(["modules.list"]);
  return result;
}

test("Today preserves public health ID order for incident ties, sorts by newest and bounds problems at 20", async () => {
  const names = Array.from({ length: 60 }, (_, i) => `app-${String(i).padStart(2, "0")}`);
  const facts = names.map((name, i) => health(name, { moduleId: `id-${String(59 - i).padStart(2, "0")}` }));
  facts.push(health("newest", { incident: { status: "retrying", lastAt: "2026-11-08" } }));
  facts.push(health("closed", { open: false, incident: { status: "recovered", lastAt: "2026-11-09" } }));
  const result = await view(facts);
  expect(result.problems.map(item => item.module)).toEqual(["newest", ...names.toReversed().slice(0, 19)]);
  expect(result.apps.map(app => app.name)).toEqual(facts.map(item => item.module));
  expect(result.apps.every(app => !("health" in app))).toBe(true);
});

test("truncated health keeps open filtering, contract-only problems, recovered status and null timestamps", async () => {
  const facts = [health("no-incident", { incident: null, contractFailureCount: 200, nextAction: null, truncated: true }),
    health("closed", { open: false, truncated: true }),
    health("recovered-contract", { incident: { status: "recovered", lastAt: "2026-11-08" }, contractFailureCount: 2, truncated: true }),
    health("open-truncated", { truncated: true })];
  const result = await view(facts);
  expect(result.problems).toEqual([
    { module: "recovered-contract", moduleId: "recovered-contract-id", incidentStatus: null, contractFailures: 2, nextAction: "检查", since: "2026-11-08" },
    { module: "open-truncated", moduleId: "open-truncated-id", incidentStatus: "unresolved", contractFailures: 0, nextAction: "检查", since: "2026-11-07" },
    { module: "no-incident", moduleId: "no-incident-id", incidentStatus: null, contractFailures: 200, nextAction: null, since: null },
  ]);
});
