import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import type { Spec } from "../web/node_modules/@json-render/core";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { normalizedToolInputSchema, validateToolArgs } from "../../module-tool-contract";
import { pageErrors } from "../web/pages";
import { PageView, type Page } from "../web/src/pages";
import manifest from "./module.json";
import { MAIN_PAGE } from "./page";
import { SETTINGS_PAGE } from "./settings-page";
import { concernSchema, DEFAULT_SETTINGS, freshState, inputs, outputs } from "./schema";
import { emptyConcern } from "./ui";

// Use Web's React instance: this app intentionally has no frontend dependency install.
const webRequire = createRequire(new URL("../web/package.json", import.meta.url));
const { evaluateVisibility, resolveActionParam, resolveElementProps } = webRequire("@json-render/core") as typeof import("../web/node_modules/@json-render/core");
const { createElement } = webRequire("react") as typeof import("react");
const { renderToStaticMarkup } = webRequire("react-dom/server") as { renderToStaticMarkup: (element: ReturnType<typeof createElement>) => string };
type Element = Spec["elements"][string];
type Binding = { action: string; params: Record<string, unknown>; onSuccess?: Binding; onError?: Binding };
const elements = MAIN_PAGE.spec.elements as Record<string, Element>;
const settings = SETTINGS_PAGE.spec.elements as Record<string, Element>;
const at = "2026-11-09T06:00:00Z";
const concern = concernSchema.parse({
  id: "concern-1", revision: 1, title: "确认申请材料已收到", goal: "收到确认回复", project: "申请", status: "waiting-external", priority: "normal", userExplicit: true,
  dueAt: null, revisitAt: at, silentUntil: null, expectedProgressAt: null, progressAt: null, awaiting: [],
  links: [{ source: "mail", moduleId: "mail-1", ref: "message-1", version: "v1", checkedAt: at, conclusion: "邮件已送达，尚无回复" }],
  escalation: "none", lastCheckedAt: at, lastAssessment: { at, conclusion: "继续等确认回复", decisionId: "decision-1" }, createdAt: at, updatedAt: at,
});
const agenda = outputs.agenda.parse({
  cursor: null, nextCursor: null, limited: false, total: 2,
  concerns: [concern],
  proposals: [{ id: "proposal-1", title: "准备补充材料", goal: "", project: "申请", reason: "申请要求发生变化", source: "mail", moduleId: "mail-1", signalIds: [], status: "pending", concernId: null, createdAt: at, updatedAt: at }],
  runtime: { ...freshState().runtime, phase: "waiting", currentDecisionId: "decision-1", runId: "secret-run-id", interactions: [{ id: "prompt-1", title: "需要补充说明", message: "请确认材料版本", expiresAt: at }] },
  stats: { open: 1, pendingProposals: 1, wakes24h: 0, unmatched: 0, trustworthyReports: 0 },
});
function render(page: typeof MAIN_PAGE | typeof SETTINGS_PAGE, state: Record<string, unknown>) {
  const view = { ...page, module: "mind", keyed: ["note", "ui-dismiss"], spec: { ...page.spec, state: { ...page.spec.state, ...state } } } as unknown as Page;
  return renderToStaticMarkup(createElement(PageView, { page: view, deps: { call: async () => { throw new Error("Offline render must not call tools"); }, content: async () => new Blob(), navigate: () => {} } }));
}
function press(element: Element): Binding[] {
  const binding = element.on!.press;
  return (Array.isArray(binding) ? binding : [binding]) as Binding[];
}
function call(element: Element) { return press(element).find(binding => binding.action === "call")!; }
function args(element: Element, state: Record<string, unknown>, repeatItem?: unknown) {
  return resolveActionParam(call(element).params.args, { stateModel: state, repeatItem }) as Record<string, unknown>;
}
function validate(tool: keyof typeof inputs, value: Record<string, unknown>) {
  const parsed = moduleManifestSchema.parse(manifest), contract = parsed.tools.find(item => item.name === tool)!;
  const keyed = Object.hasOwn(contract.parameters.properties, "request-key") ? { ...value, "request-key": "renderer-key-1" } : value;
  expect(validateToolArgs(contract, keyed)).toEqual(keyed);
  expect(inputs[tool].safeParse(keyed).success).toBe(true);
  return keyed;
}

describe("Mind application-owned declarative pages", () => {
  test("both direct page registrations validate against the actual Web catalog and final manifest", () => {
    const parsed = moduleManifestSchema.parse(manifest);
    const tools = new Map(parsed.tools.map(tool => [tool.name, normalizedToolInputSchema(tool)]));
    expect(pageErrors(MAIN_PAGE, tools, "mind")).toEqual([]);
    expect(pageErrors(SETTINGS_PAGE, tools, "mind")).toEqual([]);
    expect(MAIN_PAGE.layout).toBe("document"); expect(SETTINGS_PAGE.layout).toBe("document"); expect(SETTINGS_PAGE.purpose).toBe("settings");
    expect(parsed.uses).toContain("web.page-set");
    for (const source of [...Object.values(MAIN_PAGE.data), ...Object.values(SETTINGS_PAGE.data)]) {
      expect("refresh" in source).toBe(false);
      validate(source.tool as keyof typeof inputs, source.args);
    }
    for (const name of ["note", "ui-dismiss"]) expect(tools.get(name)?.properties).toHaveProperty("request-key");
    expect(JSON.stringify([MAIN_PAGE, SETTINGS_PAGE])).not.toMatch(/randomUUID|"request-key"|agent\.|runKey|contextKey|runId|prompt\//);
  });

  test("real concern, evidence, waiting state and pending review render without execution identities", () => {
    const html = render(MAIN_PAGE, { agenda });
    for (const text of [concern.title, "等待外部进展", "下次复查", "继续等确认回复", "邮件已送达，尚无回复", "依据来源：mail", "等待补充或外部结果", "请确认材料版本", "加入关注", "放下建议"]) expect(html).toContain(text);
    expect(html).not.toContain("secret-run-id"); expect(html).not.toContain("还不能显示组件");
    expect(html).toMatch(/disabled="">现在检查一次/);
  });

  test("empty and unavailable data remain distinct", () => {
    const empty = render(MAIN_PAGE, { agenda: { ...agenda, concerns: [], proposals: [], total: 0 }, history: { decisions: [] } });
    expect(empty).toContain("还没有关注"); expect(empty).toContain("暂无建议"); expect(empty).not.toContain("正在读取关注记录");
    const unavailable = render(MAIN_PAGE, {});
    expect(unavailable).toContain("正在读取关注记录"); expect(unavailable).not.toContain("还没有关注");
  });

  test("unknown execution and submission are explicit and disabled without retry side effects", () => {
    const html = render(MAIN_PAGE, { agenda: { ...agenda, runtime: { ...agenda.runtime, phase: "unknown", lastError: "transport failed for private-run-token" } }, noteStatus: "unknown", checkStatus: "unknown", proposalStatus: "unknown", form: { ...emptyConcern, title: "保留的草稿" } });
    expect(html).toContain("执行结果待确认；不会自动重试"); expect(html).toContain("提交结果待确认"); expect(html).toContain("保留的草稿");
    expect(html).toContain("最近检查遇到问题"); expect(html).not.toContain("private-run-token");
    for (const name of ["check", "create", "accept", "dismiss"]) {
      expect(resolveElementProps(elements[name]!.props, { stateModel: { ...MAIN_PAGE.spec.state, agenda, noteStatus: "unknown", checkStatus: "unknown", proposalStatus: "unknown", form: { ...emptyConcern, title: "草稿" } } }).disabled).toBe(true);
    }
    for (const name of ["check", "create", "update", "accept", "dismiss"]) expect(call(elements[name]!).onError).toMatchObject({ action: "setState", params: { value: "unknown" } });
  });

  test("create omits id; edit copies ordinary scalars and update sends the selected identity", () => {
    const state = { form: { ...emptyConcern, title: concern.title } };
    const create = args(elements.create!, state); expect(create).not.toHaveProperty("id");
    validate("note", create);
    const edit = resolveActionParam(press(elements.edit!)[0]!.params.value, { stateModel: state, repeatItem: concern }) as Record<string, unknown>;
    expect(edit).toMatchObject({ id: concern.id, title: concern.title, status: concern.status, "revisit-at": at, "due-at": "" });
    expect(edit).not.toHaveProperty("awaiting"); expect(edit).not.toHaveProperty("links");
    validate("note", args(elements.update!, { form: edit }));
    expect(evaluateVisibility(elements.create!.visible, { stateModel: { form: edit } })).toBe(false);
    expect(evaluateVisibility(elements.update!.visible, { stateModel: { form: edit } })).toBe(true);
  });

  test("pagination keeps fetched pages instead of reloading first-page sources", () => {
    for (const name of ["agendaFirst", "agendaNext", "historyFirst", "historyNext"]) {
      expect(call(elements[name]!).params.reload).toBe(false);
    }
  });

  test("proposal accept and dismiss call the supported backend contracts", () => {
    const proposal = agenda.proposals[0]!;
    expect(validate("note", args(elements.accept!, {}, proposal))).toEqual({ "proposal-id": proposal.id, "request-key": "renderer-key-1" });
    expect(call(elements.dismiss!).params.tool).toBe("ui-dismiss");
    expect(validate("ui-dismiss", args(elements.dismiss!, {}, proposal))).toEqual({ id: proposal.id, "request-key": "renderer-key-1" });
    expect(evaluateVisibility(elements.accept!.visible, { stateModel: {}, repeatItem: { ...proposal, status: "accepted" } })).toBe(false);
    expect(evaluateVisibility(elements.dismiss!.visible, { stateModel: {}, repeatItem: { ...proposal, status: "dismissed" } })).toBe(false);
  });

  test("manual check has empty arguments and never overwrites agenda with its partial runtime response", () => {
    validate("check", args(elements.check!, {}));
    expect(call(elements.check!).params.result).toBe("/checkResult");
    expect(call(elements.check!).params.reload).toBe(false);
  });

  test("records distinguish verified reports from an unverified execution claim", () => {
    const decision = { id: "decision-1", at, phase: "unknown", runId: "private-run-token", contextId: "private-context-token", report: { verified: false, result: { summary: "尚未核实的完成声明" } } };
    const unverified = render(MAIN_PAGE, { history: { decisions: [decision] } });
    expect(unverified).toContain("尚无已核实的结果说明");
    expect(unverified).not.toContain("尚未核实的完成声明");
    expect(unverified).not.toContain("private-run-token"); expect(unverified).not.toContain("private-context-token");
    const verified = render(MAIN_PAGE, { history: { decisions: [{ ...decision, phase: "completed", report: { verified: true, result: { summary: "已核实收到确认回复" } } }] } });
    expect(verified).toContain("已核实收到确认回复"); expect(verified).toContain("检查已完成");
  });

  test("refresh only reads records and preserves uncertain submission locks", () => {
    const actions = press(elements.refresh!);
    expect(actions.filter(action => action.action === "call").map(action => action.params.tool)).toEqual(["ui-agenda", "decisions"]);
    for (const status of ["unknown", "pending", "saved"]) {
      const state = { proposalStatus: status, checkStatus: status };
      for (const action of actions.filter(action => action.action !== "call")) {
        expect(action.action).toBe("setState");
        expect(resolveActionParam(action.params.value, { stateModel: state })).toBe(status === "saved" ? "" : status);
      }
    }
  });

  test("partial agenda and history pages expose navigation to every remaining record", () => {
    const partial = { ...agenda, limited: true, cursor: "agenda:1:50", nextCursor: "agenda:1:100" };
    const html = render(MAIN_PAGE, { agenda: partial, history: { decisions: [], limited: true, cursor: "decisions:1:10", nextCursor: "decisions:1:20" } });
    for (const label of ["下一页关注与建议", "回到关注首页", "当前只显示部分记录", "下一页检查记录", "回到最新检查记录"]) expect(html).toContain(label);
    expect(call(elements.agendaNext!).params.tool).toBe("ui-agenda");
    validate("ui-agenda", args(elements.agendaNext!, { agenda: partial }));
    validate("decisions", args(elements.historyNext!, { history: { nextCursor: "decisions:1:20" } }));
    expect(evaluateVisibility(elements.agendaNext!.visible, { stateModel: { agenda } })).toBe(false);
  });

  test("settings use ordinary returned scalars and send values accepted after actual Input editing", () => {
    const html = render(SETTINGS_PAGE, { policy: DEFAULT_SETTINGS });
    for (const label of ["启用主动检查", "检查间隔（分钟）", "每日主动处理上限", "免打扰开始", "免打扰结束", "时区", "保存关注设置"]) expect(html).toContain(label);
    expect(html).toContain('name="interval-minutes"'); expect(html).toContain('value="15"'); expect(html).not.toContain("JSON");
    const initial = args(settings.save!, { policy: DEFAULT_SETTINGS });
    expect(initial).toEqual({ enabled: true, "interval-minutes": "15", "daily-wakes": "6", "quiet-start": "22:00", "quiet-end": "08:00", timezone: "UTC" });
    validate("ui-settings", initial);
    // Web's ordinary Input stores event.target.value, including for type=number.
    const edited = args(settings.save!, { policy: { ...DEFAULT_SETTINGS, intervalMinutes: "30", dailyWakes: "4", timezone: "Asia/Shanghai" } });
    expect(edited).toMatchObject({ "interval-minutes": "30", "daily-wakes": "4", timezone: "Asia/Shanghai" });
    validate("ui-settings", edited);
  });

  test("pending, success and uncertain form states are visible without claiming execution completed", () => {
    expect(render(MAIN_PAGE, { noteStatus: "pending" })).toContain("正在提交，请稍候");
    expect(render(MAIN_PAGE, { noteStatus: "saved" })).toContain("关注已保存");
    expect(render(SETTINGS_PAGE, { policy: DEFAULT_SETTINGS, saveStatus: "saved" })).toContain("关注设置已保存");
    expect(render(SETTINGS_PAGE, { policy: DEFAULT_SETTINGS, saveStatus: "unknown" })).toContain("提交结果待确认");
    expect(resolveElementProps(elements.create!.props, { stateModel: { ...MAIN_PAGE.spec.state, form: { ...emptyConcern, title: "已保存的关注" }, noteStatus: "saved" } }).disabled).toBe(true);
  });
});
