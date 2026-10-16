import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import { createStewardService } from "./service";

const spec = { root: "tasks", elements: { tasks: { type: "TaskList", children: [], props: { path: "day.md", section: null, title: null, showProgress: true } } } };
async function fixture() {
  const db = testDb(), workspaceId = (await db.workspace.create({ data: { name: "ui" } })).id;
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-ui-"));
  const service = createStewardService({ db, dataDir, now: () => new Date(), deliveries: [], chat: null, publicUrl: null, chatTimeoutMs: 10, onQueued: async () => {} });
  const owner = service.forWorkspace(workspaceId), affair = await owner.affairs.create({ title: "UI" });
  await owner.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "message", prompt: "compose" });
  const run = (await owner.runs.claimNext("background"))!;
  const files = await owner.affairs.files(affair.id);
  return { db, workspaceId, owner, affair, files, call: (name: string, input: unknown) => service.tools.call(run.token, name, input) };
}
test("UI tool validates before writing; JSONL, entry/card roles and read projections", async () => {
  const f = await fixture();
  try {
    expect((await f.owner.affairs.detail(f.affair.id)).entry).toBe("README.md");
    const before = await f.files.tree();
    expect(await f.call("chrona_ui_set", { path: "bad.ui.json", spec: { root: "missing", elements: {} }, role: "entry" })).toMatchObject({ ok: false });
    expect(await f.files.tree()).toEqual(before);
    const stream = Object.entries(spec).map(([key, value]) => JSON.stringify({ op: "add", path: "/" + key, value })).join("\n");
    expect(await f.call("chrona_ui_set", { path: "a.ui.json", spec: stream })).toMatchObject({ ok: true, summary: "TaskList: day.md" });
    expect((await f.owner.affairs.detail(f.affair.id)).entry).toBe("a.ui.json");
    await f.call("chrona_ui_set", { path: "pages/home.ui.json", spec, role: "entry" });
    expect((await f.files.read(".chrona/entry")).content.trim()).toBe("pages/home.ui.json");
    expect((await f.owner.affairs.detail(f.affair.id)).entry).toBe("pages/home.ui.json");
    await f.files.intake([{ path: ".chrona/entry", bytes: new TextEncoder().encode("missing.ui.json") }], "Invalid pointer fixture");
    expect((await f.owner.affairs.detail(f.affair.id)).entry).toBe("a.ui.json");
    const button = { root: "button", elements: { button: { type: "Button", props: { label: "Done" }, children: [], on: { press: { action: "say", params: { text: "done" } } } } } };
    expect(await f.call("chrona_ui_set", { path: "button.ui.json", spec: button })).toMatchObject({ ok: true });
    expect(JSON.parse((await f.files.read("button.ui.json")).content)).toEqual(button);
    await f.call("chrona_ui_set", { path: "card.ui.json", spec, role: "card" });
    expect(JSON.parse((await f.files.read(".chrona/card.ui.json")).content)).toEqual(spec);
    await expect(f.files.read("card.ui.json")).rejects.toThrow();
    expect((await f.owner.today()).progress[0]!.card).toEqual(spec);
    await f.files.intake([{ path: ".chrona/card.ui.json", bytes: new TextEncoder().encode("not json") }], "Invalid card fixture");
    expect((await f.owner.today()).progress[0]!.card).toBeNull();
    await expect(f.files.save(".chrona/other", "bad", null, "chrona")).rejects.toThrow("engine-owned");
  } finally { await f.db.$disconnect(); }
});
test("UI topic, guide usage and linked feedback use normal chat", async () => {
  const f = await fixture();
  try {
    expect(await f.call("chrona_remember", { text: "Short pages", topic: "ui" })).toMatchObject({ topic: "ui" });
    expect(await f.call("chrona_remember", { text: "General preference" })).toMatchObject({ topic: "general" });
    await f.call("chrona_ui_set", { path: "home.ui.json", spec });
    await f.owner.uiEvent(f.affair.id, { path: "home.ui.json", kind: "open" });
    await f.owner.uiEvent(f.affair.id, { path: "home.ui.json", kind: "action", name: "say" });
    const guide = await f.call("chrona_ui_guide", {}) as { guide: string };
    expect(guide.guide).toContain("User preference: Short pages");
    expect(guide.guide).not.toContain("User preference: General preference");
    expect(guide.guide).toContain("Page opened: home.ui.json: 1");
    expect(guide.guide).toContain("Action used: say: 1");
    expect(guide.guide).toContain("TaskList never toggled: day.md");
    await f.owner.uiEvent(f.affair.id, { path: "day.md", kind: "toggle" });
    expect((await f.call("chrona_ui_guide", {}) as { guide: string }).guide).not.toContain("TaskList never toggled: day.md");
    await f.owner.uiEvent(f.affair.id, { path: "home.ui.json", kind: "feedback", text: "Less text" });
    expect(await f.db.message.findFirst({ where: { workspaceId: f.workspaceId, direction: "in" } })).toMatchObject({ affairId: f.affair.id, text: "对页面「home.ui.json」的意见：Less text" });
    expect(await f.db.audit.findFirst({ where: { subjectId: f.affair.id, kind: "ui_event" } })).toBeTruthy();
    expect(await f.db.run.count({ where: { affairId: f.affair.id, lane: "foreground", status: "queued" } })).toBe(1);
  } finally { await f.db.$disconnect(); }
});
