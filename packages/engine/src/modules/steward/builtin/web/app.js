// Chrona's simple web page: plain DOM, no build step. Data comes from this module's /api/web, which makes routed calls
// for the user (v2-8); requests carry the user's key.
const KEY = "chrona.accessKey"; // the same key the previous web app stored
const main = document.getElementById("main");

const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child instanceof Node ? child : String(child));
  return node;
};
const when = iso => new Date(iso).toLocaleString();
class Unauthorized extends Error {}
const auth = () => { const key = localStorage.getItem(KEY); return key ? { authorization: `Bearer ${key}` } : {}; };

async function request(url, { method = "GET", body, raw = false } = {}) {
  const response = await fetch(url, { method, headers: { ...auth(), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.code || `请求失败（${response.status}）`);
  }
  return raw ? response.blob() : response.json();
}
const web = (path, options) => request(`/api/web${path}`, options);
// A module tool, through the page's data API (Chrona checks what this page may call).
const tool = (target, args = {}) => web("/call", { method: "POST", body: { target, args } });

// Replies to web conversations, pushed over SSE. fetch (not EventSource) so the request carries the key.
const replyListeners = new Set();
async function listen() {
  for (;;) {
    try {
      const response = await fetch("/api/web/events", { headers: { ...auth(), accept: "text/event-stream" } });
      if (response.status === 401) return;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const block of blocks) {
          const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
          if (data) { const event = JSON.parse(data); for (const listener of replyListeners) listener(event); }
        }
      }
    } catch { /* reconnect below */ }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

function login(message) {
  main.replaceChildren(h("section", {},
    h("h2", {}, "访问密钥"),
    h("p", { class: "muted" }, message ?? "请输入 Chrona 的 API_KEY。它只保存在这个浏览器里。"),
    h("form", { onsubmit: event => { event.preventDefault(); localStorage.setItem(KEY, event.target.key.value.trim()); start(); } },
      h("div", { class: "row" }, h("input", { name: "key", type: "password", autocomplete: "current-password", required: true }), h("button", { class: "primary" }, "保存")))));
}

// ------------------------------------------------------------------ today --
function approvalItem(approval, after) {
  // v2-18: say what happened in place of the card (and which version now runs), then refresh.
  const result = h("div", { role: "status" });
  const decide = (decision, scope = "once") => async event => {
    const item = event.target.closest("li");
    for (const button of item.querySelectorAll("button")) button.disabled = true;
    try {
      const resolved = await web(`/approvals/${approval.id}/resolve`, { method: "POST", body: { decision, scope } });
      const app = approval.moduleId ? (await web("/modules")).find(module => module.id === approval.moduleId) : null;
      const running = app && decision === "approve" ? ` · ${app.name} 当前版本 ${String(app.activeHash ?? "").slice(0, 8)}` : "";
      item.replaceChildren(h("div", { class: "ok" }, `${resolved.status === "denied" ? "已拒绝" : "已批准"}：${approval.title}${running}`));
      setTimeout(after, 4000);
    } catch (error) {
      result.textContent = `未处理：${error.message}`;
      for (const button of item.querySelectorAll("button")) button.disabled = false;
    }
  };
  return h("li", { class: "approval" },
    h("div", {}, h("strong", {}, approval.title), " ", h("span", { class: "muted" }, when(approval.createdAt))),
    approval.detail && h("div", {}, approval.detail),
    approval.preview && h("details", {}, h("summary", {}, "详情"), h("pre", {}, approval.preview)),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: decide("approve") }, "批准"), h("button", { onclick: decide("deny") }, "拒绝")), result);
}
// A question a running Provider asked; unanswered questions expire and the run goes on without the answer.
function interactionItem(interaction, after) {
  const { question } = interaction;
  const send = async answer => {
    try { await web(`/interactions/${interaction.id}/answer`, { method: "POST", body: answer }); after(); }
    catch (error) { alert(error.message); }
  };
  const input = question.method === "editor" ? h("textarea", { rows: 6 }, question.prefill ?? "") : question.method === "input" ? h("input", { type: "text" }) : null;
  const choices = question.method === "confirm" ? [h("button", { class: "primary", onclick: () => send({ decision: "submit", value: true }) }, "是"), h("button", { onclick: () => send({ decision: "submit", value: false }) }, "否")]
    : question.method === "select" ? question.options.map((option, index) => h("button", { onclick: () => send({ decision: "submit", value: index }) }, option))
    : [h("button", { class: "primary", onclick: () => send({ decision: "submit", value: input.value }) }, "提交")];
  return h("li", {}, h("div", {}, h("strong", {}, question.title), " ", h("span", { class: "muted" }, `${when(interaction.expiresAt)} 前`)),
    question.message && h("div", {}, question.message), input,
    h("div", { class: "row" }, ...choices, h("button", { onclick: () => send({ decision: "cancel" }) }, "不回答")));
}
async function today() {
  const [view, runs] = await Promise.all([web("/today"), web("/runs")]);
  const questions = runs.flatMap(run => run.interactions.filter(interaction => interaction.status === "pending"));
  const active = runs.filter(run => run.active);
  const stop = run => async () => {
    if (!confirm("停止这次处理？已经做完的部分会保留。")) return;
    try { await web(`/runs/${run.id}/cancel`, { method: "POST" }); today(); } catch (error) { alert(error.message); }
  };
  const feedback = (n, value) => async () => { try { await tool("notify.feedback", { id: n.id, feedback: value }); today(); } catch (error) { alert(error.message); } };
  main.replaceChildren(
    view.health && !view.health.provider.available ? h("section", {}, h("p", { class: "error" }, `Provider 不可用：${view.health.provider.lastError ?? view.health.provider.name}`)) : "",
    questions.length ? h("section", {}, h("h2", {}, `Chrona 在问你（${questions.length}）`), h("ul", { class: "plain" }, questions.map(q => interactionItem(q, today)))) : "",
    active.length ? h("section", {}, h("h2", {}, "正在处理"), h("ul", { class: "plain" }, active.map(run => h("li", {}, run.sessionTitle ?? "后台任务", " ", h("span", { class: "muted" }, run.progress?.phase ?? run.status), " ", h("button", { onclick: stop(run) }, "停止"))))) : "",
    h("section", {}, h("h2", {}, `待你决定（${view.approvals.length}）`),
      view.approvals.length ? h("ul", { class: "plain" }, view.approvals.map(a => approvalItem(a, today))) : h("p", { class: "muted" }, "没有待处理的事项。")),
    h("section", {}, h("h2", {}, "接下来"),
      view.upcoming.length ? h("ul", { class: "plain" }, view.upcoming.map(item => h("li", {}, when(item.at), " · ", item.label ?? item.mode))) : h("p", { class: "muted" }, "七天内没有安排。")),
    h("section", {}, h("h2", {}, "最近通知"),
      view.updates.length ? h("ul", { class: "plain" }, view.updates.map(n => h("li", {}, h("strong", {}, n.title), " ", h("span", { class: "muted" }, when(n.createdAt)), h("div", {}, n.body),
        n.feedback ? h("span", { class: "muted" }, n.feedback === "useful" ? "已标为有用" : "已标为没用") : h("div", { class: "row" }, h("button", { onclick: feedback(n, "useful") }, "有用"), h("button", { onclick: feedback(n, "not_useful") }, "没用"))))) : h("p", { class: "muted" }, "暂无。")),
    h("section", {}, h("h2", {}, "应用"),
      h("ul", { class: "plain" }, view.apps.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ", h("span", { class: "muted" }, app.status === "active" ? app.description ?? "" : "已暂停"))))),
    h("section", {}, h("h2", {}, "最近会话"),
      h("ul", { class: "plain" }, view.sessions.map(s => h("li", {}, h("a", { href: `/sessions/${s.id}` }, s.title ?? s.key), " ", h("span", { class: "muted" }, `${s.source} · ${when(s.lastActivityAt)}`))))),
  );
}

// ------------------------------------------------------------------- chat --
// Attachments are kept with the conversation; the page fetches them with the key and hands them over as a download.
function attachmentLink(messageId, file) {
  if (!file.ref || !messageId) return h("span", { class: "muted" }, file.name);
  return h("a", { href: "#", onclick: async event => {
    event.preventDefault();
    try {
      const blob = await web(`/file?message=${encodeURIComponent(messageId)}&ref=${encodeURIComponent(file.ref)}`, { raw: true });
      h("a", { href: URL.createObjectURL(blob), download: file.name }).click();
    } catch (error) { alert(error.message); }
  } }, file.name);
}
async function bubble(message) {
  const node = h("div", { class: `bubble ${message.direction}` }, message.text);
  for (const file of message.attachments ?? []) node.append(h("div", {}, attachmentLink(message.id, file)));
  return node;
}
async function chat(sessionId) {
  const sessions = await web("/sessions");
  const current = sessionId ?? (location.pathname === "/chat/new" ? null : sessions[0]?.id ?? null);
  const list = h("div", { class: "messages" }), status = h("p", { class: "muted" }), shown = new Set(), early = [];
  const show = async message => {
    if (shown.has(message.id)) return;
    shown.add(message.id);
    list.append(await bubble(message));
    list.scrollTop = list.scrollHeight;
  };
  // Listen before loading, so a reply pushed meanwhile is neither lost nor shown twice.
  let loaded = false;
  replyListeners.clear();
  replyListeners.add(async event => {
    if (event.type !== "reply" || event.session !== current) return;
    const message = { id: event.message, direction: "out", text: event.text, attachments: JSON.parse(event.attachments ?? "[]") };
    status.textContent = "";
    if (loaded) await show(message); else early.push(message);
  });
  for (const message of current ? await web(`/sessions/${current}/messages`) : []) await show(message);
  const building = sessions.find(s => s.id === current)?.source === "build";
  loaded = true;
  for (const message of early) await show(message);
  const form = h("form", { onsubmit: async event => {
    event.preventDefault();
    const text = event.target.text.value.trim();
    if (!text) return;
    if (building && !globalThis.confirm("停止当前构建，并保留已有文件按新需求继续？已提交的版本和审批不会撤回。")) return;
    const submit = event.target.querySelector("button.primary");
    submit.disabled = true; status.textContent = building ? "正在修改需求……" : "Chrona 正在处理……";
    try {
      const sent = building ? await web(`/sessions/${current}/revise-build`, { method: "POST", body: { requirements: text } }) : await web("/chat", { method: "POST", body: current ? { text, session: current } : { text } });
      event.target.text.value = "";
      list.append(h("div", { class: "bubble in" }, text));
      if (building) status.textContent = "已按新需求继续构建。";
      // A new conversation: open it; its replies arrive on the reopened page.
      if (!current) go(`/sessions/${sent.sessionId}`, true);
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  } }, h("textarea", { name: "text", rows: 3, placeholder: building ? "补充或修改构建需求……" : current ? "说点什么……（Ctrl+Enter 发送）" : "新会话：说点什么……", onkeydown: event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.target.form.requestSubmit(); } }),
    h("div", { class: "row" }, h("button", { class: "primary" }, building ? "修改需求并继续" : "发送"), building ? h("button", { type: "button", onclick: async event => {
      if (!globalThis.confirm("停止构建？已有文件保留，已提交的版本和审批不会撤回。")) return;
      event.target.disabled = true;
      try { await web(`/sessions/${current}/stop-build`, { method: "POST" }); status.textContent = "构建已停止，可修改需求后继续。"; }
      catch (error) { status.textContent = error.message; }
      finally { event.target.disabled = false; }
    } }, "停止构建") : "", status));
  main.replaceChildren(h("div", { class: "chat" },
    h("section", {}, h("h2", {}, "会话"),
      h("button", { onclick: () => go("/chat/new") }, "新会话"),
      h("ul", { class: "plain" }, sessions.map(s => h("li", { class: s.id === current ? "selected" : "" }, h("a", { href: `/sessions/${s.id}` }, s.title ?? when(s.createdAt)))))),
    h("section", {}, list, building ? h("p", { class: "muted" }, "可停止构建或修改需求；修改会先停止旧处理，保留已有文件后继续。已提交版本和审批不会撤回；结果仍发回原对话。") : "", form, current ? transcript(current, building) : "")));
  list.scrollTop = list.scrollHeight;
}
// What the Provider did (v2-13): open for module builds, on request for conversations.
function transcript(sessionId, open) {
  const body = h("div", { class: "transcript" }, h("p", { class: "muted" }, "加载中……"));
  const load = async () => {
    try {
      const items = await web(`/sessions/${sessionId}/transcript`);
      body.replaceChildren(...(items.length ? items.map(item => item.kind === "text" ? h("p", {}, item.text)
        : item.kind === "tool" ? h("p", { class: "muted" }, "▶ ", h("code", {}, item.tool), " ", item.args)
        : h("pre", { class: item.error ? "error" : "" }, item.text || "（无输出）")) : [h("p", { class: "muted" }, "还没有过程记录。")]));
    } catch (error) { body.replaceChildren(h("p", { class: "error" }, error.message)); }
  };
  const details = h("details", { open }, h("summary", {}, "过程"), body);
  if (open) void load(); else details.addEventListener("toggle", () => { if (details.open) void load(); }, { once: true });
  return details;
}

// ------------------------------------------------------------------- apps --
const runtimeText = meta => ({ running: "运行中", starting: "启动中", backoff: "等待恢复", idle: "正常休眠（按需启动）", unavailable: "当前不可用", paused: "已暂停", unobserved: "当前进程状态未观测" }[meta.runtime?.state] ?? "当前进程状态未知");
const faultText = status => ({ retrying: "等待有限恢复", verifying: "连接已恢复，功能待验证", unresolved: "未解决，需要处理", recovered: "对应调用已验证恢复" }[status] ?? status);
function diagnosticPanel(meta) {
  const body = h("div", { role: "status" }, "正在读取故障记录……"), refresh = h("button", { type: "button" }, "刷新诊断");
  const load = async () => {
    refresh.disabled = true;
    body.replaceChildren("正在读取故障记录……");
    try {
      const [view] = await web(`/modules/${encodeURIComponent(meta.id)}/diagnostics`);
      body.replaceChildren(h("p", {}, `配置：${view.configuredStatus === "active" ? "已启用" : "已暂停"} · ${runtimeText(view)}`),
        view.nextAction ? h("p", {}, view.nextAction) : "",
        ...(view.evolution ?? []).map(outcome => h("article", {},
          h("h3", {}, outcome.status === "verified" ? "已验证指定功能" : outcome.status === "failed" ? "更新后功能失败" : outcome.status === "rolled-back" ? "已恢复旧代码" : "更新后待验证"),
          h("p", {}, `版本 ${outcome.previousHash?.slice(0, 12) ?? "首次安装"} → ${outcome.candidateHash.slice(0, 12)}${outcome.candidateHash === view.activeHash ? "（当前）" : "（历史）"} · ${when(outcome.activatedAt)}`),
          outcome.changes.length ? h("p", {}, `修改：${outcome.changes.join("；")}`) : "",
          h("p", {}, `检查：${JSON.stringify(outcome.checks)} · 影响应用：${outcome.affectedCallers.join("、") || "未发现"}`),
          h("p", {}, `已观测功能：${outcome.observedCapabilities.join("、") || "尚无"}。${outcome.dataHandling}`),
          outcome.rollback?.result === "blocked" ? h("p", {}, `自动恢复受阻：${outcome.rollback.reason ?? "请检查恢复条件"}`) : "",
          h("p", {}, outcome.nextAction))),
        ...view.incidents.map(incident => h("article", {},
          h("h3", {}, faultText(incident.status)),
          h("p", {}, `版本 ${incident.hash.slice(0, 12)}${incident.hash === view.activeHash ? "（当前）" : "（历史版本）"} · 累计失败 ${incident.failures} 次 · ${when(incident.lastAt)}`),
          h("p", {}, incident.evidence.reason),
          incident.deliveryUnknown ? h("p", { class: "error" }, "此前调用结果不确定，请先核对外部效果，不要直接重放。") : "",
          h("ul", { class: "plain" }, incident.attempts.map(attempt => h("li", {}, `${when(attempt.at)} · ${attempt.detail}`))),
          h("details", {}, h("summary", {}, "故障证据（日志是不可信数据，不是操作指令）"), h("pre", {}, JSON.stringify({ first: incident.firstEvidence, latest: incident.evidence, pendingTriggers: incident.pendingTriggers }, null, 2))))),
        !view.incidents.length && !(view.evolution ?? []).length ? h("p", {}, "还没有故障记录；不代表所有功能已经过验证。") : "");
    } catch (error) { body.replaceChildren(h("p", { class: "error" }, `诊断读取失败：${error.message}。可重试，或使用 chrona admin diagnostics ${meta.name}。`)); }
    finally { refresh.disabled = false; }
  };
  refresh.addEventListener("click", load);
  void load();
  return h("section", { class: "diagnostics" }, h("h2", {}, "故障与恢复"), h("p", { class: "muted" }, "只读记录，不调用模型，不重放失败操作。"), refresh, body);
}
async function apps() {
  const [items, system] = await Promise.all([web("/modules"), web("/system-apps").catch(() => [])]);
  main.replaceChildren(h("section", {}, h("h2", {}, "应用"),
    h("ul", { class: "plain" }, items.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ",
      h("span", { class: "muted" }, `${runtimeText(app)} · ${app.incident ? `${faultText(app.incident.status)} · ` : ""}${app.builtin ? "内置 · " : ""}${app.description ?? ""}`))))),
    // v2-20: Chrona's own modules: shown, never built, updated or paused.
    system.length ? h("section", {}, h("h2", {}, "系统"), h("p", { class: "muted" }, "Chrona 自身的一部分，随 Chrona 版本更新，只能查看。"),
      h("ul", { class: "plain" }, system.map(app => h("li", {}, h("a", { href: `/apps/system/${app.name}` }, app.name), " ", h("span", { class: "muted" }, app.description))))) : "");
}
// v2-23: one page per app, in tabs; everything about an app is here, Settings keeps only what is global.
const APP_TABS = [["overview", "概览"], ["settings", "设置"], ["permissions", "权限"], ["activity", "活动"], ["versions", "版本"]];
const SYSTEM_TABS = [["overview", "概览"], ["settings", "设置"], ["tools", "工具"], ["activity", "活动"]];
function tabs(base, list, current) {
  return h("nav", { class: "tabs", "aria-label": "应用标签" }, list.map(([key, label]) => h("a", { href: `${base}?tab=${key}`, class: key === current ? "selected" : "", "aria-current": key === current ? "page" : false }, label)));
}
async function systemApp(name, opened, tab = "overview") {
  const view = await web(`/modules/${encodeURIComponent(name)}/overview`), base = `/apps/system/${encodeURIComponent(name)}`;
  const who = tool => tool.visibility.includes("provider") ? "Chrona" : tool.visibility.includes("modules") ? "其他应用" : "用户入口";
  const current = opened ? "overview" : tab;
  const panels = {
    overview: async () => [h("p", {}, view.description), name === "memory" ? await memoryPanel() : "",
      view.sessions ? h("section", {}, h("h2", {}, "最近的工作"), view.work.length ? h("ul", { class: "plain" }, view.work.map(session => h("li", { id: `session-${session.id}` }, when(session.createdAt), " · ", session.status === "active" ? "进行中" : "已结束", " ", transcript(session.id, session.id === opened)))) : h("p", { class: "muted" }, "还没有工作记录。")) : ""],
    settings: async () => [settingsForm(name, view.settings, () => systemApp(name, null, "settings"))],
    tools: async () => [h("ul", { class: "plain" }, view.tools.map(tool => h("li", {}, h("code", {}, `${name}.${tool.name}`), " ", h("span", { class: "muted" }, `${who(tool)}可调用 · ${tool.description}`))))],
    activity: async () => [activityList(view.activity, name)],
  };
  main.replaceChildren(h("section", {}, h("h2", {}, `${name} · 系统`), h("p", { class: "muted" }, "Chrona 自身的一部分：不能构建、更新或停用，随 Chrona 版本更新。"), tabs(base, SYSTEM_TABS, current), ...await panels[current in panels ? current : "overview"]()));
}
function activityList(items, module) {
  return h("div", {}, items.length ? h("ul", { class: "plain" }, items.map(activityItem)) : h("p", { class: "muted" }, "还没有活动。"), h("p", {}, h("a", { href: `/activity?module=${encodeURIComponent(module)}` }, "查看全部活动")));
}
// An app's own settings, as its version declares them; nothing to change says so.
function settingsForm(module, view, after) {
  const entries = Object.entries(view.declarations ?? {}), state = h("span", { class: "muted", role: "status" });
  if (!entries.length) return h("p", { class: "muted" }, "这个应用没有可修改的配置。");
  const input = ([key, setting]) => {
    const value = view.values[key];
    if (setting.type === "boolean") return h("input", { name: key, type: "checkbox", checked: value === true, style: "width:auto" });
    if (setting.options) return h("select", { name: key }, setting.options.map(option => h("option", { value: option, selected: option === value }, option)));
    return h("input", { name: key, type: setting.type === "number" ? "number" : "text", value, ...(setting.min !== undefined ? { min: setting.min } : {}), ...(setting.max !== undefined ? { max: setting.max } : {}), ...(setting.maxLength ? { maxlength: setting.maxLength } : {}), step: setting.type === "number" ? "any" : false });
  };
  return h("form", { onsubmit: async event => {
    event.preventDefault();
    const f = event.target.elements, values = Object.fromEntries(entries.map(([key, setting]) => [key, setting.type === "boolean" ? f[key].checked : setting.type === "number" ? Number(f[key].value) : f[key].value]));
    state.textContent = "正在保存……";
    try { await web(`/modules/${encodeURIComponent(module)}/settings`, { method: "POST", body: { values } }); state.textContent = "已保存，下次运行生效。"; after(); }
    catch (error) { state.textContent = error.message; }
  } }, ...entries.map(entry => entry[1].type === "boolean"
    ? h("label", { class: "check" }, input(entry), " ", h("strong", {}, entry[1].label), entry[1].description ? h("div", { class: "muted" }, entry[1].description) : "")
    : h("label", {}, h("strong", {}, entry[1].label), " ", input(entry), entry[1].description ? h("div", { class: "muted" }, entry[1].description) : "")),
    h("div", { class: "row" }, h("button", { class: "primary" }, "保存"), state));
}
// v2-21: what memory is doing, and the user's own search with deletion.
async function memoryPanel() {
  let state = null;
  try { state = await web("/memory"); } catch { /* the search still works or shows its error */ }
  const results = h("ul", { class: "plain" }), note = h("p", { class: "muted", role: "status" });
  const search = async event => {
    event.preventDefault();
    note.textContent = "检索中……"; results.replaceChildren();
    try {
      const { items } = await web(`/memory?query=${encodeURIComponent(event.target.elements.query.value)}`);
      note.textContent = items.length ? "" : "没有找到。只用全文检索时请换关键词试试。";
      results.append(...items.map(item => h("li", {}, item.content, " ", h("span", { class: "muted" }, item.at ? when(item.at) : ""), " ", h("button", { type: "button", onclick: async click => {
        if (!confirm("删除这条记忆？")) return;
        try { await web("/memory/forget", { method: "POST", body: { id: item.id } }); click.target.closest("li").remove(); } catch (error) { note.textContent = error.message; }
      } }, "删除"))));
    } catch (error) { note.textContent = error.message; }
  };
  return h("section", {}, h("h2", {}, "记忆"),
    h("p", { class: "muted" }, state ? `${state.provider ? `提供者 ${state.provider}${state.available ? "" : "（不可用）"}` : "未启用"} · 自动检索${state.autoRecall ? "开" : "关"} · 自动写入${state.autoRetain ? "开" : "关"} · 24 小时内写入 ${state.last24h.retained}、检索 ${state.last24h.recalled}、删除 ${state.last24h.forgotten}` : "状态读取失败"),
    h("form", { onsubmit: search }, h("div", { class: "row" }, h("input", { name: "query", required: true, placeholder: "关键词" }), h("button", { class: "primary" }, "检索"))), note, results);
}
// A line about a conversation links to its process: a build has its own page, other work opens in its system app.
function processLink(item) {
  if (!item.session) return null;
  const href = item.session.source === "build" ? `/sessions/${item.session.id}` : `/apps/system/${encodeURIComponent(item.module)}?session=${encodeURIComponent(item.session.id)}`;
  return h("span", {}, " · ", h("a", { href }, "查看过程"));
}
function activityItem(item) {
  return h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.text, processLink(item));
}
// The generic app page (v2-23 tabs): what it is and does, its own settings and credentials, permissions, activity, versions.
async function app(appId, tab = "overview") {
  const view = await web(`/modules/${encodeURIComponent(appId)}/overview`), meta = view.app;
  if (!meta) throw new Error("没有这个应用");
  const base = `/apps/${meta.id}`, reload = () => app(appId, tab);
  const panels = {
    overview: async () => {
      const tools = (await web(`/tools?query=${encodeURIComponent(meta.name)}`)).filter(tool => tool.target.startsWith(`${meta.name}.`));
      return [h("p", {}, `${meta.status === "active" ? "已启用" : "已暂停"} · ${runtimeText(meta)}`), meta.description ? h("p", {}, meta.description) : "", await currentVersion(meta),
        ...(await web("/pages").catch(() => [])).filter(page => page.module === meta.name).map(page => h("p", {}, h("a", { href: pageHref(page) }, `打开${page.title}`))), tools.length ? h("section", {}, h("h2", {}, "操作"), ...tools.map(toolForm)) : ""];
    },
    settings: async () => [h("h3", {}, "配置"), settingsForm(meta.name, view.settings, reload), ...await credentialsPanel(view.permissions, reload), ...await modelCapPanel(meta.name, view.permissions.model, reload)],
    permissions: async () => [permissionsPanel(view.permissions, reload)],
    activity: async () => [activityList(view.activity, meta.name), h("h3", {}, "最近运行"),
      meta.runs.length ? h("ul", { class: "plain" }, meta.runs.map(run => h("li", {}, when(run.createdAt), " · ", run.triggerId, " · ", run.error ? h("span", { class: "error" }, run.error) : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`))) : h("p", { class: "muted" }, "还没有运行记录。"),
      diagnosticPanel(meta)],
    versions: async () => [h("ul", { class: "plain" }, meta.versions.slice(0, 20).map(version => h("li", {}, when(version.createdAt), " · ", version.hash.slice(0, 8), " · ", version.hash === meta.activeHash ? "当前" : version.status,
      version.errors ? h("div", { class: "error" }, version.errors.join("；")) : "")))],
  };
  main.replaceChildren(h("section", {}, h("h2", {}, meta.name), tabs(base, APP_TABS, tab), ...await panels[tab in panels ? tab : "overview"]()));
}
// Credentials this app reads (v2-16 §2.1): the fields its manifest asks for, saved field by field; values are never shown.
// One shared by several apps says so, and saving it here changes it for all of them.
async function credentialsPanel(permissions, after) {
  if (!permissions.secrets.length) return [];
  const all = (await web("/settings")).secrets ?? [];
  return [h("h3", {}, "凭据"), h("p", { class: "muted" }, "只保存在 Chrona 本机，不会显示、不进入对话或模型。留空的字段保持原值。"),
    h("ul", { class: "plain" }, permissions.secrets.map(secret => {
      const shared = (all.find(row => row.name === secret.name)?.modules ?? []).filter(name => name !== permissions.module);
      return h("li", {}, h("strong", {}, secret.label ?? secret.name), secret.label ? h("span", { class: "muted" }, ` ${secret.name}`) : "", " ",
        h("span", { class: secret.configured ? "muted" : "error" }, secret.configured ? `已设置${secret.updatedAt ? ` · ${when(secret.updatedAt)}` : ""}` : "未设置"),
        shared.length ? h("span", { class: "muted" }, ` · 与 ${shared.join("、")} 共用`) : "",
        secret.configured && secret.name !== "qq_bot" ? h("button", { onclick: async () => { if (!confirm(`删除整份凭据 ${secret.name}？`)) return; try { await web(`/secrets/${secret.name}/remove`, { method: "POST" }); after(); } catch (error) { alert(error.message); } } }, "全部删除") : "",
        secret.description ? h("p", { class: "muted" }, secret.description) : "",
        secret.name === "qq_bot" ? "" : secretForm(secret, after), secret.oauth ? oauthPanel(secret, after) : "");
    }))];
}
function removeField(secret, field, after) {
  return h("button", { type: "button", onclick: async () => { if (!confirm(`删除 ${secret.name} 的 ${field}？`)) return; try { await web(`/secrets/${secret.name}/remove`, { method: "POST", body: { field } }); after(); } catch (error) { alert(error.message); } } }, "删除");
}
function secretForm(secret, after) {
  const rows = h("div", {}), state = h("span", { class: "muted", role: "status" }), named = [];
  for (const field of secret.fields) {
    const input = h("input", { name: field.name, type: field.plain ? "text" : "password", autocomplete: field.plain ? "off" : "new-password", placeholder: field.saved ? "已设置，留空不改" : field.optional ? "可选" : "必填" });
    named.push([field.name, input]);
    rows.append(h("div", { class: "row" }, h("label", {}, field.label, " ", input), h("span", { class: field.saved || field.optional ? "muted" : "error" }, field.saved ? "已设置" : field.optional ? "可选" : "未设置"),
      field.saved ? removeField(secret, field.name, after) : "", field.description ? h("span", { class: "muted" }, field.description) : ""));
  }
  // User-named keys (one per account) or, without a declaration, any field: listed by name, added in pairs.
  const extra = secret.extraFields, keys = extra ? extra.saved : secret.savedFields ?? [];
  if (keys.length) rows.append(h("ul", { class: "plain" }, keys.map(key => h("li", {}, h("code", {}, key), " ", h("span", { class: "muted" }, "已设置"), " ", removeField(secret, key, after)))));
  const pairs = h("div", {});
  const addPair = () => pairs.append(h("div", { class: "row" }, h("input", { name: "field", placeholder: extra ? extra.label : "字段名，如 apiKey", autocomplete: "off" }), h("input", { name: "value", type: "password", placeholder: extra ? extra.valueLabel : "值", autocomplete: "new-password" })));
  if (extra || !secret.fields.length) { if (extra?.description) rows.append(h("p", { class: "muted" }, extra.description)); addPair(); rows.append(pairs); }
  return h("form", { onsubmit: async event => {
    event.preventDefault();
    const value = Object.fromEntries([...named.map(([name, input]) => [name, input.value]),
      ...[...pairs.children].map(row => [row.querySelector("[name=field]").value.trim(), row.querySelector("[name=value]").value])].filter(([field, text]) => field && text));
    if (!Object.keys(value).length) { state.textContent = "没有要保存的字段"; return; }
    const missing = secret.fields.filter(field => !field.optional && !field.saved && !value[field.name]).map(field => field.label);
    if (missing.length && !confirm(`还缺 ${missing.join("、")}，仍然保存？`)) return;
    try { await web(`/secrets/${secret.name}`, { method: "POST", body: { value } }); after(); } catch (error) { state.textContent = error.message; }
  } }, rows, h("div", { class: "row" }, extra || !secret.fields.length ? h("button", { type: "button", onclick: addPair }, extra ? `再加一个${extra.label}` : "加一个字段") : "", h("button", { type: "submit", class: "primary" }, "保存"), state));
}
// v2-30 §4: the kernel runs the authorization; the provider's page asks the user to consent, then returns to Chrona.
function oauthPanel(secret, after) {
  const state = h("span", { class: "muted", role: "status" }), account = h("input", { placeholder: "账户名，如 work", autocomplete: "off", pattern: "[a-z][a-z0-9_]{0,29}" });
  const ready = secret.fields.find(field => field.name === "clientId")?.saved;
  const authorize = who => async () => {
    try {
      const { url, redirectUri } = await web(`/secrets/${secret.name}/authorize`, { method: "POST", body: { provider: secret.oauth.provider, scopes: secret.oauth.scopes.join(" "), ...(who ? { account: who } : {}) } });
      state.replaceChildren(`在应用里登记回调地址 ${redirectUri}，然后 `, h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "打开授权页"), "（10 分钟内有效）。完成后刷新本页。");
      window.open(url, "_blank", "noopener");
    } catch (error) { state.textContent = error.message; }
  };
  const label = who => who || "默认账户";
  return h("div", {}, h("h4", {}, `授权（${secret.oauth.provider === "google" ? "Google" : "Microsoft"}）`),
    h("p", { class: "muted" }, `范围：${secret.oauth.scopes.join(" ")}`),
    secret.oauth.authorized.length ? h("ul", { class: "plain" }, secret.oauth.authorized.map(who => h("li", {}, label(who), " ", h("span", { class: "muted" }, "已授权"), " ",
      h("button", { type: "button", onclick: authorize(who) }, "重新授权"), " ", removeField(secret, who ? `refreshToken_${who}` : "refreshToken", after)))) : "",
    ready ? h("div", { class: "row" }, secret.oauth.accounts ? account : "", h("button", { type: "button", class: "primary", onclick: () => authorize(secret.oauth.accounts ? account.value.trim() : "")() }, secret.oauth.accounts ? "授权新账户" : secret.oauth.authorized.length ? "重新授权" : "授权"), state)
      : h("p", { class: "muted" }, "先保存 Client ID（和 Client secret），再授权。"));
}
// The app's daily model-call cap lives in moduleModel.moduleDailyCalls; only that entry changes here.
async function modelCapPanel(name, model, after) {
  if (!model) return [];
  const state = h("span", { class: "muted", role: "status" });
  return [h("h3", {}, "模型"), h("p", {}, `档位 ${model.tier}${model.target ? `（${model.target.model}${model.target.thinking ? ` · ${model.target.thinking}` : ""}）` : "（未配置）"} · 今天 ${model.today.calls} 次 · 输入 ${model.today.inputTokens} / 输出 ${model.today.outputTokens} token`),
    h("form", { onsubmit: async event => {
      event.preventDefault();
      const value = event.target.elements.cap.value, settings = (await web("/settings")).settings.moduleModel;
      if (!settings) { state.textContent = "先在设置里配置模块模型档位。"; return; }
      const caps = { ...settings.moduleDailyCalls };
      if (value === "") delete caps[name]; else caps[name] = Number(value);
      try { await web("/settings", { method: "POST", body: { moduleModel: { ...settings, moduleDailyCalls: caps } } }); state.textContent = "已保存。"; after(); } catch (error) { state.textContent = error.message; }
    } }, h("label", {}, "每日调用上限（留空为只受全局上限） ", h("input", { name: "cap", type: "number", min: 0, max: 10000, value: model.dailyCap ?? "" })), h("div", { class: "row" }, h("button", { class: "primary" }, "保存"), state))];
}
// v2-18: which version runs, since when and how it got there, from the activity trail.
async function currentVersion(meta) {
  let recent = [];
  try { recent = (await web(`/activity?module=${encodeURIComponent(meta.name)}`)).items; } catch { /* the version line still shows */ }
  const switched = recent.find(item => ["module_activate", "module_auto_activated", "module_rollback", "admin_rollback"].includes(item.kind));
  return h("div", {},
    h("p", {}, h("strong", {}, `当前版本 ${String(meta.activeHash ?? "无").slice(0, 8)}`), switched ? h("span", { class: "muted" }, ` · ${when(switched.at)} · ${switched.text}`) : null),
    recent.length > 1 ? h("ul", { class: "plain" }, recent.filter(item => item !== switched).slice(0, 5).map(item => h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.text))) : null,
    h("p", {}, h("a", { href: `/activity?module=${encodeURIComponent(meta.name)}` }, "查看全部活动")));
}
// ---------------------------------------------------------------- activity --
async function activity(params) {
  const module = params.get("module") ?? "", items = h("ul", { class: "plain" }), more = h("button", { type: "button", hidden: true }, "更早的");
  let before = null;
  const load = async () => {
    const query = new URLSearchParams({ ...(module ? { module } : {}), ...(before ? { before } : {}) });
    const page = await web(`/activity?${query}`);
    items.append(...page.items.map(item => h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.module && !module ? h("a", { href: `/activity?module=${encodeURIComponent(item.module)}` }, item.module) : null, item.module && !module ? " · " : null, item.text,
      processLink(item))));
    before = page.before; more.hidden = !before;
    if (!items.children.length) items.replaceWith(h("p", { class: "muted" }, "还没有活动。"));
  };
  more.addEventListener("click", () => load().catch(error => alert(error.message)));
  main.replaceChildren(h("section", {}, h("h2", {}, module ? `活动 · ${module}` : "活动"),
    h("p", { class: "muted" }, "Chrona 做过的事：审批与你的决定、AI 复核、应用的检查、启用、自动更新、回滚和故障、授权、设置与凭据的改动（只记名称）。"),
    module ? h("p", {}, h("a", { href: "/activity" }, "看全部应用")) : null, items, more));
  await load();
}
// Credentials (v2-16): field name + value pairs; saved values are never shown, only whether one is set.
// v2-17: what the app can do, the grants you gave it and its recent approvals (credentials and model are on its Settings tab).
function permissionsPanel(view, after) {
  const revoke = grant => async () => {
    if (!confirm("撤销这条授权？")) return;
    try { await web(`/grants/${grant.id}/revoke`, { method: "POST" }); after(); } catch (error) { alert(error.message); }
  };
  return h("div", {},
    h("h3", {}, "能做什么"), view.capabilities.length ? h("ul", { class: "plain" }, view.capabilities.map(item => h("li", {}, item))) : h("p", { class: "muted" }, "只在自己的数据里工作，不联网、不调用其他应用。"),
    h("h3", {}, "你给过的授权"), view.grants.length ? h("ul", { class: "plain" }, view.grants.map(grant => h("li", {}, `${grant.action} · ${grant.mode}${grant.once ? " · 一次" : ""}`, " ", h("button", { onclick: revoke(grant) }, "撤销")))) : h("p", { class: "muted" }, "没有。"),
    h("h3", {}, "最近审批"), view.approvals.length ? h("ul", { class: "plain" }, view.approvals.map(item => h("li", {}, item.title, " ", h("span", { class: "muted" }, `${STATUS[item.status] ?? item.status} · ${when(item.createdAt)}`)))) : h("p", { class: "muted" }, "没有。"));
}
const STATUS = { open: "待决定", approved: "已批准", denied: "已拒绝", expired: "已过期" };
function toolForm(tool) {
  const properties = Object.entries(tool.inputSchema.properties ?? {}), required = tool.inputSchema.required ?? [];
  const output = h("pre", { hidden: true });
  const field = ([name, schema]) => h("label", {}, `${name}${required.includes(name) ? " *" : ""} `,
    schema.enum ? h("select", { name }, (required.includes(name) ? [] : [h("option", { value: "" }, "")]).concat(schema.enum.map(value => h("option", { value }, value))))
      : h("input", { name, type: schema.type === "boolean" ? "checkbox" : schema.type === "number" ? "number" : "text", required: schema.type !== "boolean" && required.includes(name), style: schema.type === "boolean" ? "width:auto" : false, title: schema.description ?? false }));
  return h("form", { onsubmit: async event => {
    event.preventDefault();
    // A tool that is not idempotent may change things: ask first.
    if (!tool.idempotent && !confirm(`执行 ${tool.target}？`)) return;
    const args = {};
    for (const [name, schema] of properties) {
      const input = event.target.elements[name];
      if (schema.type === "boolean") args[name] = input.checked;
      else if (input.value !== "") args[name] = schema.type === "number" ? Number(input.value) : input.value;
    }
    output.hidden = false; output.textContent = "执行中……";
    try { output.textContent = JSON.stringify(await web("/call", { method: "POST", body: { target: tool.target, args } }), null, 2); }
    catch (error) { output.textContent = error.message; }
  } }, h("div", {}, h("strong", {}, tool.target.split(".")[1]), " ", h("span", { class: "muted" }, tool.description)),
    ...properties.map(field), h("div", { class: "row" }, h("button", { class: "primary" }, "执行")), output);
}
// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js (React + json-render), loaded only here.
let unmountPage = null;
async function registeredPage(module, id) {
  const page = await web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`);
  const { mount } = await import("/pages.js");
  const view = h("div", {});
  main.replaceChildren(h("h2", {}, page.title), view);
  unmountPage = mount(view, page, { call: (target, args) => tool(target, args), navigate: path => go(path), content: path => web(path, { raw: true }) });
}
const pageHref = page => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
async function pageLinks() {
  const nav = document.querySelector("header nav"), apps = nav.querySelector('a[href="/apps"]');
  nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  for (const page of await web("/pages").catch(() => [])) apps.before(h("a", { href: pageHref(page), "data-page": "" }, page.title));
}

// --------------------------------------------------------------- settings --
async function settings() {
  const view = await web("/settings"), reload = () => settings();
  const act = (path, body, ask) => async () => {
    if (ask && !confirm(ask)) return;
    try { await web(path, { method: "POST", ...(body ? { body } : {}) }); reload(); } catch (error) { alert(error.message); }
  };
  const n = view.settings.notifications, status = h("span", { class: "muted" });
  const field = (label, input) => h("label", {}, `${label} `, input);
  const form = h("form", { onsubmit: async event => {
    event.preventDefault();
    const f = event.target.elements, quiet = f.quietStart.value && f.quietEnd.value ? { start: f.quietStart.value, end: f.quietEnd.value } : null;
    try { const saved = await web("/settings", { method: "POST", body: { notifications: { dailyCap: Number(f.dailyCap.value), quietHours: quiet, timezone: f.timezone.value, digestAt: f.digestAt.value } } }); showBuildUsage(saved); status.textContent = "已保存"; }
    catch (error) { status.textContent = error.message; }
  } },
    field("每天最多主动通知", h("input", { name: "dailyCap", type: "number", min: 0, max: 50, value: n.dailyCap })),
    field("安静时段", h("span", {}, h("input", { name: "quietStart", type: "time", value: n.quietHours?.start ?? "" }), " – ", h("input", { name: "quietEnd", type: "time", value: n.quietHours?.end ?? "" }))),
    field("时区", h("input", { name: "timezone", value: n.timezone })),
    field("汇总时间", h("input", { name: "digestAt", type: "time", value: n.digestAt })),
    h("div", { class: "row" }, h("button", { class: "primary" }, "保存"), status));
  const builds = view.settings.builds, buildStatus = h("span", { class: "muted", role: "status" }), usage = h("p", { class: "muted" });
  const showBuildUsage = settings => {
    const u = settings.buildUsage;
    usage.textContent = `${u.date}（${u.timezone}）：今日新建 ${u.used} / ${settings.builds.dailyLimit}，剩余 ${u.remaining} 个。`;
  };
  showBuildUsage(view.settings);
  let savingBuilds = false;
  const buildForm = h("form", { onsubmit: async event => {
    event.preventDefault();
    if (savingBuilds) return;
    const f = event.target.elements, button = event.target.querySelector("button[type=submit]");
    savingBuilds = true; button.disabled = true; buildStatus.textContent = "正在保存……";
    try {
      const saved = await web("/settings", { method: "POST", body: { builds: { dailyLimit: Number(f.buildDailyLimit.value), timeoutMinutes: Number(f.buildTimeoutMinutes.value), maxSubmissions: Number(f.buildMaxSubmissions.value) } } });
      showBuildUsage(saved); buildStatus.textContent = "已保存，下次构建生效；当前构建不受影响。";
    } catch (error) { buildStatus.textContent = error.message; }
    finally { savingBuilds = false; button.disabled = false; }
  } },
    field("每日新建构建上限", h("input", { name: "buildDailyLimit", type: "number", min: 0, max: 200, step: 1, required: true, value: builds.dailyLimit })),
    field("单轮构建时限（分钟）", h("input", { name: "buildTimeoutMinutes", type: "number", min: 5, max: 120, step: 1, required: true, value: builds.timeoutMinutes })),
    field("每轮候选提交上限", h("input", { name: "buildMaxSubmissions", type: "number", min: 1, max: 20, step: 1, required: true, value: builds.maxSubmissions })),
    h("div", { class: "row" }, h("button", { type: "submit", class: "primary" }, "保存构建设置"), buildStatus));
  // Module models (v2-17): tiers (model + thinking level), call limits, per-module daily caps and today's use.
  const models = modelForm(view.settings, reload);
  // v2-23: each app's own settings, credentials and model cap are on its page; this lists where they are.
  const [modules, system] = await Promise.all([web("/modules"), web("/system-apps").catch(() => [])]);
  const needs = new Map((view.secrets ?? []).flatMap(secret => secret.modules.map(name => [name, secret.configured])));
  const perApp = h("section", {}, h("h2", {}, "按应用设置"), h("p", { class: "muted" }, "每个应用自己的配置、凭据和模型上限在它的“设置”标签里。"),
    h("ul", { class: "plain" }, [...modules.map(m => h("li", {}, h("a", { href: `/apps/${m.id}?tab=settings` }, m.name), needs.has(m.name) && !needs.get(m.name) ? h("span", { class: "error" }, " · 凭据未设置") : "")),
      ...system.map(m => h("li", {}, h("a", { href: `/apps/system/${m.name}?tab=settings` }, m.name), h("span", { class: "muted" }, " · 系统")))]));
  const activeGrants = view.grants.filter(g => !g.revokedAt && !(g.once && g.consumedAt) && !(g.expiresAt && Date.parse(g.expiresAt) <= Date.now()));
  const live = view.schedules.filter(s => s.status === "active" || s.status === "paused");
  main.replaceChildren(
    h("section", {}, h("h2", {}, "设置"), form),
    h("section", {}, h("h2", {}, "构建设置"), usage,
      h("p", { class: "muted" }, "每日额度按上方时区的零点重置，只计算新建构建会话；手动续作仍受每会话每日24次、全局每日200次运行限制。设为0可暂停新建。"),
      h("p", { class: "muted" }, "修改只影响后续构建，不中断当前构建。失败不自动重试，启用应用仍需遵循审批。提高额度可能增加模型费用。"), buildForm),
    models,
    perApp,
    h("section", {}, h("h2", {}, "日程"),
      live.length ? h("ul", { class: "plain" }, live.map(s => h("li", {}, s.label ?? s.mode, " ", h("span", { class: "muted" }, s.status === "paused" ? "已暂停" : s.nextAt ? when(s.nextAt) : ""), " ",
        s.status === "active" ? h("button", { onclick: act(`/schedules/${s.id}`, { status: "paused" }) }, "暂停") : h("button", { onclick: act(`/schedules/${s.id}`, { status: "active" }) }, "恢复"),
        h("button", { onclick: act(`/schedules/${s.id}`, { status: "cancelled" }, "取消这个日程？") }, "取消")))) : h("p", { class: "muted" }, "没有日程。")),
    h("section", {}, h("h2", {}, "授权规则"),
      activeGrants.length ? h("ul", { class: "plain" }, activeGrants.map(g => h("li", {}, `${g.action} · ${g.mode}`, " ", h("span", { class: "muted" }, g.scope.kind === "module" ? "仅一个应用" : "全部"), " ",
        h("button", { onclick: act(`/grants/${g.id}/revoke`, null, "撤销这条授权？") }, "撤销")))) : h("p", { class: "muted" }, "没有授权规则。")),
    h("section", {}, h("h2", {}, "Chrona 记得的偏好"),
      view.preferences.length ? h("ul", { class: "plain" }, view.preferences.map(p => h("li", {}, p.text, " ", h("button", { onclick: act(`/preferences/${p.id}/forget`, null, "删除这条偏好？") }, "删除")))) : h("p", { class: "muted" }, "还没有。")));
}

const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
function modelForm(settings, reload) {
  const current = settings.moduleModel, state = h("span", { class: "muted", role: "status" });
  const tiers = h("div", {}), caps = h("div", {});
  const tierRow = (name = "", target = "") => {
    const { model = "", thinking = "" } = typeof target === "string" ? { model: target } : target;
    tiers.append(h("div", { class: "fields" }, h("input", { name: "tier", placeholder: "档位，如 strong", value: name, autocomplete: "off" }), h("input", { name: "model", placeholder: "模型，如 openai/gpt-6.1-sol", value: model, autocomplete: "off" }),
      h("select", { name: "thinking", "aria-label": "思考等级" }, THINKING.map(level => h("option", { value: level, ...(level === thinking ? { selected: true } : {}) }, level || "默认思考")))));
  };
  const capRow = (module = "", calls = "") => caps.append(h("div", { class: "fields pair" }, h("input", { name: "capModule", placeholder: "模块名", value: module, autocomplete: "off" }), h("input", { name: "capCalls", type: "number", min: 0, max: 10000, value: calls, "aria-label": "每日上限" })));
  for (const [name, target] of Object.entries(current?.models ?? { strong: "" })) tierRow(name, target);
  for (const [module, calls] of Object.entries(current?.moduleDailyCalls ?? {})) capRow(module, calls);
  const number = (name, label, value, min, max) => h("label", {}, `${label} `, h("input", { name, type: "number", min, max, step: 1, required: true, value: value ?? "" }));
  const read = f => {
    const value = row => row.querySelector.bind(row);
    const models = Object.fromEntries([...tiers.children].map(row => [value(row)("[name=tier]").value.trim(), value(row)("[name=model]").value.trim(), value(row)("[name=thinking]").value])
      .filter(([tier, model]) => tier && model).map(([tier, model, thinking]) => [tier, thinking ? { model, thinking } : { model }]));
    const moduleDailyCalls = Object.fromEntries([...caps.children].map(row => [value(row)("[name=capModule]").value.trim(), value(row)("[name=capCalls]").value]).filter(([module, calls]) => module && calls !== "").map(([module, calls]) => [module, Number(calls)]));
    return { models, maxCallsPerEvent: Number(f.maxCallsPerEvent.value), maxOutputTokens: Number(f.maxOutputTokens.value), dailyCalls: Number(f.dailyCalls.value), timeoutMs: Number(f.timeoutSeconds.value) * 1000, ...(Object.keys(moduleDailyCalls).length ? { moduleDailyCalls } : {}) };
  };
  const save = async moduleModel => {
    try { await web("/settings", { method: "POST", body: { moduleModel } }); state.textContent = "已保存"; reload(); } catch (error) { state.textContent = error.message; }
  };
  const form = h("form", { onsubmit: event => {
    event.preventDefault();
    const moduleModel = read(event.target.elements);
    if (!Object.keys(moduleModel.models).length) { state.textContent = "至少配置一个档位"; return; }
    save(moduleModel);
  } },
    h("p", { class: "muted" }, "模块在清单里只写档位名；这里决定每个档位用哪个模型、思考多深。"), tiers,
    h("div", { class: "row" }, h("button", { type: "button", onclick: () => tierRow() }, "加一个档位")),
    h("div", { class: "row" }, number("maxCallsPerEvent", "每次事件最多调用", current?.maxCallsPerEvent ?? 3, 1, 20), number("maxOutputTokens", "单次最多输出 token", current?.maxOutputTokens ?? 4000, 1, 32000),
      number("dailyCalls", "全部模块每天合计", current?.dailyCalls ?? 30, 1, 10000), number("timeoutSeconds", "超时（秒）", (current?.timeoutMs ?? 180000) / 1000, 5, 600)),
    h("p", { class: "muted" }, "单个模块的每日上限（未列出的只受合计限制；超出只停这个模块）："), caps,
    h("div", { class: "row" }, h("button", { type: "button", onclick: () => capRow() }, "加一个模块上限")),
    h("div", { class: "row" }, h("button", { type: "submit", class: "primary" }, "保存模块模型"), current && h("button", { type: "button", onclick: () => { if (confirm("关闭后模块都不能调用模型，确定？")) save(null); } }, "关闭模块模型"), state));
  const usage = settings.modelUsage ?? [];
  return h("section", {}, h("h2", {}, "模块模型"), current ? null : h("p", { class: "muted" }, "尚未配置：模块不能调用模型。"), form,
    h("h3", {}, "今日用量"), usage.length ? h("ul", { class: "plain" }, usage.map(row => h("li", {}, `${row.module}：${row.calls} 次`, " ", h("span", { class: "muted" }, `输入 ${row.inputTokens} / 输出 ${row.outputTokens} token${current?.moduleDailyCalls?.[row.module] !== undefined ? ` · 上限 ${current.moduleDailyCalls[row.module]}` : ""}`)))) : h("p", { class: "muted" }, "今天还没有模块调用模型。"));
}

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  replyListeners.clear();
  unmountPage?.(); unmountPage = null;
  try {
    if (parts[0] === "chat") await chat(null);
    else if (parts[0] === "sessions" && parts[1]) await chat(parts[1]);
    else if (parts[0] === "p" && parts[1] && parts[2]) await registeredPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    else if (parts[0] === "settings") await settings();
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemApp(decodeURIComponent(parts[2]), url.searchParams.get("session"), url.searchParams.get("tab") ?? "overview");
    else if (parts[0] === "apps" && parts[1]) await app(parts[1], url.searchParams.get("tab") ?? "overview");
    else if (parts[0] === "apps") await apps();
    else if (parts[0] === "activity") await activity(url.searchParams);
    else await today();
  } catch (error) {
    if (error instanceof Unauthorized) login(localStorage.getItem(KEY) ? "密钥不正确，请重新输入。" : undefined);
    else main.replaceChildren(h("section", {}, h("p", { class: "error" }, error.message)));
  }
}
function go(path, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  void route();
}
document.addEventListener("click", event => {
  const link = event.target.closest("a[href^='/']");
  if (!link || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault(); go(link.getAttribute("href"));
});
addEventListener("popstate", () => void route());
document.getElementById("logout").addEventListener("click", () => { localStorage.removeItem(KEY); login(); });

let listening = false;
async function start() {
  document.getElementById("logout").hidden = !localStorage.getItem(KEY);
  // Stops on a wrong key; the next start (after login) listens again.
  if (!listening) { listening = true; void listen().finally(() => { listening = false; }); }
  void pageLinks();
  await route();
}
void start();
