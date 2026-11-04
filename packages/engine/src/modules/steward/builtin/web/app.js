// Chrona's router and remaining DOM pages. System and registered app pages share /pages.js.
// Data comes from /api/web through routed calls for the user (v2-8); requests carry the user's key.
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

const login = message => systemPage("login", message);

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

// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js with module-scoped calls.
let unmountPage = null;
async function registeredPage(module, id) {
  const page = await web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`);
  const { mount } = await import("/pages.js");
  const view = h("div", {});
  main.replaceChildren(h("h2", {}, page.title), view);
  unmountPage = mount(view, page, { call: (target, args) => tool(target, args), navigate: path => go(path), content: path => web(path, { raw: true }) });
}
async function systemPage(name, message) {
  const { mountSystem } = await import("/pages.js");
  unmountPage?.();
  main.replaceChildren();
  const systemWeb = async (path, options) => {
    try { return await web(path, options); }
    catch (error) { if (error instanceof Unauthorized) await login("密钥不正确，请重新输入。"); throw error; }
  };
  unmountPage = mountSystem(main, name, { web: systemWeb, tool, login: async key => { localStorage.setItem(KEY, key); await start(); } }, path => go(path), message);
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
      activeGrants.length ? h("ul", { class: "plain" }, activeGrants.map(g => h("li", {}, `${g.action} · ${{ allow: "允许", ask: "先问我" }[g.mode]}`, " ", h("span", { class: "muted" }, g.scope.kind === "module" ? "仅一个应用" : "全部"), " ",
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
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemPage("system-app", JSON.stringify({ id: decodeURIComponent(parts[2]), tab: url.searchParams.get("tab") ?? "overview", session: url.searchParams.get("session") ?? "" }));
    else if (parts[0] === "apps" && parts[1]) await systemPage("app", JSON.stringify({ id: decodeURIComponent(parts[1]), tab: url.searchParams.get("tab") ?? "overview", session: "" }));
    else if (parts[0] === "apps") await systemPage("apps");
    else if (parts[0] === "activity") await systemPage("activity", url.searchParams.get("module") ?? "");
    else await systemPage("today");
  } catch (error) {
    if (error instanceof Unauthorized) await login(localStorage.getItem(KEY) ? "密钥不正确，请重新输入。" : undefined);
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
  if (!localStorage.getItem(KEY)) { await login(); return; }
  try { await web("/today"); }
  catch (error) { if (error instanceof Unauthorized) { await login("密钥不正确，请重新输入。"); return; } }
  // Stops on a wrong key; the next start (after login) listens again.
  if (!listening) { listening = true; void listen().finally(() => { listening = false; }); }
  void pageLinks();
  await route();
}
void start();
